#!/usr/bin/env node
/**
 * generate-riff.js - Zero-token parallel riff generation
 *
 * Calls `claude -p` to generate a Vibes app using subscription tokens,
 * then writes directly to disk. Main agent only sees "✓ filename".
 *
 * Usage: node generate-riff.js <theme> <lens> <output-path>
 * Example: node generate-riff.js "existential apps" 1 riff-1/app.jsx
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [,, theme, lens, outputPath] = process.argv;

if (!theme || !lens || !outputPath) {
  console.error('Usage: node generate-riff.js <theme> <lens> <output-path>');
  process.exit(1);
}

const lensDescriptions = {
  '1': 'Minimalist - clean, focused, essential features only',
  '2': 'Social - community, sharing, collaboration features',
  '3': 'Gamified - points, achievements, streaks, rewards',
  '4': 'Professional - B2B, productivity, enterprise features',
  '5': 'Personal - individual use, private, self-improvement',
  '6': 'Marketplace - buying, selling, transactions',
  '7': 'Educational - learning, tutorials, knowledge sharing',
  '8': 'Creative - art, expression, content creation',
  '9': 'Wildcard - unexpected, experimental, unconventional'
};

const lensDesc = lensDescriptions[lens] || lensDescriptions['9'];

const prompt = `You are generating a Vibes app. First, THINK about the theme and how to express it visually.

Theme: ${theme}
Lens: ${lensDesc}

First, reason about the theme in <reasoning> tags:
- What colors, gradients, and visual mood fit this theme?
- What icons, imagery, or decorative elements would enhance it?
- What kind of app functionality matches this theme?
- How can the UI feel immersive and thematic?

Then output your complete code in <code> tags.

CRITICAL: Use plain JavaScript only. NEVER use TypeScript syntax:
- NO generics: useState<T>, useDocument<T>, Array<T>
- NO type annotations: const x: string, function(x: number)
- NO interfaces or type aliases
- NO "as" assertions: (x as any)

Your code must follow this structure:
/*BUSINESS
name: [Creative App Name that fits the theme]
pitch: [One sentence value proposition]
customer: [Target user persona]
revenue: [Pricing/monetization model]
*/
import React, { useState } from "react";
import { useFireproof } from "use-fireproof";

export default function App() {
  const { useLiveQuery, useDocument } = useFireproof("riff-db");
  // Your implementation
  return (
    <div className="min-h-screen [theme-appropriate-background] p-4">
      {/* Theme-driven UI */}
    </div>
  );
}

Requirements:
- The theme should drive ALL visual choices (colors, backgrounds, icons, mood)
- Use Tailwind CSS for styling
- Use useFireproof for all data persistence
- Use useLiveQuery for real-time data
- Use useDocument for form state (NOT useState for form data)
- Include meaningful CRUD operations
- Make it visually distinctive and immersive`;

try {
  // Escape the prompt for shell
  const escapedPrompt = prompt.replace(/`/g, '\\`').replace(/\$/g, '\\$');

  const output = execSync(`claude -p "${escapedPrompt}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    timeout: 300000 // 5 minute timeout
  });

  // Extract reasoning if present
  const reasoningMatch = output.match(/<reasoning>([\s\S]*?)<\/reasoning>/);

  // Extract code from <code> tags
  let cleanCode = '';
  const codeMatch = output.match(/<code>([\s\S]*?)<\/code>/);

  if (codeMatch) {
    cleanCode = codeMatch[1].trim();
  } else {
    // Fallback: try markdown code blocks
    const markdownMatch = output.match(/```(?:jsx|javascript|js)?\s*([\s\S]*?)```/);
    if (markdownMatch) {
      cleanCode = markdownMatch[1].trim();
    } else {
      // Fallback: find code start
      const trimmed = output.trim();
      if (trimmed.startsWith('/*') || trimmed.startsWith('import')) {
        cleanCode = trimmed;
      } else {
        const businessMatch = trimmed.match(/(\/\*BUSINESS[\s\S]*)/);
        const importMatch = trimmed.match(/(import\s+[\s\S]*)/);
        cleanCode = businessMatch ? businessMatch[1] : (importMatch ? importMatch[1] : trimmed);
      }
    }
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Write the generated code
  fs.writeFileSync(outputPath, cleanCode);

  // Save reasoning for debugging if present
  if (reasoningMatch) {
    const reasoningPath = outputPath.replace(/\.jsx$/, '.reasoning.md');
    fs.writeFileSync(reasoningPath, `# Reasoning for ${path.basename(outputPath)}\n\n${reasoningMatch[1].trim()}`);
  }

  console.log(`✓ ${outputPath}`);
} catch (err) {
  console.error(`✗ ${outputPath}: ${err.message}`);
  process.exit(1);
}
