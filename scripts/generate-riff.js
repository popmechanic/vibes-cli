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

const prompt = `OUTPUT ONLY CODE. NO EXPLANATIONS. NO MARKDOWN. NO CONVERSATION.

Generate this exact structure with your implementation:
/*BUSINESS
name: [Creative App Name]
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
    <div className="min-h-screen bg-[#f1f5f9] p-4">
      {/* Neo-brutalist UI */}
    </div>
  );
}

Theme: ${theme}
Lens: ${lensDesc}
Style: Tailwind CSS with neo-brutalist aesthetic (bold borders, shadows, high contrast)

Requirements:
- Use JavaScript only. NO TypeScript syntax (no type annotations, no generics like useState<T>, no 'as' type assertions)
- Use useFireproof for all data persistence
- Use useLiveQuery for real-time data
- Use useDocument for form state (NOT useState for form data)
- Include meaningful CRUD operations
- Make it visually distinctive and functional`;

try {
  // Escape the prompt for shell
  const escapedPrompt = prompt.replace(/`/g, '\\`').replace(/\$/g, '\\$');

  const code = execSync(`claude -p "${escapedPrompt}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    timeout: 300000 // 5 minute timeout
  });

  // Extract code from markdown if wrapped in ```jsx or ```javascript blocks
  let cleanCode = code.trim();

  // Try to extract from code blocks
  const codeBlockMatch = cleanCode.match(/```(?:jsx|javascript|js)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanCode = codeBlockMatch[1].trim();
  }

  // If it starts with conversational text (no code), try to find where code starts
  if (!cleanCode.startsWith('/*') && !cleanCode.startsWith('import') && !cleanCode.startsWith('//')) {
    // Look for the BUSINESS comment or import statement
    const businessMatch = cleanCode.match(/(\/\*BUSINESS[\s\S]*)/);
    const importMatch = cleanCode.match(/(import\s+[\s\S]*)/);

    if (businessMatch) {
      cleanCode = businessMatch[1];
    } else if (importMatch) {
      cleanCode = importMatch[1];
    }
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Write the generated code
  fs.writeFileSync(outputPath, cleanCode);

  console.log(`✓ ${outputPath}`);
} catch (err) {
  console.error(`✗ ${outputPath}: ${err.message}`);
  process.exit(1);
}
