const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'telegram.js');

function runTest(name, inputLines, timeout) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${name}`);
    console.log(`Input: ${JSON.stringify(inputLines)}`);
    console.log('='.repeat(60));

    const child = spawn('node', [SCRIPT], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    let i = 0;
    function sendNext() {
      if (i < inputLines.length) {
        setTimeout(() => {
          child.stdin.write(inputLines[i] + '\n');
          i++;
          sendNext();
        }, 1000);
      } else {
        setTimeout(() => { child.kill(); }, timeout || 2000);
      }
    }
    sendNext();

    child.on('close', () => {
      const hasError = stderr.includes('ERR_USE_AFTER_CLOSE') || stderr.includes('Error');
      const passed = !hasError;
      console.log(passed ? '✅ PASS' : '❌ FAIL');
      console.log('STDOUT:', stdout.trim());
      if (stderr) console.log('STDERR:', stderr.trim());
      resolve({ stdout, stderr, passed });
    });

    child.on('error', (err) => {
      console.log('❌ FAIL:', err.message);
      resolve({ stdout: '', stderr: err.message, passed: false });
    });
  });
}

async function main() {
  let allPassed = true;

  // Option 1: Setup (full flow)
  let r = await runTest('Option 1 - Setup', ['1', '123456:FAKE-TOKEN', '329606996', 'n', 'y', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 2: Change Bot Token
  r = await runTest('Option 2 - Change Token', ['2', '123456:FAKE-TOKEN', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 3: Change Chat ID
  r = await runTest('Option 3 - Change Chat ID', ['3', '329606996', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 4: Enable
  r = await runTest('Option 4 - Enable', ['4', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 5: Disable
  r = await runTest('Option 5 - Disable', ['5', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 6: Send test
  r = await runTest('Option 6 - Send test', ['6', '0'], 2000);
  if (!r.passed) allPassed = false;

  // Option 0: Exit
  r = await runTest('Option 0 - Exit', ['0'], 2000);
  if (!r.passed) allPassed = false;

  console.log('\n' + '='.repeat(60));
  console.log(allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
  console.log('='.repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main();
