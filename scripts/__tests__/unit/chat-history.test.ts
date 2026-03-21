import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadHistory, appendMessage, clearHistory } from '../../server/chat-history.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '.tmp-chat-test');

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('chat-history', () => {
  it('returns empty array when no chat.json exists', () => {
    expect(loadHistory(join(TMP, 'no-app'))).toEqual([]);
  });

  it('appends messages and loads them back', () => {
    const dir = join(TMP, 'test-app');
    mkdirSync(dir, { recursive: true });
    appendMessage(dir, { role: 'user', content: 'hello' });
    appendMessage(dir, { role: 'assistant', content: 'hi' });
    const history = loadHistory(dir);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('hello');
    expect(history[0].timestamp).toBeTypeOf('number');
    expect(history[1].role).toBe('assistant');
  });

  it('clearHistory deletes chat.json', () => {
    const dir = join(TMP, 'clear-app');
    mkdirSync(dir, { recursive: true });
    appendMessage(dir, { role: 'user', content: 'test' });
    expect(existsSync(join(dir, 'chat.json'))).toBe(true);
    clearHistory(dir);
    expect(existsSync(join(dir, 'chat.json'))).toBe(false);
  });

  it('handles corrupt chat.json gracefully', () => {
    const dir = join(TMP, 'corrupt-app');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'chat.json'), 'NOT JSON');
    expect(loadHistory(dir)).toEqual([]);
  });
});
