import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, formatHelp, handleHelpAndErrors } from '../../lib/cli-utils.js';

const sampleSchema = [
  { name: 'name', flag: '--name', alias: '-n', type: 'string', required: true, description: 'VM name' },
  { name: 'file', flag: '--file', alias: '-f', type: 'string', default: 'index.html', description: 'HTML file' },
  { name: 'dryRun', flag: '--dry-run', type: 'boolean', description: 'Show what would be done' },
  { name: 'verbose', flag: '--verbose', alias: '-v', type: 'boolean', description: 'Enable verbose output' },
];

describe('parseArgs', () => {
  it('parses basic string argument', () => {
    const { args } = parseArgs(sampleSchema, ['--name', 'myapp']);
    expect(args.name).toBe('myapp');
  });

  it('parses boolean flag', () => {
    const { args } = parseArgs(sampleSchema, ['--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('boolean flags default to false', () => {
    const { args } = parseArgs(sampleSchema, []);
    expect(args.dryRun).toBe(false);
    expect(args.verbose).toBe(false);
  });

  it('parses short alias for string arg', () => {
    const { args } = parseArgs(sampleSchema, ['-n', 'myapp']);
    expect(args.name).toBe('myapp');
  });

  it('parses short alias for boolean flag', () => {
    const { args } = parseArgs(sampleSchema, ['-v']);
    expect(args.verbose).toBe(true);
  });

  it('uses default values', () => {
    const { args } = parseArgs(sampleSchema, []);
    expect(args.file).toBe('index.html');
    expect(args.name).toBeNull();
  });

  it('overrides defaults with provided values', () => {
    const { args } = parseArgs(sampleSchema, ['--file', 'build/app.html']);
    expect(args.file).toBe('build/app.html');
  });

  it('collects unknown flags as errors', () => {
    const { args } = parseArgs(sampleSchema, ['--unknown-flag', 'val']);
    expect(args._errors).toContain('Unknown flag: --unknown-flag');
  });

  it('collects positional args', () => {
    const { positionals } = parseArgs(sampleSchema, ['app.jsx', 'output.html', '--dry-run']);
    expect(positionals).toEqual(['app.jsx', 'output.html']);
  });

  it('parses --flag=value syntax', () => {
    const { args } = parseArgs(sampleSchema, ['--name=myapp', '--file=build.html']);
    expect(args.name).toBe('myapp');
    expect(args.file).toBe('build.html');
  });

  it('parses --flag=value for boolean', () => {
    const { args } = parseArgs(sampleSchema, ['--dry-run=true']);
    expect(args.dryRun).toBe(true);
  });

  it('parses --flag=value false for boolean', () => {
    const { args } = parseArgs(sampleSchema, ['--dry-run=false']);
    expect(args.dryRun).toBe(false);
  });

  it('handles --help flag', () => {
    const { args } = parseArgs(sampleSchema, ['--help']);
    expect(args._help).toBe(true);
  });

  it('handles -h alias for help', () => {
    const { args } = parseArgs(sampleSchema, ['-h']);
    expect(args._help).toBe(true);
  });

  it('parses multiple args together', () => {
    const { args, positionals } = parseArgs(sampleSchema, [
      '--name', 'myapp', '--file', 'out.html', '--dry-run', '-v', 'extra.txt'
    ]);
    expect(args.name).toBe('myapp');
    expect(args.file).toBe('out.html');
    expect(args.dryRun).toBe(true);
    expect(args.verbose).toBe(true);
    expect(positionals).toEqual(['extra.txt']);
  });

  it('errors when string flag has no value', () => {
    const { args } = parseArgs(sampleSchema, ['--name']);
    expect(args._errors).toContain('Flag --name requires a value');
  });

  it('errors when string flag value looks like another flag', () => {
    const { args } = parseArgs(sampleSchema, ['--name', '--dry-run']);
    expect(args._errors).toContain('Flag --name requires a value');
    // --dry-run is still parsed
    expect(args.dryRun).toBe(true);
  });

  it('allows negative numbers as values', () => {
    const { args } = parseArgs(sampleSchema, ['--name', '-5']);
    expect(args.name).toBe('-5');
  });

  it('handles empty argv', () => {
    const { args, positionals } = parseArgs(sampleSchema, []);
    expect(args.name).toBeNull();
    expect(args.file).toBe('index.html');
    expect(positionals).toEqual([]);
  });

  it('string args without defaults are null', () => {
    const schema = [
      { name: 'foo', flag: '--foo', type: 'string' },
    ];
    const { args } = parseArgs(schema, []);
    expect(args.foo).toBeNull();
  });

  it('handles --flag=value with equals in value', () => {
    const { args } = parseArgs(sampleSchema, ['--name=my=app']);
    expect(args.name).toBe('my=app');
  });
});

describe('formatHelp', () => {
  const meta = {
    name: 'My Tool',
    description: 'A test tool for testing.',
    usage: 'node my-tool.js --name <name> [options]',
    examples: [
      '# Basic usage',
      'node my-tool.js --name myapp',
    ],
    notes: ['Note: This is a test tool.'],
  };

  it('includes tool name and description', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('My Tool');
    expect(help).toContain('A test tool for testing.');
  });

  it('includes usage line', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('node my-tool.js --name <name> [options]');
  });

  it('includes all flags', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('--name');
    expect(help).toContain('--file');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--verbose');
  });

  it('includes alias in output', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('-n, --name');
  });

  it('includes examples', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('node my-tool.js --name myapp');
  });

  it('includes notes', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('Note: This is a test tool.');
  });

  it('includes --help in default section', () => {
    const help = formatHelp(meta, sampleSchema);
    expect(help).toContain('--help');
  });

  it('uses sections when provided', () => {
    const metaWithSections = {
      ...meta,
      sections: [
        { title: 'Required', entries: [sampleSchema[0]] },
        { title: 'Optional', entries: [sampleSchema[1], sampleSchema[2]] },
      ],
    };
    const help = formatHelp(metaWithSections, sampleSchema);
    expect(help).toContain('Required:');
    expect(help).toContain('Optional:');
  });
});

describe('handleHelpAndErrors', () => {
  let exitSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  const meta = {
    name: 'Test',
    description: 'A test.',
    usage: 'test [options]',
  };

  it('prints help and exits on --help', () => {
    const parsed = parseArgs(sampleSchema, ['--help']);
    expect(() => handleHelpAndErrors(parsed, sampleSchema, { meta })).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalled();
  });

  it('prints errors and exits on unknown flags', () => {
    const parsed = parseArgs(sampleSchema, ['--bogus']);
    expect(() => handleHelpAndErrors(parsed, sampleSchema, { meta })).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Unknown flag: --bogus');
  });

  it('does nothing when no help or errors', () => {
    const parsed = parseArgs(sampleSchema, ['--name', 'foo']);
    handleHelpAndErrors(parsed, sampleSchema, { meta });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
