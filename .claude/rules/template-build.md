---
globs:
  - source-templates/**
  - scripts/build-*.js
  - scripts/merge-templates.js
  - scripts/lib/design-tokens.js
  - scripts/lib/component-catalog.js
  - scripts/lib/component-transforms.js
  - components/**
description: Template inheritance build system
---

# Template Build System

Templates use a DRY inheritance pattern:

```
components/ → build-components.js → build/vibes-menu.js
scripts/lib/design-tokens.js → build-design-tokens.js → build/design-tokens.css + .txt
source-templates/base/template.html + skills/*/template.delta.html
    → merge-templates.js → skills/*/templates/index.html
```

## Build Commands

```bash
node scripts/build-components.js --force     # Components → build/vibes-menu.js
node scripts/build-design-tokens.js --force  # Tokens → build/design-tokens.css + .txt
node scripts/merge-templates.js --force      # Base + tokens + deltas → final templates
```

## Key Rules

- `skills/*/templates/*.html` are **generated** — don't edit directly, edit the source and rebuild
- `source-templates/base/template.html` has shared code (import map, CSS, component injection points)
- `skills/*/template.delta.html` has skill-specific code only
- `build/` is gitignored; `skills/*/defaults/` is git-tracked
