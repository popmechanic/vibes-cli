# Vibes DIY - Claude Code Plugin

Generate React web apps with Fireproof database. No build step, deploy anywhere.

## Installation

Add the marketplace and install the plugin:

```bash
/plugin marketplace add popmechanic/vibes-skill
/plugin install vibes@vibes-diy
```

## Skills

### `/vibes:vibes`
Generate a single Vibes app from a prompt. Creates a complete, working React app with:
- React using `React.createElement` (no JSX, no build step)
- Fireproof for local-first database
- Tailwind CSS for styling
- Hidden settings menu with database sync

### `/vibes:riff`
Generate multiple app variations in parallel. Perfect for exploring different interpretations of a broad objective.

**Example:**
```
/vibes:riff
> Prompt: "Make me an app that could make money"
> Number of riffs: 5
```

**Output:**
```
./
├── index.html          # Riff Gallery - stunning dark mode portfolio
├── RANKINGS.md         # Scored rankings with recommendations
├── riff-1/
│   ├── index.html      # App variation 1
│   └── BUSINESS.md     # Business model canvas
├── riff-2/
│   ├── index.html      # App variation 2
│   └── BUSINESS.md
└── ...
```

Each riff is a genuinely different **concept**, not just aesthetic variations. The model's natural stochasticity creates conceptual diversity.

## Agents

### `vibes-gen`
Generates a single Vibes app with business model. Used internally by `/vibes:riff`.

### `vibes-eval`
Evaluates and ranks riffs on business potential:
- Originality (1-10)
- Market Potential (1-10)
- Feasibility (1-10)
- Monetization Clarity (1-10)
- Wow Factor (1-10)

### `vibes-gallery`
Creates a stunning dark mode gallery page showcasing all riffs with:
- Glass morphism cards
- Score visualizations
- Business summaries
- Direct links to each app

## The Commercial Pitch

> "Create 10 businesses a week, not 1 every 6 months"

Use `/vibes:riff` to rapidly explore the solution space. Generate 5-10 variations of a loose prompt, get them automatically ranked, and iterate on your favorites.

## Template Structure

Each generated app includes:
- **HiddenMenuWrapper**: Triple-click menu for settings
- **VibesSwitch**: Toggle for light/dark themes
- **VibesPanel**: Database sync configuration
- **Fireproof**: Local-first database with optional cloud sync

## License

MIT
