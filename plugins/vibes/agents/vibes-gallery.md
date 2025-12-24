---
name: vibes-gallery
description: Generates a stunning landing page gallery showcasing all riffs with business analysis summaries. Use after vibes-eval to create a visual portfolio of generated apps.
model: sonnet
---

# Vibes Gallery Generator

Create a cutting-edge landing page that showcases all generated riffs as a venture portfolio.

## Your Task

1. Read all `riff-N/BUSINESS.md` files to get app details
2. Read `RANKINGS.md` for scores and recommendations
3. Generate `index.html` in the root folder - a stunning gallery page

## Design Requirements

### Aesthetic: Dark Mode Venture Portfolio

- **Background**: Deep dark (#0a0a0f) with subtle radial gradient
- **Cards**: Glass morphism (semi-transparent white, backdrop blur)
- **Accents**: Purple/cyan gradient (#8b5cf6 → #06b6d4)
- **Typography**: System fonts, bold headings, clean hierarchy
- **Animations**: Smooth hover transitions (scale, glow, lift)

### Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  🎸 RIFF GALLERY                                        │
│  "[original prompt]" • Generated [date] • N variations  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ #1 🏆       │  │ #2          │  │ #3          │     │
│  │ App Name    │  │ App Name    │  │ App Name    │     │
│  │             │  │             │  │             │     │
│  │ Score: 42   │  │ Score: 38   │  │ Score: 35   │     │
│  │ ████████░░  │  │ ███████░░░  │  │ ██████░░░░  │     │
│  │             │  │             │  │             │     │
│  │ "One-liner  │  │ "One-liner  │  │ "One-liner  │     │
│  │  pitch"     │  │  pitch"     │  │  pitch"     │     │
│  │             │  │             │  │             │     │
│  │ [Launch →]  │  │ [Launch →]  │  │ [Launch →]  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
│  Best for solo founder: #1 • Fastest to ship: #3       │
└─────────────────────────────────────────────────────────┘
```

### Card Content

Each card displays:
- **Rank badge** (#1 gets 🏆 trophy)
- **App name** (from BUSINESS.md)
- **One-liner pitch** (from BUSINESS.md)
- **Vibe Score** with visual progress bar
- **Target customer** tag
- **Revenue model** tag
- **"Launch App →"** button linking to `riff-N/index.html`

## Process

### Step 1: Gather Data

Use Glob to find all `riff-*/BUSINESS.md` files, then Read each one.

Parse from each BUSINESS.md:
- App name (first H1)
- One-liner (under "## One-Liner")
- Target customer (under "## Target Customer")
- Revenue model (under "## Revenue Model")

### Step 2: Get Rankings

Read `RANKINGS.md` and extract:
- Score for each riff (XX/50)
- Rank order
- Quick recommendations (best for solo founder, fastest to ship, etc.)
- Original prompt

### Step 3: Generate Gallery

Write `index.html` with this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Riff Gallery</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0a0a0f;
      background-image: radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a0f 50%);
      min-height: 100vh;
      color: #e0e0e0;
    }

    header {
      text-align: center;
      padding: 3rem 1rem 2rem;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .prompt {
      font-size: 1.25rem;
      color: #a0a0a0;
      font-style: italic;
      margin-bottom: 0.5rem;
    }

    .meta {
      font-size: 0.875rem;
      color: #606060;
    }

    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
    }

    .card {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #8b5cf6, #06b6d4);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.3);
    }

    .card:hover::before {
      opacity: 1;
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 700;
      color: white;
      margin-bottom: 1rem;
    }

    .card h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }

    .pitch {
      color: #a0a0a0;
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 1rem;
      min-height: 3rem;
    }

    .score-container {
      margin-bottom: 1rem;
    }

    .score-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: #808080;
      margin-bottom: 0.25rem;
    }

    .score-bar {
      height: 8px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      overflow: hidden;
    }

    .score-fill {
      height: 100%;
      background: linear-gradient(90deg, #8b5cf6, #06b6d4);
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    .tag {
      padding: 0.25rem 0.5rem;
      background: rgba(255,255,255,0.1);
      border-radius: 6px;
      font-size: 0.7rem;
      color: #c0c0c0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .cta {
      display: block;
      width: 100%;
      padding: 0.75rem;
      background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
      border: none;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .cta:hover {
      transform: scale(1.02);
      box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
    }

    footer {
      text-align: center;
      padding: 2rem 1rem;
      border-top: 1px solid rgba(255,255,255,0.1);
      color: #606060;
      font-size: 0.875rem;
    }

    footer strong {
      color: #8b5cf6;
    }

    .recommendations {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 1rem 2rem;
    }

    @media (max-width: 640px) {
      header h1 {
        font-size: 1.75rem;
      }
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>🎸 Riff Gallery</h1>
    <p class="prompt">"[ORIGINAL_PROMPT]"</p>
    <p class="meta">Generated [DATE] • [COUNT] variations</p>
  </header>

  <main>
    <div class="grid">
      <!-- Repeat for each riff, sorted by rank -->
      <article class="card">
        <span class="badge">#1 🏆</span>
        <h2>[App Name]</h2>
        <p class="pitch">[One-liner pitch from BUSINESS.md]</p>
        <div class="score-container">
          <div class="score-label">
            <span>Vibe Score</span>
            <span>[SCORE]/50</span>
          </div>
          <div class="score-bar">
            <div class="score-fill" style="width: [SCORE_PERCENT]%"></div>
          </div>
        </div>
        <div class="tags">
          <span class="tag">[Target Customer]</span>
          <span class="tag">[Revenue Model]</span>
        </div>
        <a href="riff-1/index.html" class="cta">Launch App →</a>
      </article>
      <!-- More cards... -->
    </div>
  </main>

  <footer>
    <div class="recommendations">
      <span>Best for solo founder: <strong>#[N]</strong></span>
      <span>Fastest to ship: <strong>#[N]</strong></span>
      <span>Highest potential: <strong>#[N]</strong></span>
    </div>
  </footer>
</body>
</html>
```

## Important Notes

- Sort cards by rank (highest score first)
- #1 ranked card gets the 🏆 emoji in its badge
- Calculate score percentage as (score/50)*100 for the progress bar
- Keep tag text short (truncate if needed)
- Use relative links (`riff-1/index.html`, not absolute paths)
- The gallery should work when opened directly as a file (no server needed)

## Output

Write a single file: `index.html` in the root folder (same level as RANKINGS.md and riff-N folders).
