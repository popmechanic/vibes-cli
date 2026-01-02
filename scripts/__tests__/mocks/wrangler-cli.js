/**
 * Wrangler CLI Stub
 *
 * Stubs child_process.spawn and execSync for testing deploy-sell.js
 * without running real wrangler commands.
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Mock state - tracks executed commands and their results
 */
let mockState = {
  commands: [],
  kvNamespaces: new Map(),
  workers: new Map(),
  secrets: new Map(),
  pagesProjects: new Map()
};

/**
 * Reset mock state between tests
 */
export function resetWranglerMock() {
  mockState = {
    commands: [],
    kvNamespaces: new Map(),
    workers: new Map(),
    secrets: new Map(),
    pagesProjects: new Map()
  };
}

/**
 * Get executed commands for assertions
 */
export function getExecutedCommands() {
  return [...mockState.commands];
}

/**
 * Pre-configure a KV namespace to exist
 */
export function addMockKvNamespace(name, namespaceId = `ns_${Date.now()}`) {
  mockState.kvNamespaces.set(name, namespaceId);
  return namespaceId;
}

/**
 * Pre-configure a Pages project to exist
 */
export function addMockPagesProject(name) {
  mockState.pagesProjects.set(name, { name, domains: [] });
  return name;
}

/**
 * Command output generators
 */
const commandOutputs = {
  // wrangler kv namespace create TENANTS
  'kv namespace create': (args) => {
    const name = args[args.indexOf('create') + 1];
    const namespaceId = `ns_${Date.now()}_${name}`;
    mockState.kvNamespaces.set(name, namespaceId);

    return {
      exitCode: 0,
      stdout: `Creating namespace "${name}"...
Success! Created namespace "${name}":
{ id: "${namespaceId}", title: "${name}" }

Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "${name}"
id = "${namespaceId}"`,
      stderr: ''
    };
  },

  // wrangler kv namespace list
  'kv namespace list': () => {
    const namespaces = Array.from(mockState.kvNamespaces.entries()).map(([title, id]) => ({
      id,
      title,
      supports_url_encoding: true
    }));

    return {
      exitCode: 0,
      stdout: JSON.stringify(namespaces, null, 2),
      stderr: ''
    };
  },

  // wrangler deploy
  'deploy': (args) => {
    const configIndex = args.indexOf('--config');
    const configFile = configIndex !== -1 ? args[configIndex + 1] : 'wrangler.toml';

    const workerName = `worker_${Date.now()}`;
    mockState.workers.set(workerName, { configFile, deployedAt: Date.now() });

    return {
      exitCode: 0,
      stdout: `Uploading worker...
Published ${workerName} (0.50 sec)
  https://${workerName}.workers.dev
Current Deployment ID: dep_${Date.now()}`,
      stderr: ''
    };
  },

  // wrangler secret put
  'secret put': (args) => {
    const secretName = args[args.indexOf('put') + 1];
    mockState.secrets.set(secretName, '<redacted>');

    return {
      exitCode: 0,
      stdout: `Creating the secret for the Worker "${secretName}"...
Success! Uploaded secret ${secretName}`,
      stderr: ''
    };
  },

  // wrangler pages deploy
  'pages deploy': (args) => {
    const directory = args[args.indexOf('deploy') + 1];
    const projectName = args.includes('--project-name')
      ? args[args.indexOf('--project-name') + 1]
      : 'default-project';

    mockState.pagesProjects.set(projectName, {
      name: projectName,
      directory,
      deployedAt: Date.now()
    });

    return {
      exitCode: 0,
      stdout: `Uploading... (1/1)
Success! Deployed to:
  ${projectName}.pages.dev
  Commit: (none)
  Deployment ID: dep_${Date.now()}`,
      stderr: ''
    };
  },

  // wrangler pages project list
  'pages project list': () => {
    const projects = Array.from(mockState.pagesProjects.values());
    return {
      exitCode: 0,
      stdout: JSON.stringify(projects, null, 2),
      stderr: ''
    };
  },

  // wrangler --version
  '--version': () => ({
    exitCode: 0,
    stdout: '3.0.0',
    stderr: ''
  }),

  // Default handler for unknown commands
  'default': (args) => ({
    exitCode: 0,
    stdout: `Mock wrangler: ${args.join(' ')}`,
    stderr: ''
  })
};

/**
 * Match command to output generator
 */
function matchCommand(args) {
  const argsString = args.join(' ');

  for (const [pattern, handler] of Object.entries(commandOutputs)) {
    if (pattern !== 'default' && argsString.includes(pattern)) {
      return handler;
    }
  }

  return commandOutputs.default;
}

/**
 * Create a mock spawn function
 */
export function createMockSpawn(options = {}) {
  const {
    simulateErrors = {},  // { 'deploy': { exitCode: 1, stderr: 'Error' } }
    delay = 0
  } = options;

  return function mockSpawn(command, args = [], spawnOptions = {}) {
    // Record command
    mockState.commands.push({ command, args, options: spawnOptions });

    // Create mock child process
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: () => {},
      end: () => {}
    };

    // Check for simulated errors
    const argsString = args.join(' ');
    for (const [pattern, error] of Object.entries(simulateErrors)) {
      if (argsString.includes(pattern)) {
        setTimeout(() => {
          if (error.stderr) {
            child.stderr.emit('data', Buffer.from(error.stderr));
          }
          child.emit('close', error.exitCode || 1);
        }, delay);
        return child;
      }
    }

    // Get expected output
    const handler = matchCommand(args);
    const output = handler(args);

    // Emit output after delay
    setTimeout(() => {
      if (output.stdout) {
        child.stdout.emit('data', Buffer.from(output.stdout));
      }
      if (output.stderr) {
        child.stderr.emit('data', Buffer.from(output.stderr));
      }
      child.emit('close', output.exitCode);
    }, delay);

    return child;
  };
}

/**
 * Create a mock execSync function
 */
export function createMockExecSync(options = {}) {
  const { simulateErrors = {} } = options;

  return function mockExecSync(command, execOptions = {}) {
    // Parse command into args
    const parts = command.split(' ').filter(Boolean);
    const args = parts.slice(1); // Remove 'wrangler' or 'npx wrangler'

    // Remove 'wrangler' if it's the first arg after 'npx'
    if (args[0] === 'wrangler') {
      args.shift();
    }

    // Record command
    mockState.commands.push({ command, args, options: execOptions, sync: true });

    // Check for simulated errors
    const argsString = args.join(' ');
    for (const [pattern, error] of Object.entries(simulateErrors)) {
      if (argsString.includes(pattern)) {
        const err = new Error(error.message || 'Command failed');
        err.status = error.exitCode || 1;
        err.stderr = Buffer.from(error.stderr || '');
        throw err;
      }
    }

    // Get expected output
    const handler = matchCommand(args);
    const output = handler(args);

    if (output.exitCode !== 0) {
      const err = new Error('Command failed');
      err.status = output.exitCode;
      err.stderr = Buffer.from(output.stderr);
      throw err;
    }

    return Buffer.from(output.stdout);
  };
}

/**
 * Setup mock for vitest
 * Call this in beforeEach to mock child_process
 */
export function setupWranglerMock(options = {}) {
  const mockSpawn = createMockSpawn(options);
  const mockExecSync = createMockExecSync(options);

  // Reset state
  resetWranglerMock();

  return {
    spawn: mockSpawn,
    execSync: mockExecSync,
    getExecutedCommands,
    getMockState: () => mockState,
    addMockKvNamespace,
    addMockPagesProject,
    reset: resetWranglerMock
  };
}

/**
 * Assert a command was executed
 */
export function assertCommandExecuted(pattern) {
  const matches = mockState.commands.filter(cmd => {
    const fullCommand = [cmd.command, ...cmd.args].join(' ');
    return fullCommand.includes(pattern);
  });

  if (matches.length === 0) {
    throw new Error(`Expected command containing "${pattern}" to be executed`);
  }

  return matches;
}

/**
 * Assert a command was NOT executed
 */
export function assertCommandNotExecuted(pattern) {
  const matches = mockState.commands.filter(cmd => {
    const fullCommand = [cmd.command, ...cmd.args].join(' ');
    return fullCommand.includes(pattern);
  });

  if (matches.length > 0) {
    throw new Error(`Expected command containing "${pattern}" to NOT be executed`);
  }
}
