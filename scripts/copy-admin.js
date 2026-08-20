const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../admin');
const destDir = path.join(__dirname, '../worker/public/admin');
const publicDir = path.join(__dirname, '../worker/public');

// Helper to remove directory recursively
function rmrf(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Helper to copy directory recursively
function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(function(childItemName) {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

// 1. Clear out destDir
rmrf(destDir);
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// 2. Copy admin directory to worker/public/admin
copyRecursiveSync(srcDir, destDir);
console.log('✅ Copied admin assets successfully.');

// 3. Copy root frontend assets to worker/public
const rootFilesToCopy = [
    'comments.css',
    'comments.js',
    'recent-comments.html'
];
rootFilesToCopy.forEach(file => {
    const srcFile = path.join(__dirname, '..', file);
    const destFile = path.join(publicDir, file);
    if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`✅ Copied ${file}`);
    } else {
        console.warn(`⚠️ Warning: Root file ${file} not found.`);
    }
});

// 4. Copy lang directory
const srcLangDir = path.join(__dirname, '../lang');
const destLangDir = path.join(publicDir, 'lang');
if (fs.existsSync(srcLangDir)) {
    rmrf(destLangDir);
    copyRecursiveSync(srcLangDir, destLangDir);
    console.log('✅ Copied lang directory successfully.');
} else {
    console.warn('⚠️ Warning: lang directory not found.');
}
