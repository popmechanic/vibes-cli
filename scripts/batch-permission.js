#!/usr/bin/env node
// Batch permission hook for vibes riff operations
// Asks once per batch, then allows subsequent operations for 60 seconds

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_FILE = path.join(os.tmpdir(), 'vibes-riff-approved');
const TIMEOUT = 60; // seconds

function allow() {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Batch approved"
    }
  }));
  process.exit(0);
}

function ask() {
  // Save approval time for subsequent calls
  fs.writeFileSync(LOCK_FILE, Date.now().toString());
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Vibes riff wants to write/execute files in parallel. Approve to continue."
    }
  }));
  process.exit(0);
}

// Check if we have recent approval
if (fs.existsSync(LOCK_FILE)) {
  try {
    const approvedTime = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
    const elapsed = (Date.now() - approvedTime) / 1000;

    if (elapsed < TIMEOUT) {
      allow();
    }
  } catch (e) {
    // File exists but unreadable - ask again
  }
}

ask();
