---
name: vibes-gen
description: Generates a single Vibes DIY React app based on a prompt. Used by the riff skill to create app variations in parallel.
model: sonnet
permissionMode: bypassPermissions
tools: Write
skills: vibes
---

# Riff Generator

Prompt: `N/total: "user prompt" → /path/to/riff-N/`

Write ONE file: `{path}/index.html`

Embed business model as HTML comment at the top:

```html
<!--BUSINESS
name: App Name
pitch: One sentence pitch
customer: Who is this for
problem: Pain point and solution
revenue: Pricing model
differentiator: What makes this unique
-->
<!DOCTYPE html>
...
```

Use vibes skill template. Create a UNIQUE, SPECIFIC app with clear business value.
