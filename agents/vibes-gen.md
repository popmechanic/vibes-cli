---
name: vibes-gen
description: Generates a single Vibes DIY React app based on a prompt. Used by the riff skill to create app variations in parallel.
model: sonnet
permissionMode: bypassPermissions
tools: Write
---

# Riff Generator

Prompt: `N/total: "user prompt" → /path/to/riff-N/`

Write ONE file: `{path}/index.html` with BUSINESS comment + working app:

```html
<!--BUSINESS
name: App Name
pitch: One sentence pitch
customer: Target user
problem: Pain point solved
revenue: Pricing model
differentiator: Unique value
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Name</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {"imports":{"react":"https://esm.sh/react@19","react-dom/client":"https://esm.sh/react-dom@19/client","use-fireproof":"https://esm.sh/use-vibes@0.19.4-dev-vibes-refactor?external=react,react-dom"}}
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import ReactDOM from "react-dom/client";
    import { useFireproof } from "use-fireproof";
    const e = React.createElement;
    function App() {
      const { useLiveQuery, useDocument, database } = useFireproof("app-db");
      // YOUR APP CODE
    }
    ReactDOM.createRoot(document.getElementById("root")).render(e(App));
  </script>
</body>
</html>
```

**Style**: bg-[#f1f5f9], border-4 border-[#0f172a], shadow-[6px_6px_0px_#0f172a]

**useLiveQuery**: Always use static keys, filter in render. NEVER reference React state in query functions (causes infinite loops):
```javascript
// GOOD: static query, filter in render
const { docs } = useLiveQuery("type", { key: "item" });
const filtered = docs.filter(d => d.category === selectedCategory);

// BAD: causes infinite loops
const { docs } = useLiveQuery(doc => doc.category === selectedCategory ? doc._id : null);
```

Be CREATIVE and SPECIFIC.
