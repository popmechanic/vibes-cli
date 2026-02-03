---
name: riff
description: Generate 3-10 app variations in parallel for comparing ideas
argument-hint: "[count] [theme]"
---

# Riff: Parallel App Variations

Generate multiple app variations in parallel to explore different approaches to a concept.

## Usage

```bash
/vibes:riff 5 "task management"
/vibes:riff 3 dark minimalist todo
```

## Arguments

- **count** (optional): Number of variations to generate (default: 3, max: 10)
- **theme** (optional): Theme or concept to explore

## When to Use

Use `/vibes:riff` when you want to:
- Explore multiple design directions
- Compare different UI approaches
- Brainstorm feature implementations
- See how a concept can be interpreted differently

## Output

Creates a `riff/` directory with numbered subdirectories:
```
riff/
├── 1/
│   ├── app.jsx
│   └── index.html
├── 2/
│   ├── app.jsx
│   └── index.html
└── 3/
    ├── app.jsx
    └── index.html
```

## Related

- `/vibes:vibes` - Generate a single app (when you know what you want)
- `/vibes:sell` - Transform an app into multi-tenant SaaS
