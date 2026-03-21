/**
 * Tests for prompt builder functions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildChatPrompt, buildGeneratePrompt, buildThemePromptMultiPass, buildThemePromptLegacy, extractDataSchema } from '../../server/prompt-builders.ts';

const TMP = join(import.meta.dirname, '.tmp-prompt-test');

function makeCtx(overrides = {}) {
  return {
    projectRoot: TMP,
    appsDir: TMP,
    pluginSkills: [],
    animations: [],
    themes: [],
    themeColors: {},
    themeRootCss: {},
    themeDir: join(TMP, 'themes'),
    animationDir: join(TMP, 'animations'),
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(join(TMP, 'test-app'), { recursive: true });
  mkdirSync(join(TMP, 'themes'), { recursive: true });
  mkdirSync(join(TMP, 'animations'), { recursive: true });
  mkdirSync(join(TMP, 'skills', 'vibes', 'defaults'), { recursive: true });
  writeFileSync(join(TMP, 'test-app', 'app.jsx'), 'export default function App() { return <div>Hello</div>; }');
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('buildChatPrompt', () => {
  it('includes user message and RULES', () => {
    const ctx = makeCtx();
    const prompt = buildChatPrompt(ctx as any, 'add a button', { appName: 'test-app' });
    expect(prompt).toContain('add a button');
    expect(prompt).toContain('RULES');
    expect(prompt).toContain('Read app.jsx');
  });

  it('does not include AI instructions when app has no useAI', () => {
    const ctx = makeCtx();
    const prompt = buildChatPrompt(ctx as any, 'fix something', { appName: 'test-app' });
    expect(prompt).not.toContain('useAI()');
  });

  it('includes AI instructions when app uses useAI', () => {
    writeFileSync(join(TMP, 'test-app', 'app.jsx'), 'const { callAI } = useAI(); export default App;');
    const ctx = makeCtx();
    const prompt = buildChatPrompt(ctx as any, 'add AI', { appName: 'test-app' });
    expect(prompt).toContain('useAI()');
    expect(prompt).toContain('callAI');
  });

  it('includes animation instructions when animationId provided', () => {
    const animFile = join(TMP, 'animations', 'glow.txt');
    writeFileSync(animFile, 'Add a glowing effect to all elements.');
    const ctx = makeCtx({
      animations: [{ id: 'glow', name: 'Glow Effect' }],
    });
    const prompt = buildChatPrompt(ctx as any, 'do something', { animationId: 'glow', appName: 'test-app' });
    expect(prompt).toContain('ANIMATION MODIFIER');
    expect(prompt).toContain('Glow Effect');
    expect(prompt).toContain('Add a glowing effect');
  });

  it('includes effect instructions for legacy effects', () => {
    const ctx = makeCtx();
    const prompt = buildChatPrompt(ctx as any, 'style it', { effects: ['particles'], appName: 'test-app' });
    expect(prompt).toContain('EFFECT MODIFIERS');
    expect(prompt).toContain('Canvas 2D particle system');
  });

  it('includes skill context when skillId provided', () => {
    const skillMdPath = join(TMP, 'test-skill.md');
    writeFileSync(skillMdPath, '---\nname: Test Skill\n---\n\nDo the thing.');
    const ctx = makeCtx({
      pluginSkills: [{ id: 'test/skill', name: 'Test Skill', pluginName: 'test', skillMdPath }],
    });
    const prompt = buildChatPrompt(ctx as any, 'apply skill', { skillId: 'test/skill', appName: 'test-app' });
    expect(prompt).toContain('SKILL CONTEXT');
    expect(prompt).toContain('Test Skill');
    expect(prompt).toContain('Do the thing.');
  });

  it('returns a string (not a promise)', () => {
    const ctx = makeCtx();
    const result = buildChatPrompt(ctx as any, 'test', { appName: 'test-app' });
    expect(typeof result).toBe('string');
  });
});

describe('buildGeneratePrompt', () => {
  it('returns prompt, themeId, and themeName for normal theme path', () => {
    const ctx = makeCtx({
      themes: [{ id: 'brutalist', name: 'Brutalist' }],
    });
    const result = buildGeneratePrompt(ctx as any, 'todo list', { themeId: 'brutalist' });
    expect(result.prompt).toContain('todo list');
    expect(result.prompt).toContain('Brutalist');
    expect(result.themeId).toBe('brutalist');
    expect(result.themeName).toBe('Brutalist');
    expect(result.isReference).toBe(false);
  });

  it('returns reference path when reference provided', () => {
    const htmlContent = '<html><body style="background: red;">Hello</body></html>';
    const base64 = Buffer.from(htmlContent).toString('base64');
    const ctx = makeCtx();
    const result = buildGeneratePrompt(ctx as any, 'make it pretty', {
      reference: { name: 'design.html', dataUrl: `data:text/html;base64,${base64}`, intent: 'match' },
    });
    expect(result.isReference).toBe(true);
    expect(result.isHtmlRef).toBe(true);
    expect(result.themeId).toBe('custom-ref');
    expect(result.prompt).toContain('DESIGN REFERENCE');
    expect(result.prompt).toContain('Hello');
  });

  it('includes TinyBase database instructions', () => {
    const ctx = makeCtx({
      themes: [{ id: 'default', name: 'Default' }],
    });
    const result = buildGeneratePrompt(ctx as any, 'build app', { themeId: 'default' });
    expect(result.prompt).toContain('useRowIds');
    expect(result.prompt).toContain('useAddRowCallback');
    expect(result.prompt).toContain('NON-NEGOTIABLE DATA RULES');
  });

  it('includes AI instructions when useAI is true', () => {
    const ctx = makeCtx({
      themes: [{ id: 'default', name: 'Default' }],
    });
    const result = buildGeneratePrompt(ctx as any, 'ai app', { themeId: 'default', useAI: true });
    expect(result.prompt).toContain('AI FEATURES');
    expect(result.prompt).toContain('callAI');
  });

  it('does not include AI instructions when useAI is false', () => {
    const ctx = makeCtx({
      themes: [{ id: 'default', name: 'Default' }],
    });
    const result = buildGeneratePrompt(ctx as any, 'simple app', { themeId: 'default', useAI: false });
    expect(result.prompt).not.toContain('AI FEATURES');
  });
});

describe('buildThemePromptMultiPass', () => {
  it('includes theme name and marker instructions', () => {
    const ctx = makeCtx();
    const prompt = buildThemePromptMultiPass(
      ctx as any,
      'neon',
      'Neon Glow',
      'MOOD: dark, electric\nDESCRIPTION:\nGlowing neon effects.',
      'function App() { return <div>test</div>; }'
    );
    expect(prompt).toContain('Neon Glow');
    expect(prompt).toContain('@theme:surfaces');
    expect(prompt).toContain('@theme:motion');
    expect(prompt).toContain('@theme:decoration');
    expect(prompt).toContain('CURRENT app.jsx');
  });

  it('includes data schema when app has TinyBase hooks', () => {
    const appCode = `
      const ids = useRowIds('todos');
      const text = useCell('todos', id, 'title');
    `;
    const ctx = makeCtx();
    const prompt = buildThemePromptMultiPass(ctx as any, 'test', 'Test', 'MOOD: calm', appCode);
    expect(prompt).toContain('DATA SCHEMA');
    expect(prompt).toContain('Table: "todos"');
    expect(prompt).toContain('Table "todos" has cell: "title"');
  });
});

describe('buildThemePromptLegacy', () => {
  it('includes theme name and rootCss', () => {
    const ctx = makeCtx();
    const colors = { rootBlock: ':root { --comp-bg: oklch(0.1 0 0); }' };
    const prompt = buildThemePromptLegacy(
      ctx as any,
      'retro',
      'Retro Wave',
      'MOOD: retro, warm\nDESCRIPTION:\nRetro vibes.',
      'function App() { return <div>app</div>; }',
      colors
    );
    expect(prompt).toContain('Retro Wave');
    expect(prompt).toContain('--comp-bg: oklch(0.1 0 0)');
    expect(prompt).toContain('CURRENT app.jsx');
    expect(prompt).toContain('MANDATORY CSS CHANGES');
  });

  it('generates placeholder when no rootCss available', () => {
    const ctx = makeCtx();
    const prompt = buildThemePromptLegacy(
      ctx as any,
      'minimal',
      'Minimal',
      'MOOD: clean',
      'function App() { return <div>app</div>; }',
      null
    );
    expect(prompt).toContain('Build :root with oklch colors matching "Minimal"');
  });
});

describe('extractDataSchema', () => {
  it('returns empty string for code with no hooks', () => {
    expect(extractDataSchema('const x = 1;')).toBe('');
  });

  it('extracts table names from useRowIds', () => {
    const result = extractDataSchema("const ids = useRowIds('notes');");
    expect(result).toContain('Table: "notes"');
  });

  it('extracts cell names from useCell', () => {
    const result = extractDataSchema("const title = useCell('tasks', id, 'title');");
    expect(result).toContain('Table "tasks" has cell: "title"');
  });

  it('extracts value names from useValue', () => {
    const result = extractDataSchema("const mode = useValue('darkMode');");
    expect(result).toContain('Value: "darkMode"');
  });

  it('deduplicates entries', () => {
    const code = "useRowIds('todos'); useRowIds('todos');";
    const result = extractDataSchema(code);
    const matches = result.match(/Table: "todos"/g);
    expect(matches).toHaveLength(1);
  });

  it('returns empty string for empty input', () => {
    expect(extractDataSchema('')).toBe('');
  });
});
