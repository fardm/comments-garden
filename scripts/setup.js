const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const WORKER_DIR = path.join(__dirname, '../worker');
const WRANGLER_TOML = path.join(WORKER_DIR, 'wrangler.toml');
const SCHEMA_PATH = path.join(WORKER_DIR, 'schema.sql');
const MIGRATIONS_DIR = path.join(WORKER_DIR, 'migrations');

// ── Readline ──────────────────────────────────────────────────────────────────

let rl = null;

function ensureRl() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function prompt(question) {
  return new Promise(resolve => {
    process.stdin.resume();
    ensureRl().question(question, answer => resolve(answer.trim()));
  });
}

function cleanup() {
  if (rl) { rl.close(); rl = null; }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// ── Wrangler helpers ──────────────────────────────────────────────────────────

function runCommand(command) {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: WORKER_DIR,
      shell: true,
    });
  } catch (error) {
    return null;
  }
}

function getDbName() {
  const toml = fs.readFileSync(WRANGLER_TOML, 'utf-8');
  const match = toml.match(/database_name\s*=\s*"([^"]+)"/);
  return match ? match[1] : 'comment-garden-db';
}

function updateWranglerToml(dbName, dbId) {
  let toml = fs.readFileSync(WRANGLER_TOML, 'utf-8');
  toml = toml.replace(/database_name\s*=\s*"[^"]*"/g, `database_name = "${dbName}"`);
  toml = toml.replace(/database_id\s*=\s*"[^"]*"/g, `database_id = "${dbId}"`);
  fs.writeFileSync(WRANGLER_TOML, toml);
}

// ── Cloudflare auth check ────────────────────────────────────────────────────

async function checkCloudflareAuth() {
  console.log('🔒 Checking Cloudflare authentication...');
  try {
    const whoami = execSync('npx wrangler whoami', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (whoami.includes('You are not authenticated')) {
      console.error('❌ Not logged in to Cloudflare.');
      console.log('\nPlease run: npx wrangler login');
      process.exit(1);
    }
    console.log('✅ Logged in to Cloudflare\n');
  } catch (error) {
    if (error.stdout && error.stdout.includes('You are not authenticated')) {
      console.error('❌ Not logged in to Cloudflare.');
      console.log('\nPlease run: npx wrangler login');
      process.exit(1);
    } else if (error.stdout && (error.stdout.includes('logged in') || error.stdout.includes('Getting User settings'))) {
      console.log('⚠️  Could not verify Cloudflare login status. Continuing anyway...');
      if (error.stderr) console.error(error.stderr.trim());
    } else {
      console.error('❌ Not logged in to Cloudflare or failed to verify.');
      if (error.stderr) console.error(error.stderr.trim());
      console.log('⚠️  Continuing anyway...');
    }
  }
}

// ── Database operations ───────────────────────────────────────────────────────

function createDatabase(dbName) {
  let createOutput = '';
  let dbId = '';

  try {
    createOutput = execSync(`npx wrangler d1 create "${dbName}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(createOutput);

    const match = createOutput.match(/database_id[=:\s]+"([0-9a-fA-F-]+)"/);
    if (match && match[1]) {
      dbId = match[1];
    } else {
      const uuidMatch = createOutput.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (uuidMatch) dbId = uuidMatch[0];
    }
  } catch (error) {
    const stderr = error.stderr || '';
    const stdout = error.stdout || '';
    const fullError = stderr + '\n' + stdout;

    if (fullError.includes('already exists') || fullError.includes('error: 7404') || fullError.includes('already_exists')) {
      console.log('Database already exists. Retrieving info...');
      try {
        const listOutput = execSync('npx wrangler d1 list --json', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const dbs = JSON.parse(listOutput);
        const db = dbs.find(d => d.name === dbName);
        if (db && db.uuid) {
          dbId = db.uuid;
        } else {
          console.error(`❌ Could not find "${dbName}" in the database list.`);
          process.exit(1);
        }
      } catch (listError) {
        console.error('❌ Failed to list D1 databases.');
        if (listError.stderr) console.error(listError.stderr);
        if (listError.stdout) console.error(listError.stdout);
        process.exit(1);
      }
    } else {
      console.error('❌ Failed to create D1 database.');
      console.error(fullError.trim());
      process.exit(1);
    }
  }

  return dbId;
}

function initSchema(dbName) {
  console.log('🏗️  Initializing database schema...');
  console.log('   -> Local database');
  runCommand(`npx wrangler d1 execute "${dbName}" --local --file="${SCHEMA_PATH}"`);

  console.log('   -> Remote database');
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --remote --file="${SCHEMA_PATH}"`, {
      encoding: 'utf-8', stdio: 'inherit', cwd: WORKER_DIR,
    });
  } catch (e) {
    console.log('   Remote database execution might have failed or needs confirmation. Continuing.');
  }
  console.log('✅ Schema initialized\n');
}

function applyMigrations(dbName) {
  console.log('📦 Applying database migrations...\n');

  // Apply schema.sql first (idempotent via CREATE TABLE IF NOT EXISTS)
  console.log('   [1/2] Base schema (idempotent)...');
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --local --file="${SCHEMA_PATH}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: WORKER_DIR,
    });
    console.log('   -> Local: applied');
  } catch (e) {
    console.log('   -> Local: skipped (' + (e.message || 'error') + ')');
  }
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --remote --file="${SCHEMA_PATH}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: WORKER_DIR,
    });
    console.log('   -> Remote: applied');
  } catch (e) {
    console.log('   -> Remote: skipped (' + (e.message || 'error') + ')');
  }

  // Apply any .sql migration files from the migrations directory
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length > 0) {
      console.log(`\n   [2/2] ${files.length} migration file(s) found...\n`);
      for (const file of files) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        // Extract comment lines for display
        const firstComment = sql.split('\n').find(l => l.startsWith('--'));
        const label = firstComment ? firstComment.replace(/^--\s*/, '').trim() : file;
        console.log(`   📄 ${label}`);

        // Try to run each statement from the migration file individually
        // to gracefully handle "duplicate column" and similar idempotency errors
        const statements = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const stmt of statements) {
          for (const target of ['--local', '--remote']) {
            try {
              execSync(`npx wrangler d1 execute "${dbName}" ${target} --command="${stmt.replace(/"/g, '\\"')}"`, {
                encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: WORKER_DIR,
              });
              console.log(`      -> ${target.replace('--', '')}: applied`);
            } catch (e) {
              const msg = (e.stderr || e.stdout || '').toLowerCase();
              if (msg.includes('duplicate column') || msg.includes('duplicate table') || msg.includes('already exists')) {
                console.log(`      -> ${target.replace('--', '')}: already up to date`);
              } else {
                console.log(`      -> ${target.replace('--', '')}: skipped (${(e.message || 'error').substring(0, 80)})`);
              }
            }
          }
        }
      }
    } else {
      console.log('   [2/2] No migration files found.\n');
    }
  }

  console.log('\n✅ All migrations applied\n');
}

// ── Options ───────────────────────────────────────────────────────────────────

async function optionInitialSetup() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🌱 Comment Garden — Initial Setup');
  console.log('═══════════════════════════════════════════════════\n');

  await checkCloudflareAuth();

  // 1. Ask for database name
  const currentDbName = getDbName();
  const dbNameInput = await prompt(`📦 Database name [${currentDbName}]: `);
  const dbName = dbNameInput || currentDbName;
  console.log('');

  // 2. Create D1 database
  console.log(`📦 Creating Cloudflare D1 database ("${dbName}")...`);
  const dbId = createDatabase(dbName);
  if (!dbId) {
    console.error('❌ Could not obtain database_id.');
    process.exit(1);
  }
  console.log(`✅ Database ID: ${dbId}\n`);

  // 3. Update wrangler.toml
  console.log('🔧 Updating worker/wrangler.toml...');
  updateWranglerToml(dbName, dbId);
  console.log('✅ wrangler.toml updated\n');

  // 4. Initialize schema
  initSchema(dbName);

  // 5. Apply migrations
  applyMigrations(dbName);

  // 6. Admin password
  console.log('🔐 Admin Account Setup');
  let password = await prompt('Enter a new admin password: ');
  while (!password || password.trim().length < 4) {
    console.log('Password must be at least 4 characters long.');
    password = await prompt('Enter a new admin password: ');
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const tmpSqlPath = path.join(WORKER_DIR, 'tmp.sql');
  fs.writeFileSync(tmpSqlPath, `UPDATE settings SET value = '${hash}' WHERE key = 'admin_password_hash';`);

  console.log('\nSaving admin password to local database...');
  runCommand(`npx wrangler d1 execute "${dbName}" --local --file="tmp.sql"`);

  console.log('Saving admin password to remote database...');
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --remote --file="tmp.sql"`, {
      encoding: 'utf-8', stdio: 'inherit', cwd: WORKER_DIR,
    });
  } catch (e) {
    console.log('Could not update remote database right now. If you deploy, run this command manually:');
    console.log(`cd worker && npx wrangler d1 execute "${dbName}" --remote --command="UPDATE settings SET value='${hash}' WHERE key='admin_password_hash';"`);
  }

  try { fs.unlinkSync(tmpSqlPath); } catch (_) {}

  console.log('\n✅ Initial setup complete!');
  console.log('\nYou can now start the local development server with:');
  console.log('  npm run dev');
  console.log('\nOr deploy to production with:');
  console.log('  npm run deploy\n');
}

async function optionChangePassword() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🔑 Change Admin Password');
  console.log('═══════════════════════════════════════════════════\n');

  const dbName = getDbName();
  console.log(`Database: "${dbName}"\n`);

  let password = await prompt('Enter a new admin password: ');
  while (!password || password.trim().length < 4) {
    console.log('Password must be at least 4 characters long.');
    password = await prompt('Enter a new admin password: ');
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const tmpSqlPath = path.join(WORKER_DIR, 'tmp.sql');
  fs.writeFileSync(tmpSqlPath, `UPDATE settings SET value = '${hash}' WHERE key = 'admin_password_hash';`);

  console.log('\nSaving to local database...');
  runCommand(`npx wrangler d1 execute "${dbName}" --local --file="tmp.sql"`);

  console.log('Saving to remote database...');
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --remote --file="tmp.sql"`, {
      encoding: 'utf-8', stdio: 'inherit', cwd: WORKER_DIR,
    });
  } catch (e) {
    console.log('Could not update remote database. Run manually:');
    console.log(`cd worker && npx wrangler d1 execute "${dbName}" --remote --command="UPDATE settings SET value='${hash}' WHERE key='admin_password_hash';"`);
  }

  try { fs.unlinkSync(tmpSqlPath); } catch (_) {}

  console.log('\n✅ Admin password updated successfully.\n');
}

async function optionConfigureDatabase() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🗄️  Configure Database');
  console.log('═══════════════════════════════════════════════════\n');

  const currentDbName = getDbName();
  console.log(`Current database name: "${currentDbName}"\n`);

  // Show all available D1 databases
  console.log('Available D1 databases on your account:\n');
  try {
    const listOutput = execSync('npx wrangler d1 list --json', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const dbs = JSON.parse(listOutput);
    if (dbs.length === 0) {
      console.log('   (none found)\n');
    } else {
      for (const db of dbs) {
        const marker = db.name === currentDbName ? '  ← current' : '';
        console.log(`   ${db.name}  (${db.uuid})${marker}`);
      }
      console.log('');
    }
  } catch (e) {
    console.log('   Could not list databases.\n');
  }

  const newName = await prompt(`New database name [${currentDbName}] (leave blank to keep): `);
  if (!newName || newName === currentDbName) {
    console.log('\nℹ️  Database configuration unchanged.\n');
    return;
  }

  // Look up the database ID for the new name
  console.log(`\nLooking up database "${newName}"...`);
  let dbId = '';
  try {
    const listOutput = execSync('npx wrangler d1 list --json', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const dbs = JSON.parse(listOutput);
    const db = dbs.find(d => d.name === newName);
    if (db && db.uuid) {
      dbId = db.uuid;
    }
  } catch (e) {}

  if (!dbId) {
    console.log(`Database "${newName}" not found on your account.`);
    const createIt = await prompt('Create it now? (y/n): ');
    if (createIt.toLowerCase() !== 'y' && createIt.toLowerCase() !== 'yes') {
      console.log('\nℹ️  Database configuration unchanged.\n');
      return;
    }
    dbId = createDatabase(newName);
    if (!dbId) {
      console.error('❌ Could not create database.');
      process.exit(1);
    }
    console.log(`✅ Created "${newName}" with ID: ${dbId}`);
    initSchema(newName);
    applyMigrations(newName);
  }

  console.log(`\nUpdating wrangler.toml to point to "${newName}"...`);
  updateWranglerToml(newName, dbId);
  console.log(`✅ wrangler.toml updated. Now using database "${newName}" (${dbId})\n`);
}

async function optionReinitializeDatabase() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ⚠️   Reinitialize Database');
  console.log('═══════════════════════════════════════════════════\n');

  const dbName = getDbName();
  console.log(`Target database: "${dbName}"\n`);

  console.log('⚠️  WARNING: This will DROP ALL TABLES and reapply the schema.');
  console.log('   ALL EXISTING DATA (comments, votes, settings, sessions) WILL BE LOST.\n');

  const confirmation = await prompt('Type RESET to confirm (anything else cancels): ');
  if (confirmation !== 'RESET') {
    console.log('\n❌ Operation cancelled. No changes were made.\n');
    return;
  }

  console.log('\nDropping all tables...');
  const dropStatements = [
    'DROP TABLE IF EXISTS comments',
    'DROP TABLE IF EXISTS settings',
    'DROP TABLE IF EXISTS login_attempts',
    'DROP TABLE IF EXISTS sessions',
    'DROP TABLE IF EXISTS votes',
    'DROP TABLE IF EXISTS vote_log',
    'DROP TABLE IF EXISTS post_reactions',
  ];

  for (const stmt of dropStatements) {
    for (const target of ['--local', '--remote']) {
      try {
        execSync(`npx wrangler d1 execute "${dbName}" ${target} --command="${stmt}"`, {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: WORKER_DIR,
        });
      } catch (e) {
        // Table might not exist, that's fine
      }
    }
  }
  console.log('✅ All tables dropped\n');

  initSchema(dbName);
  applyMigrations(dbName);

  console.log('✅ Database reinitialized successfully.');
  console.log('   You will need to set a new admin password with option 2.\n');
}

async function optionApplyMigrations() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  📦 Apply Database Migrations');
  console.log('═══════════════════════════════════════════════════\n');

  const dbName = getDbName();
  console.log(`Target database: "${dbName}"\n`);

  applyMigrations(dbName);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function printMenu() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🌱 Comment Garden — Setup Manager');
  console.log('═══════════════════════════════════════════════════\n');
  console.log('  1. Initial setup');
  console.log('  2. Change admin password');
  console.log('  3. Configure database');
  console.log('  4. Reinitialize database');
  console.log('  5. Apply database migrations');
  console.log('  6. Exit\n');
}

async function main() {
  const args = process.argv.slice(2);

  // Allow direct invocation via flags
  if (args.includes('--setup')) { await optionInitialSetup(); process.exit(0); }
  if (args.includes('--password')) { await optionChangePassword(); process.exit(0); }
  if (args.includes('--migrate')) { await optionApplyMigrations(); process.exit(0); }
  if (args.includes('--reinit')) { await optionReinitializeDatabase(); process.exit(0); }

  // Interactive menu
  printMenu();

  const choice = await prompt('Enter option (1-6): ');

  const actions = {
    '1': optionInitialSetup,
    '2': optionChangePassword,
    '3': optionConfigureDatabase,
    '4': optionReinitializeDatabase,
    '5': optionApplyMigrations,
  };

  if (choice === '6' || choice === '') {
    console.log('\n👋 Goodbye.\n');
    process.exit(0);
  }

  if (actions[choice]) {
    console.log('');
    await actions[choice]();
  } else {
    console.error('\n❌ Invalid option.\n');
  }

  cleanup();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
