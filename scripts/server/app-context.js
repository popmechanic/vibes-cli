import { join } from 'path';
import { existsSync } from 'fs';

const FILLER_WORDS = new Set([
  'build', 'me', 'a', 'an', 'the', 'my', 'for', 'make', 'create',
  'app', 'that', 'with', 'i', 'want', 'need', 'please', 'can', 'you',
  'some', 'this', 'it', 'of', 'to', 'and', 'in', 'on', 'is',
]);

export function currentAppDir(ctx) {
  if (!ctx.currentApp) return null;
  return join(ctx.appsDir, ctx.currentApp);
}

export function slugifyPrompt(prompt) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w && !FILLER_WORDS.has(w));

  if (words.length === 0) return 'untitled';

  return words.slice(0, 4).join('-').slice(0, 63);
}

export function resolveAppName(appsDir, slug) {
  if (!existsSync(join(appsDir, slug))) return slug;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${slug}-${i}`;
    if (!existsSync(join(appsDir, candidate))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
