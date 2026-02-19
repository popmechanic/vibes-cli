import { describe, it, expect } from 'vitest';
import { parseThemeCatalog } from '../../lib/parse-theme-catalog.js';

const SAMPLE_CATALOG = `
THEME CATALOG
---------------------

| Theme ID    | Name              | Mood                        | Best For                                                      |
|-------------|-------------------|-----------------------------|---------------------------------------------------------------|
| default     | Neo-Brutalist     | Bold, graphic, utilitarian  | General-purpose CRUD, dashboards, form-heavy apps             |
| archive     | Editorial Archive | Quiet, refined, documentary | Portfolios, catalogs, collections, galleries, timelines       |
| rift        | Rift Portal       | Sci-fi-neon, space-void, multi-accent, machine-framed | Fan sites, gaming hubs, media browsers, entertainment portals     |

HOW TO CHOOSE
-------------
`;

describe('parseThemeCatalog', () => {
  it('extracts theme rows from catalog text', () => {
    const themes = parseThemeCatalog(SAMPLE_CATALOG);
    expect(themes).toHaveLength(3);
    expect(themes[0]).toEqual({
      id: 'default',
      name: 'Neo-Brutalist',
      mood: 'Bold, graphic, utilitarian',
      bestFor: 'General-purpose CRUD, dashboards, form-heavy apps',
    });
    expect(themes[2].id).toBe('rift');
  });

  it('returns empty array for empty input', () => {
    expect(parseThemeCatalog('')).toEqual([]);
  });

  it('skips header and separator rows', () => {
    const themes = parseThemeCatalog(SAMPLE_CATALOG);
    const ids = themes.map(t => t.id);
    expect(ids).not.toContain('Theme ID');
    expect(ids).not.toContain('---');
  });
});
