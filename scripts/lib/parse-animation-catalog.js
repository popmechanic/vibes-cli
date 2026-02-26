/**
 * Parse the animation catalog table from catalog.txt into a JSON array.
 * Extracts rows from the markdown table with fields: id, name, category, description.
 */
export function parseAnimationCatalog(text) {
  const lines = text.split('\n');
  const animations = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table rows: must start with | and contain at least 4 pipe-separated cells
    if (!trimmed.startsWith('|')) {
      if (inTable && animations.length > 0) break; // past the table
      continue;
    }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 4) continue;

    // Skip header row and separator rows
    if (cells[0] === 'Animation ID' || cells[0].startsWith('---')) continue;

    inTable = true;
    animations.push({
      id: cells[0],
      name: cells[1],
      category: cells[2],
      description: cells[3],
    });
  }

  return animations;
}
