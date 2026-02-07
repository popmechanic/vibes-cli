---
name: vibes
description: Generate a React web app with Fireproof database
argument-hint: "[prompt]"
---

# Vibes: Generate a Web App

Generate a single-page React app with Fireproof for local-first data persistence.

## Usage

```bash
/vibes:vibes "todo list with categories"
/vibes:vibes
```

## Arguments

- **prompt** (optional): Description of the app to build. If omitted, you'll be asked interactively.

## What It Creates

- **app.jsx** with React components and Fireproof data hooks
- Ready for assembly into a deployable `index.html`

## After Generation

Assemble and deploy your app:

```bash
node scripts/assemble.js app.jsx index.html
```

## Related

- `/vibes:design` - Transform an existing HTML mockup instead
- `/vibes:riff` - Generate multiple variations to compare
- `/vibes:sell` - Transform into multi-tenant SaaS
- `/vibes:exe` - Deploy to exe.dev
