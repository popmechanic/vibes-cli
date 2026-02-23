/**
 * Component Catalog — Pre-styled neo-brutalist components
 *
 * These components come with DEFAULT CSS from design-tokens.js (cream bg,
 * dark borders, brutalist shadows, colored accents). The LLM can use them
 * as-is or override styles with design tokens for custom themes.
 *
 * To update: edit here, then run:
 *   node scripts/build-design-tokens.js --force
 */

export const COMPONENT_CATALOG = {
  button: `<button class="btn" type="button">Button</button>`,

  card: [
    `<div class="card">`,
    `  <div class="card-header">`,
    `    <h3 class="card-title">Card Title</h3>`,
    `    <p class="card-description">Card description</p>`,
    `  </div>`,
    `  <div class="card-content">Card content goes here</div>`,
    `  <div class="card-footer">Card footer</div>`,
    `</div>`,
  ].join('\n'),

  input: `<input class="input" type="text" placeholder="Type here..." />`,

  label: `<label class="label">Label</label>`,

  textarea: `<textarea class="textarea" placeholder="Type here..." rows="4"></textarea>`,

  badge: `<span class="badge">Badge</span>`,

  separator: `<hr class="separator" />`,

  alert: [
    `<div class="alert" role="alert">`,
    `  <h5 class="alert-title">Alert Title</h5>`,
    `  <div class="alert-description">Alert description goes here</div>`,
    `</div>`,
  ].join('\n'),

  avatar: [
    `<span class="avatar">`,
    `  <img class="avatar-image" src="" alt="Avatar" />`,
    `  <span class="avatar-fallback">AB</span>`,
    `</span>`,
  ].join('\n'),

  switch: [
    `<button class="switch" role="switch" aria-checked="false">`,
    `  <span class="switch-thumb"></span>`,
    `</button>`,
  ].join('\n'),

  checkbox: `<input class="checkbox" type="checkbox" />`,

  select: [
    `<select class="select">`,
    `  <option value="">Select an option</option>`,
    `  <option value="option1">Option 1</option>`,
    `  <option value="option2">Option 2</option>`,
    `</select>`,
  ].join('\n'),

  table: [
    `<table class="table">`,
    `  <thead class="table-header">`,
    `    <tr class="table-row">`,
    `      <th class="table-head">Header 1</th>`,
    `      <th class="table-head">Header 2</th>`,
    `      <th class="table-head">Header 3</th>`,
    `    </tr>`,
    `  </thead>`,
    `  <tbody class="table-body">`,
    `    <tr class="table-row">`,
    `      <td class="table-cell">Cell 1</td>`,
    `      <td class="table-cell">Cell 2</td>`,
    `      <td class="table-cell">Cell 3</td>`,
    `    </tr>`,
    `  </tbody>`,
    `</table>`,
  ].join('\n'),

  tabs: [
    `<div class="tabs">`,
    `  <div class="tabs-list" role="tablist">`,
    `    <button class="tabs-trigger" role="tab" aria-selected="true">Tab 1</button>`,
    `    <button class="tabs-trigger" role="tab" aria-selected="false">Tab 2</button>`,
    `  </div>`,
    `  <div class="tabs-content" role="tabpanel">Tab content 1</div>`,
    `</div>`,
  ].join('\n'),

  accordion: [
    `<div class="accordion">`,
    `  <details class="accordion-item">`,
    `    <summary class="accordion-trigger">Section 1</summary>`,
    `    <div class="accordion-content">Content 1</div>`,
    `  </details>`,
    `  <details class="accordion-item">`,
    `    <summary class="accordion-trigger">Section 2</summary>`,
    `    <div class="accordion-content">Content 2</div>`,
    `  </details>`,
    `</div>`,
  ].join('\n'),

  dialog: [
    `<dialog class="dialog">`,
    `  <div class="dialog-header">`,
    `    <h2 class="dialog-title">Dialog Title</h2>`,
    `    <p class="dialog-description">Dialog description</p>`,
    `  </div>`,
    `  <div class="dialog-content">Dialog content</div>`,
    `  <div class="dialog-footer">Dialog footer</div>`,
    `</dialog>`,
  ].join('\n'),

  progress: `<progress class="progress" value="50" max="100"></progress>`,

  skeleton: `<div class="skeleton" aria-hidden="true">&nbsp;</div>`,

  'navigation-menu': [
    `<nav class="nav">`,
    `  <ul class="nav-list">`,
    `    <li class="nav-item"><a class="nav-link" href="#">Link 1</a></li>`,
    `    <li class="nav-item"><a class="nav-link" href="#">Link 2</a></li>`,
    `    <li class="nav-item"><a class="nav-link" href="#">Link 3</a></li>`,
    `  </ul>`,
    `</nav>`,
  ].join('\n'),

  'dropdown-menu': [
    `<div class="dropdown">`,
    `  <button class="dropdown-trigger" type="button">Open Menu</button>`,
    `  <div class="dropdown-content" role="menu" hidden>`,
    `    <button class="dropdown-item" role="menuitem">Item 1</button>`,
    `    <button class="dropdown-item" role="menuitem">Item 2</button>`,
    `    <hr class="separator" />`,
    `    <button class="dropdown-item" role="menuitem">Item 3</button>`,
    `  </div>`,
    `</div>`,
  ].join('\n'),

  tooltip: `<span class="tooltip" title="Tooltip text">Hover me</span>`,

  sheet: [
    `<dialog class="sheet">`,
    `  <div class="sheet-header">`,
    `    <h2 class="sheet-title">Sheet Title</h2>`,
    `    <p class="sheet-description">Sheet description</p>`,
    `  </div>`,
    `  <div class="sheet-content">Sheet content</div>`,
    `</dialog>`,
  ].join('\n'),
};

/**
 * Generate the component catalog documentation for the AI
 */
export function generateComponentDocs() {
  const availableNames = Object.keys(COMPONENT_CATALOG).join(', ');

  const lines = [
    ``,
    `---`,
    ``,
    `## Component Catalog (Pre-styled Neo-Brutalist)`,
    ``,
    `These components have **default CSS** (cream bg, dark borders, brutalist shadows,`,
    `colored title bars). Use them as-is or override with design tokens for custom themes.`,
    ``,
    `Available components: ${availableNames}`,
    ``,
    `### How to Use`,
    ``,
    `1. Pick components from the catalog below — they already have neo-brutalist styling`,
    `2. Override styles with \`var(--token-name)\` references for custom themes`,
    `3. Use \`className="grid-background"\` on your app's root container for the default grid background`,
    `4. Use \`className="btn"\` for buttons (variants: \`btn-red\`, \`btn-yellow\`, \`btn-gray\`)`,
    `5. Use \`className="card"\` for cards (variants: \`card-red\`, \`card-yellow\`, \`card-gray\`)`,
    `6. Use \`className="badge"\` for badges (variants: \`badge-blue\`, \`badge-red\`, \`badge-yellow\`, \`badge-gray\`)`,
    `7. Use \`className="alert"\` for alerts (variants: \`alert-red\`, \`alert-yellow\`, \`alert-gray\`)`,
    ``,
    `### Layout Utility`,
    ``,
    `\`\`\`html`,
    `<!-- Wrap your app root in grid-background for the default content grid -->`,
    `<div class="grid-background">`,
    `  <!-- Your app content here -->`,
    `</div>`,
    `\`\`\``,
    ``,
    `### Default Style Summary`,
    ``,
    `All components follow the neo-brutalist vibes.diy visual style:`,
    `- **Background**: cream (\`--comp-bg\` → \`--vibes-cream: #fffff0\`)`,
    `- **Borders**: 2px solid dark (\`--comp-border\` → \`--vibes-near-black: #1a1a1a\`)`,
    `- **Border radius**: 12px (cards, dialogs) or 8px (inputs, buttons)`,
    `- **Shadows**: solid offset (\`4px 4px 0px 0px\`) — brutalist style`,
    `- **Title bars**: colored accent (\`--comp-accent\` → \`--vibes-variant-blue\`)`,
    `- **Typography**: uppercase, bold, letterspaced headers`,
    `- **Focus states**: accent brutalist shadow on inputs`,
    ``,
    `### Theming: Override \`--comp-*\` tokens`,
    ``,
    `Components use \`--comp-*\` tokens (NOT \`--vibes-*\`). Override \`--comp-*\` in your`,
    `\`:root\` block to theme components without breaking the wrapper UI (menu, auth screen).`,
    ``,
    `\`\`\`css`,
    `/* Dark theme: override comp tokens in :root */`,
    `:root {`,
    `  --comp-bg: oklch(0.20 0.04 235);        /* dark surface */`,
    `  --comp-text: oklch(0.90 0.02 200);       /* light text */`,
    `  --comp-border: oklch(0.30 0.05 230);     /* subtle border */`,
    `  --comp-accent: oklch(0.55 0.18 200);     /* teal accent */`,
    `  --comp-accent-text: oklch(0.95 0.01 200); /* white on accent */`,
    `  --comp-muted: oklch(0.50 0.03 220);      /* placeholder text */`,
    `}`,
    `\`\`\``,
    ``,
    `### Components`,
    ``,
  ];

  for (const [name, html] of Object.entries(COMPONENT_CATALOG)) {
    lines.push(`#### ${name}`);
    lines.push(``);
    lines.push('```html');
    lines.push(html);
    lines.push('```');
    lines.push(``);
  }

  return lines.join('\n');
}
