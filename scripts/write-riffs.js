#!/usr/bin/env node
// Write multiple riff files in parallel from JSON input
// Usage: echo '{"riff-1/app.jsx": "code...", ...}' | node write-riffs.js

const fs = require('fs');
const path = require('path');

let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const files = JSON.parse(input);
    const writes = Object.entries(files).map(async ([filePath, content]) => {
      const dir = path.dirname(filePath);
      if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
      console.log(`Wrote ${filePath}`);
    });
    await Promise.all(writes);
    console.log(`\nAll ${Object.keys(files).length} files written successfully.`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
});
