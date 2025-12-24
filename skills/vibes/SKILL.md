---
name: vibes
description: Generate React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
---

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

## Core Rules

- **NO JSX** - Use `React.createElement()` (shorthand: `const e = React.createElement`)
- **Single HTML file** - All code inline in `<script type="module">`
- **Fireproof for data** - Use `useFireproof`, `useLiveQuery`, `useDocument`
- **Tailwind for styling** - Mobile-first, neo-brutalist aesthetic

## Output Format

**CRITICAL: Only output the App component code, not the full HTML file.**

Your response should be:
1. Brief explanation (1-2 sentences)
2. The App component code in a code block

```javascript
// Your App component
function App() {
  const { useLiveQuery, useDocument } = useFireproof("app-name-db");
  // ... component logic
  return e("div", { className: "..." }, /* children */);
}
```

The user will paste this into their existing template. Do NOT output the full HTML, import map, or boilerplate components.

---

## For New Projects Only

If the user is starting fresh (no existing index.html), first create the template file, then provide the App component.

**Step 1: Create template** - Write this boilerplate to `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vibes App</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client",
      "use-fireproof": "https://esm.sh/use-vibes@0.19.4?external=react,react-dom",
      "call-ai": "https://esm.sh/call-ai@0.19.4?external=react,react-dom"
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

    // === APP COMPONENT (edit below) ===
    function App() {
      return e("div", { className: "min-h-screen bg-[#f1f5f9] p-4" },
        e("h1", { className: "text-2xl font-bold" }, "Hello Vibes!")
      );
    }
    // === END APP COMPONENT ===

    ReactDOM.createRoot(document.getElementById("root")).render(e(App));
  </script>
</body>
</html>
```

**Step 2: Replace the App component** with the user's requested functionality.

---

## UI Style (Neobrute Blueprint)

Apply this visual style:

- **Colors**: `#f1f5f9` (bg), `#0f172a` (text/borders), `#ffffff` (surfaces)
- **Borders**: thick 4px, color `#0f172a`
- **Shadows**: hard offset `shadow-[6px_6px_0px_#0f172a]`
- **Corners**: square (0px) OR pill (rounded-full) - no in-between
- **Never white text** - use `#0f172a` for text

```javascript
// Button example
e("button", {
  className: "px-6 py-3 bg-[#f1f5f9] border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a] hover:shadow-[4px_4px_0px_#0f172a] active:shadow-[2px_2px_0px_#0f172a] font-bold text-[#0f172a]"
}, "Click Me")

// Card example
e("div", {
  className: "p-4 bg-white border-4 border-[#0f172a] shadow-[4px_4px_0px_#0f172a]"
}, /* content */)

// Input example
e("input", {
  className: "w-full px-4 py-3 border-4 border-[#0f172a] bg-white text-[#0f172a]",
  placeholder: "Enter text..."
})
```

---

## Fireproof Patterns

```javascript
const { useLiveQuery, useDocument, database } = useFireproof("my-app-db");

// Form state with useDocument (NOT useState)
const { doc, merge, submit, reset } = useDocument({ text: "", type: "item" });

// Handle input
e("input", {
  value: doc.text,
  onChange: (ev) => merge({ text: ev.target.value })
})

// Handle submit
e("form", { onSubmit: submit }, /* fields + button */)

// Live query for real-time list
const { docs } = useLiveQuery("type", { key: "item" });
docs.map(item => e("div", { key: item._id }, item.text))

// Delete
e("button", { onClick: () => database.del(item._id) }, "Delete")
```

---

## React.createElement Quick Reference

```javascript
const e = React.createElement;

e("div", { className: "p-4" }, "text")           // <div className="p-4">text</div>
e("div", null, child1, child2)                   // multiple children
e(MyComponent, { prop: value })                  // custom component
condition && e("div", null, "shown")             // conditional
items.map(i => e("li", { key: i.id }, i.name))   // list
e("button", { onClick: fn }, "Click")            // event handler
```

---

## Common Mistakes to Avoid

- **DON'T** use JSX syntax (`<div>`) - use `e("div", ...)`
- **DON'T** use `useState` for form fields - use `useDocument`
- **DON'T** use `Fireproof.fireproof()` - use `useFireproof()` hook
- **DON'T** output the full HTML file - only output the App component
- **DON'T** use white text on light backgrounds

---

## Fireproof API Reference

See `cache/fireproof.txt` for the full API reference.
