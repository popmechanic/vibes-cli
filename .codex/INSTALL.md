# Installing Vibes for Coding Agents

## Quick Install

### 1. Clone the repository

```bash
git clone https://github.com/popmechanic/vibes-cli.git ~/.vibes
```

### 2. Install script dependencies

```bash
cd ~/.vibes/scripts && npm install
```

### 3. Update your agent config

Add this block to your agent's config file (e.g., `~/.codex/AGENTS.md`):

```markdown
## Vibes

<EXTREMELY_IMPORTANT>
You have Vibes installed. RIGHT NOW run:
`~/.vibes/.codex/vibes-codex bootstrap`
and follow the instructions it returns.
</EXTREMELY_IMPORTANT>
```

## Verification

Test by asking your agent: "Build me a todo app with Vibes"

## Updating

```bash
cd ~/.vibes && git pull
```

## Troubleshooting

**"Permission denied" when running vibes-codex:**
```bash
chmod +x ~/.vibes/.codex/vibes-codex
```

**Scripts fail with "module not found":**
```bash
cd ~/.vibes/scripts && npm install
```

**Skills not found:**
Make sure you cloned to `~/.vibes` (not a different path). The CLI looks for skills in that location by default.
