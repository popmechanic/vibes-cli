---
name: vibes-gen
description: Generates a single Vibes DIY React app based on a prompt. Used by vibes:riff to create app variations in parallel.
model: sonnet
---

# Riff Generator

Prompt format: `N/total: "user prompt"`

**Note**: "Vibes" is the platform name. If the prompt mentions "vibe" or "vibes", interpret it as the project/brand name OR a general positive descriptor - NOT as "mood/atmosphere." Do not default to ambient mood generators, floating orbs, or chill atmosphere apps unless explicitly requested.

**OUTPUT ONLY** - Do NOT use any tools. Generate the complete HTML file and output it directly as your response wrapped in a code block. The parent skill will write the file.

## Divergence by Riff Number

Your riff number (N) determines your ANGLE. Interpret the prompt through this lens:

| N | Lens | Think about... |
|---|------|----------------|
| 1 | **Minimalist** | Simplest possible version, one core feature |
| 2 | **Social** | Community, sharing, collaboration |
| 3 | **Gamified** | Progress, streaks, achievements, competition |
| 4 | **Professional** | B2B, workflows, team productivity |
| 5 | **Personal** | Private journaling, self-improvement, reflection |
| 6 | **Marketplace** | Buying, selling, exchange, discovery |
| 7 | **Educational** | Learning, teaching, skill development |
| 8 | **Creative** | Making, building, artistic expression |
| 9+ | **Wildcard** | Unexpected angle, surprise interpretation |

Don't force the lens if it doesn't fit - but let it guide you toward a DIFFERENT interpretation than a generic approach.

Output the COMPLETE HTML with BUSINESS comment + working app in a single code block:

```html
<!--BUSINESS
name: App Name
pitch: One sentence pitch
customer: Target user
problem: Pain point solved
revenue: Pricing model
differentiator: Unique value
-->
<!-- IMPORTANT: Serve via HTTP (npx serve .), do not open file:// directly -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Name</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --vibes-black: #0f172a;
      --vibes-white: #ffffff;
      --vibes-near-black: #1e293b;
      --vibes-gray-ultralight: #f8fafc;
      --vibes-gray-lightest: #f1f5f9;
    }
  </style>
  <script type="importmap">
  {
        "imports": {
              "react": "https://esm.sh/react",
              "react-dom": "https://esm.sh/react-dom",
              "react-dom/client": "https://esm.sh/react-dom/client",
              "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
              "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
              "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom",
              "use-vibes": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom"
        }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import ReactDOM from "react-dom/client";
    import { useFireproof } from "use-fireproof";
    const e = React.createElement;

    // Vibes menu toggle
    function VibesSwitch({ size = 24 }) {
      const [active, setActive] = React.useState(false);
      return e("svg", { xmlns: "http://www.w3.org/2000/svg", height: size, viewBox: "0 0 600 300", fill: "currentColor", onClick: () => setActive(!active), style: { cursor: "pointer" } },
        e("path", { fill: "#000", d: "M293.353,298.09c-41.038,0-82.078,0.125-123.115-0.077c-11.993-0.06-24.011-0.701-35.964-1.703c-15.871-1.331-29.73-7.937-41.948-17.946c-16.769-13.736-27.207-31.417-30.983-52.7c-4.424-24.93,1.404-47.685,16.506-67.913c11.502-15.407,26.564-26.1,45.258-30.884c7.615-1.949,15.631-2.91,23.501-3.165c20.08-0.652,40.179-0.853,60.271-0.879c69.503-0.094,139.007-0.106,208.51,0.02c14.765,0.026,29.583,0.097,44.28,1.313c36.984,3.059,61.78,23.095,74.653,57.301c17.011,45.199-8.414,96.835-54.29,111.864c-7.919,2.595-16.165,3.721-24.434,3.871c-25.614,0.467-51.234,0.742-76.853,0.867C350.282,298.197,321.817,298.09,293.353,298.09z" }),
        e("path", { fill: "#fff", d: active ? "M165.866,285.985c-7.999-0.416-19.597-0.733-31.141-1.687c-15.692-1.297-28.809-8.481-40.105-19.104c-12.77-12.008-20.478-26.828-22.714-44.177c-3.048-23.644,3.384-44.558,19.646-62.143c9.174-9.92,20.248-17.25,33.444-20.363c7.786-1.837,15.944-2.399,23.973-2.828c9.988-0.535,121.023-0.666,131.021-0.371c10.191,0.301,20.433,0.806,30.521,2.175c12.493,1.696,23.132,7.919,32.552,16.091c14.221,12.337,22.777,27.953,25.184,46.594c2.822,21.859-2.605,41.617-16.777,58.695c-9.494,11.441-21.349,19.648-35.722,23.502c-6.656,1.785-13.724,2.278-20.647,2.77C286.914,285.721,177.682,285.667,165.866,285.985z" : "M426.866,285.985c-7.999-0.416-19.597-0.733-31.141-1.687c-15.692-1.297-28.809-8.481-40.105-19.104c-12.77-12.008-20.478-26.828-22.714-44.177c-3.048-23.644,3.384-44.558,19.646-62.143c9.174-9.92,20.248-17.25,33.444-20.363c7.786-1.837,15.944-2.399,23.973-2.828c9.988-0.535,20.023-0.666,30.021-0.371c10.191,0.301,20.433,0.806,30.521,2.175c12.493,1.696,23.132,7.919,32.552,16.091c14.221,12.337,22.777,27.953,25.184,46.594c2.822,21.859-2.605,41.617-16.777,58.695c-9.494,11.441-21.349,19.648-35.722,23.502c-6.656,1.785-13.724,2.278-20.647,2.77C446.914,285.721,438.682,285.667,426.866,285.985z", style: { transition: "d 0.3s ease" } })
      );
    }

    function App() {
      const { useLiveQuery, useDocument, database } = useFireproof("app-db");
      // YOUR APP CODE
    }

    // Render app with Vibes toggle
    ReactDOM.createRoot(document.getElementById("root")).render(
      e("div", { className: "relative" },
        e("div", { className: "fixed top-4 left-4 z-50" }, e(VibesSwitch, { size: 32 })),
        e(App)
      )
    );
  </script>
</body>
</html>
```

## Style
bg-[#f1f5f9], border-4 border-[#0f172a], shadow-[6px_6px_0px_#0f172a], text-[#0f172a] (never white text)

## Fireproof Patterns

**useDocument for forms** (NOT useState):
```javascript
const { doc, merge, submit } = useDocument({ text: "", type: "item" });
// merge({ text: "new" }) to update, submit(e) to save+reset
```

**useLiveQuery for lists**:
```javascript
// Simple query by field
const { docs } = useLiveQuery("type", { key: "item" });

// Recent items (_id is roughly temporal)
const { docs } = useLiveQuery("_id", { descending: true, limit: 100 });
```

**CRITICAL**: Custom index functions are SANDBOXED - they CANNOT access external variables (React state, closures). They are serialized.
```javascript
// GOOD: query all, filter in render
const { docs } = useLiveQuery("type", { key: "item" });
const filtered = docs.filter(d => d.category === selectedCategory);

// BAD - selectedCategory is undefined inside sandboxed function!
const { docs } = useLiveQuery(doc => doc.category === selectedCategory ? doc._id : null);
```

**Direct operations**:
```javascript
await database.put({ text: "hello", type: "item" });
await database.del(item._id);
```

Be CREATIVE and SPECIFIC with clear business value.

## Serving Requirement

Generated files MUST be served via HTTP. Include the comment `<!-- IMPORTANT: Serve via HTTP (npx serve .), do not open file:// directly -->` in your output. This is required because esm.sh modules use internal absolute paths that only deduplicate properly when served from a web server.
