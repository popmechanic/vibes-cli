# Vibes Apps

Your personal gallery of Vibes DIY apps, automatically deployed to GitHub Pages.

## Setup

1. **Fork this repo** (or use it as a template)
2. **Enable GitHub Pages**: Go to Settings > Pages > Source: "GitHub Actions"
3. **Start creating apps!**

## Usage

### With Claude Code CLI

```bash
cd vibes-apps
claude "/vibes:vibes todo app"
# or
claude "/vibes:riff holiday themes 5"
```

### With Claude Code Desktop/Mobile

Just open this repo in Claude Code and ask to generate apps. They'll be pushed here automatically.

## Structure

```
vibes-apps/
├── my-app/              # Single app from /vibes:vibes
│   ├── index.html
│   └── app.jsx
├── holiday-riffs/       # Riff session from /vibes:riff
│   ├── index.html       # Gallery
│   ├── riff-1/
│   ├── riff-2/
│   └── riff-3/
└── index.html           # Landing page
```

## URLs

After pushing, your apps will be live at:
- `https://YOUR-USERNAME.github.io/vibes-apps/`
- `https://YOUR-USERNAME.github.io/vibes-apps/my-app/`
- `https://YOUR-USERNAME.github.io/vibes-apps/holiday-riffs/riff-1/`

Deployment typically takes 2-5 minutes.

## Powered by

- [Vibes DIY](https://vibes.diy) - The vibe coding web stack
- [Fireproof](https://fireproof.storage) - Local-first database
- [Claude Code](https://claude.ai/code) - AI-powered development
