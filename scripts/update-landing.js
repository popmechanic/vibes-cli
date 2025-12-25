#!/usr/bin/env node
/**
 * update-landing.js - Generate landing page for vibes-apps repo
 *
 * Scans the repo for app folders and riff sessions, generates a pretty
 * index.html with links to all apps.
 *
 * Usage: node update-landing.js [directory]
 * Default: current directory
 */

import fs from 'fs';
import path from 'path';

const rootDir = process.argv[2] || '.';

// Find all app folders (contain index.html but not .github, node_modules, etc.)
const ignoreDirs = ['.git', '.github', 'node_modules', 'template-repo', 'scripts', 'skills', 'agents', 'cache'];

function scanApps(dir) {
  const apps = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (ignoreDirs.includes(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const folderPath = path.join(dir, entry.name);
    const indexPath = path.join(folderPath, 'index.html');

    if (fs.existsSync(indexPath)) {
      // Check if it's a riff session (has riff-1, riff-2, etc.)
      const subfolders = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('riff-'));

      if (subfolders.length > 0) {
        // It's a riff session
        const riffs = subfolders.map(r => ({
          name: r.name,
          path: `${entry.name}/${r.name}/`
        }));

        // Try to read pitch.md from first riff for description
        let description = 'Riff session';
        const pitchPath = path.join(folderPath, 'riff-1', 'pitch.md');
        if (fs.existsSync(pitchPath)) {
          const pitch = fs.readFileSync(pitchPath, 'utf-8');
          const firstLine = pitch.split('\n').find(l => l.trim() && !l.startsWith('#'));
          if (firstLine) description = firstLine.trim().slice(0, 100);
        }

        apps.push({
          type: 'riff-session',
          name: entry.name,
          path: `${entry.name}/`,
          description,
          riffCount: riffs.length,
          riffs
        });
      } else {
        // It's a single app
        let description = 'Vibes app';

        // Try to extract name from app.jsx BUSINESS comment
        const appJsxPath = path.join(folderPath, 'app.jsx');
        if (fs.existsSync(appJsxPath)) {
          const appCode = fs.readFileSync(appJsxPath, 'utf-8');
          const pitchMatch = appCode.match(/pitch:\s*(.+)/i);
          if (pitchMatch) description = pitchMatch[1].trim();
        }

        apps.push({
          type: 'app',
          name: entry.name,
          path: `${entry.name}/`,
          description
        });
      }
    }
  }

  return apps;
}

function generateHTML(apps) {
  const appCards = apps.map(app => {
    if (app.type === 'riff-session') {
      return `
        <div class="glass rounded-2xl p-6 hover:scale-[1.02] transition-transform">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-2xl">🎯</span>
            <h3 class="text-xl font-bold text-white">${app.name}</h3>
            <span class="ml-auto px-2 py-1 bg-purple-500/30 rounded-full text-xs text-purple-300">${app.riffCount} riffs</span>
          </div>
          <p class="text-gray-400 text-sm mb-4">${app.description}</p>
          <a href="${app.path}" class="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-medium">
            View Gallery <span>→</span>
          </a>
        </div>`;
    } else {
      return `
        <div class="glass rounded-2xl p-6 hover:scale-[1.02] transition-transform">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-2xl">⚡</span>
            <h3 class="text-xl font-bold text-white">${app.name}</h3>
          </div>
          <p class="text-gray-400 text-sm mb-4">${app.description}</p>
          <a href="${app.path}" class="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-medium">
            Launch App <span>→</span>
          </a>
        </div>`;
    }
  }).join('\n');

  const emptyState = apps.length === 0 ? `
      <div class="glass rounded-2xl p-8 text-center">
        <p class="text-gray-400">
          No apps yet. Generate your first app with <code class="bg-white/10 px-2 py-1 rounded">/vibes:vibes</code>
          or <code class="bg-white/10 px-2 py-1 rounded">/vibes:riff</code>
        </p>
      </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Vibes Apps</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%); }
    .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
    .glow { box-shadow: 0 0 30px rgba(139, 92, 246, 0.3); }
  </style>
</head>
<body class="min-h-screen text-white p-8">
  <div class="max-w-4xl mx-auto">
    <header class="text-center mb-12">
      <h1 class="text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-cyan-400 bg-clip-text text-transparent mb-4">
        My Vibes Apps
      </h1>
      <p class="text-gray-400">Generated with Vibes DIY</p>
      <p class="text-gray-500 text-sm mt-2">${apps.length} app${apps.length !== 1 ? 's' : ''}</p>
    </header>

    <div class="grid gap-6 md:grid-cols-2">
      ${appCards}
      ${emptyState}
    </div>

    <footer class="text-center mt-12 text-gray-500 text-sm">
      <p>Powered by <a href="https://vibes.diy" class="text-purple-400 hover:underline">Vibes DIY</a></p>
    </footer>
  </div>
</body>
</html>`;
}

// Main
const apps = scanApps(rootDir);
const html = generateHTML(apps);
const outputPath = path.join(rootDir, 'index.html');
fs.writeFileSync(outputPath, html);

console.log(`✓ Updated ${outputPath} with ${apps.length} app(s)`);
apps.forEach(app => {
  if (app.type === 'riff-session') {
    console.log(`  - ${app.name}/ (${app.riffCount} riffs)`);
  } else {
    console.log(`  - ${app.name}/`);
  }
});
