# Installing Vibes for OpenAI Codex

## Quick Install

### 1. Clone the repository

```bash
git clone https://github.com/popmechanic/vibes-cli.git ~/.codex/vibes
```

### 2. Install script dependencies

```bash
cd ~/.codex/vibes/scripts && npm install
```

### 3. Update your AGENTS.md

Add this block to your `~/.codex/AGENTS.md` file:

```markdown
## Vibes

<EXTREMELY_IMPORTANT>
You have Vibes installed. RIGHT NOW run:
`~/.codex/vibes/.codex/vibes-codex bootstrap`
and follow the instructions it returns.
</EXTREMELY_IMPORTANT>
```

## Verification

Test by asking Codex: "Build me a todo app with Vibes"

## Updating

```bash
cd ~/.codex/vibes && git pull
```

## Troubleshooting

**"Permission denied" when running vibes-codex:**
```bash
chmod +x ~/.codex/vibes/.codex/vibes-codex
```

**Scripts fail with "module not found":**
```bash
cd ~/.codex/vibes/scripts && npm install
```

**Skills not found:**
Make sure you cloned to `~/.codex/vibes` (not a different path). The CLI looks for skills in that location by default.
