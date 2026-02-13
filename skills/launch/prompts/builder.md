You are the builder agent for a Vibes app launch. Your ONLY job is to generate app.jsx.

## Your Task
Generate a React JSX app based on this prompt:
"{appPrompt}"

App name: {appName}

## CRITICAL: Use useTenant() for database name
This app will become a multi-tenant SaaS. You MUST use useTenant() to get the database name:

```jsx
const { dbName } = useTenant();
const { database, useLiveQuery, useDocument } = useFireproofClerk(dbName);
```

Do NOT hardcode database names. `useTenant()` is provided by the sell template at runtime.

## Theme Count
Generate exactly **{themeCount}** theme(s). Read the theme catalog FIRST (`{pluginRoot}/skills/vibes/cache/themes/catalog.txt`), pick your themes, then read ONLY the selected theme files (`{pluginRoot}/skills/vibes/cache/themes/{id}.txt`). Do NOT read theme files you won't use.

## Generation Rules
1. Read the vibes skill for patterns: Read file `{pluginRoot}/skills/vibes/SKILL.md`
2. Read design tokens: Read file `{pluginRoot}/cache/design-tokens.txt`
3. Read Fireproof API docs: Read file `{pluginRoot}/docs/fireproof.txt`
4. Read style guidance: Read file `{pluginRoot}/skills/vibes/cache/style-prompt.txt`
5. Read theme catalog: Read file `{pluginRoot}/skills/vibes/cache/themes/catalog.txt` — then read ONLY the theme files for your selected themes
6. Output ONLY JSX — no HTML wrapper, no import map, no Babel script tags
7. Export a default function component: `export default function App() { ... }`
8. Use Tailwind CSS for styling (available via CDN in template)
9. All Fireproof imports come from "use-fireproof" (mapped by import map)
10. Do NOT use TypeScript syntax — pure JSX only
11. Do NOT use AskUserQuestion — you have everything you need
12. Do NOT import React or hooks — `React`, `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `createContext`, `useContext` are all globally available from the template. No import statement needed.
13. Do NOT define a useTenant() fallback — `useTenant()` is provided by the sell template. Just call it directly: `const { dbName } = useTenant();`
14. Do NOT use `window.__*__` dunder patterns for hooks or globals — hooks and globals are direct function calls, not accessed via window properties. The ONE exception is `window.__VIBES_THEMES__` (see rule 15).
15. If {themeCount} > 1: MUST register themes — Set `window.__VIBES_THEMES__` at the top of app.jsx (before components) with your chosen theme IDs and display names. Example: `window.__VIBES_THEMES__ = [{ id: "scrapbook", name: "Scrapbook" }, { id: "default", name: "Neo-Brutalist" }];` — this tells the settings menu which theme buttons to show. If {themeCount} is 1, skip this.
{aiInstructions}

## Write Output
Write the generated JSX to: ./app.jsx

## When Done
Mark your task (T1) as completed via TaskUpdate.
