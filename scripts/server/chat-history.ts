import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export function loadHistory(appDir: string): ChatMessage[] {
  const path = join(appDir, 'chat.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendMessage(appDir: string, msg: Omit<ChatMessage, 'timestamp'>): void {
  mkdirSync(appDir, { recursive: true });
  const history = loadHistory(appDir);
  history.push({ ...msg, timestamp: Date.now() });
  try {
    writeFileSync(join(appDir, 'chat.json'), JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('[chat-history] Write failed:', err);
  }
}

export function clearHistory(appDir: string): void {
  const path = join(appDir, 'chat.json');
  try { unlinkSync(path); } catch {}
}
