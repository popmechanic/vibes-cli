---
name: design
description: Transform a design.html mockup into a working Vibes app
argument-hint: "<design.html>"
---

# Design: Transform HTML Mockups

Transform a static HTML design file into a working Vibes app with Fireproof data persistence.

## Usage

```bash
/vibes:design design.html
/vibes:design mockup.html
```

## Arguments

- **design.html** (required): Path to your static HTML mockup file

> **Note:** This command invokes the `design-reference` skill. The shorter `/vibes:design` is provided as a convenience alias.

## Core Principle

> **Preserve and adapt, don't interpret and recreate.**

The design reference is source code to transform, not inspiration to interpret. This skill makes minimal surgical changes to connect HTML to React/Fireproof.

## When to Use

Use `/vibes:design` when you have:
- A static HTML mockup to convert
- A design.html file from a designer
- An existing prototype to add data persistence to
- A previous implementation that didn't match the design

## Transformation Rules

| Original | Converted |
|----------|-----------|
| `class="..."` | `className="..."` |
| `for="..."` | `htmlFor="..."` |
| `stroke-width` | `strokeWidth` |
| `<input>` | `<input />` |
| `<!-- comment -->` | `{/* comment */}` |
| `style="color: red"` | `style={{ color: 'red' }}` |

**CSS is copied verbatim** - no "improvements" or translations.

## Output

Creates `app.jsx` ready for assembly:

```bash
node scripts/assemble.js app.jsx index.html
```

## Related

- `/vibes:vibes` - Generate from description (when you don't have a mockup)
- `/vibes:exe` - Deploy the transformed app
