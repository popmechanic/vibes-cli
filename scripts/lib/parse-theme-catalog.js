/**
 * Parse the theme catalog table from catalog.txt into a JSON array.
 * Extracts rows from the markdown table between "THEME CATALOG" and "HOW TO CHOOSE".
 */
export function parseThemeCatalog(text) {
  const lines = text.split('\n');
  const themes = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table rows: must start with | and contain at least 4 pipe-separated cells
    if (!trimmed.startsWith('|')) {
      if (inTable && themes.length > 0) break; // past the table
      continue;
    }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 4) continue;

    // Skip header row and separator rows
    if (cells[0] === 'Theme ID' || cells[0].startsWith('---')) continue;

    inTable = true;
    themes.push({
      id: cells[0],
      name: cells[1],
      mood: cells[2],
      bestFor: cells[3],
    });
  }

  return themes;
}
