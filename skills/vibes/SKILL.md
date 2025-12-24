---
name: vibes
description: Generate React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
---

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

**Note**: "Vibes" is the name of this app platform. If the user mentions "vibe" or "vibes" in their prompt, interpret it as their project/brand name OR as a general positive descriptor - NOT as "mood/atmosphere." Do not default to ambient mood generators, floating orbs, or chill atmosphere apps unless explicitly requested.

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
  <style>
    :root {
      --vibes-black: #0f172a;
      --vibes-white: #ffffff;
      --vibes-near-black: #1e293b;
      --vibes-gray-ultralight: #f8fafc;
      --vibes-gray-lightest: #f1f5f9;
      --vibes-gray-light: #e2e8f0;
      --vibes-gray: #94a3b8;
      --vibes-gray-dark: #64748b;
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

    // === VIBES MENU TOGGLE ===
    function VibesSwitch({ size = 24, isActive, onToggle }) {
      const [internalActive, setInternalActive] = React.useState(true);
      const active = !(isActive !== undefined ? isActive : internalActive);
      const handleClick = (ev) => {
        ev.stopPropagation();
        const newState = !active;
        onToggle?.(newState);
        if (isActive === undefined) setInternalActive(!newState);
      };
      return e("svg", { xmlns: "http://www.w3.org/2000/svg", height: size, viewBox: "0 0 600 300", fill: "currentColor", onClick: handleClick, style: { cursor: "pointer" } },
        e("path", { fill: "#000", d: "M293.353,298.09c-41.038,0-82.078,0.125-123.115-0.077c-11.993-0.06-24.011-0.701-35.964-1.703c-15.871-1.331-29.73-7.937-41.948-17.946c-16.769-13.736-27.207-31.417-30.983-52.7c-4.424-24.93,1.404-47.685,16.506-67.913c11.502-15.407,26.564-26.1,45.258-30.884c7.615-1.949,15.631-2.91,23.501-3.165c20.08-0.652,40.179-0.853,60.271-0.879c69.503-0.094,139.007-0.106,208.51,0.02c14.765,0.026,29.583,0.097,44.28,1.313c36.984,3.059,61.78,23.095,74.653,57.301c17.011,45.199-8.414,96.835-54.29,111.864c-7.919,2.595-16.165,3.721-24.434,3.871c-25.614,0.467-51.234,0.742-76.853,0.867C350.282,298.197,321.817,298.09,293.353,298.09z" }),
        e("path", { fill: "#fff", d: active ? "M165.866,285.985c-7.999-0.416-19.597-0.733-31.141-1.687c-15.692-1.297-28.809-8.481-40.105-19.104c-12.77-12.008-20.478-26.828-22.714-44.177c-3.048-23.644,3.384-44.558,19.646-62.143c9.174-9.92,20.248-17.25,33.444-20.363c7.786-1.837,15.944-2.399,23.973-2.828c9.988-0.535,121.023-0.666,131.021-0.371c10.191,0.301,20.433,0.806,30.521,2.175c12.493,1.696,23.132,7.919,32.552,16.091c14.221,12.337,22.777,27.953,25.184,46.594c2.822,21.859-2.605,41.617-16.777,58.695c-9.494,11.441-21.349,19.648-35.722,23.502c-6.656,1.785-13.724,2.278-20.647,2.77C286.914,285.721,177.682,285.667,165.866,285.985z" : "M426.866,285.985c-7.999-0.416-19.597-0.733-31.141-1.687c-15.692-1.297-28.809-8.481-40.105-19.104c-12.77-12.008-20.478-26.828-22.714-44.177c-3.048-23.644,3.384-44.558,19.646-62.143c9.174-9.92,20.248-17.25,33.444-20.363c7.786-1.837,15.944-2.399,23.973-2.828c9.988-0.535,20.023-0.666,30.021-0.371c10.191,0.301,20.433,0.806,30.521,2.175c12.493,1.696,23.132,7.919,32.552,16.091c14.221,12.337,22.777,27.953,25.184,46.594c2.822,21.859-2.605,41.617-16.777,58.695c-9.494,11.441-21.349,19.648-35.722,23.502c-6.656,1.785-13.724,2.278-20.647,2.77C446.914,285.721,438.682,285.667,426.866,285.985z", style: { transition: "d 0.3s ease" } })
      );
    }

    // === APP COMPONENT (edit below) ===
    function App() {
      return e("div", { className: "min-h-screen bg-[#f1f5f9] p-4" },
        e("h1", { className: "text-2xl font-bold" }, "Hello Vibes!")
      );
    }
    // === END APP COMPONENT ===

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

**Step 2: Replace the App component** with the user's requested functionality.

**Step 3: Serve via HTTP** (required - do not open file directly):
```bash
npx serve .
# Open http://localhost:3000
```

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

## Fireproof API

Fireproof is a local-first database - no loading or error states required, just empty data states. Data persists across sessions and can sync in real-time.

### Setup
```javascript
const { useLiveQuery, useDocument, database } = useFireproof("my-app-db");
```

### Choosing Your Pattern

**useDocument** = Form-like editing. Accumulate changes with `merge()`, then save with `submit()` or `save()`. Best for: text inputs, multi-field forms, editing workflows.

**database.put() + useLiveQuery** = Immediate state changes. Each action writes directly. Best for: counters, toggles, buttons, any single-action updates.

```javascript
// FORM PATTERN: User types, then submits
const { doc, merge, submit } = useDocument({ title: "", body: "", type: "post" });
// merge({ title: "..." }) on each keystroke, submit() when done

// IMMEDIATE PATTERN: Each click is a complete action
const { docs } = useLiveQuery("_id", { key: "counter" });
const count = docs[0]?.value || 0;
const increment = () => database.put({ _id: "counter", value: count + 1 });
```

### useDocument - Form State (NOT useState)

**IMPORTANT**: Don't use `useState()` for form data. Use `merge()` and `submit()` from `useDocument`. Only use `useState` for ephemeral UI state (active tabs, open/closed panels).

```javascript
// Create new documents (auto-generated _id recommended)
const { doc, merge, submit, reset } = useDocument({ text: "", type: "item" });

// Edit existing document by known _id
const { doc, merge, save } = useDocument({ _id: "user-profile:abc@example.com" });

// Methods:
// - merge(updates) - update fields: merge({ text: "new value" })
// - submit(e) - save + reset (for forms creating new items)
// - save() - save without reset (for editing existing items)
// - reset() - discard changes
```

### useLiveQuery - Real-time Lists

Data is queried by sorted indexes. Use strings, numbers, booleans, or arrays for grouping.

```javascript
// Simple: query by field value
const { docs } = useLiveQuery("type", { key: "item" });

// Recent items (_id is roughly temporal - great for simple sorting)
const { docs } = useLiveQuery("_id", { descending: true, limit: 100 });

// Range query
const { docs } = useLiveQuery("rating", { range: [3, 5] });
```

#### Custom Index Functions

**CRITICAL**: Custom index functions are SANDBOXED and CANNOT access external variables (including React state). They are serialized and run in isolation.

```javascript
// GOOD: Static index function with prefix query
const { docs } = useLiveQuery(
  (doc) => doc.type === "item" ? [doc.category, doc.createdAt] : null,
  { prefix: ["work"] }  // prefix is static
);

// GOOD: Query all, filter in render (for dynamic filtering)
const { docs: allItems } = useLiveQuery("type", { key: "item" });
const filtered = allItems.filter(d => d.category === selectedCategory);

// BAD - CAUSES INFINITE LOOPS (can't access selectedCategory inside function)
const { docs } = useLiveQuery(
  (doc) => doc.category === selectedCategory ? doc._id : null  // selectedCategory is undefined!
);
```

#### Array Indexes for Grouping

```javascript
// Group by date parts
const { docs } = useLiveQuery(
  (doc) => [doc.year, doc.month, doc.day],
  { prefix: [2024, 11] }  // all November 2024
);
```

### Direct Database Operations
```javascript
// Create/update
const { id } = await database.put({ text: "hello", type: "item" });

// Update existing (must include _id)
await database.put({ ...existingDoc, text: "updated" });

// Delete
await database.del(item._id);
```

### Best Practices

- **Granular documents**: One document per user action. Avoid documents that grow without bound.
- **Use type field**: Add `type: "item"` to documents for easy querying by category.
- **Auto-generated _id**: Let Fireproof generate IDs for uniqueness. Use explicit IDs only for known resources (user profiles, schedule slots).

### Common Pattern - Form + List
```javascript
function App() {
  const { useLiveQuery, useDocument, database } = useFireproof("my-db");

  // Form for new items (submit resets for next entry)
  const { doc, merge, submit } = useDocument({ text: "", type: "item" });

  // Live list of all items of type "item"
  const { docs } = useLiveQuery("type", { key: "item" });

  return e("div", null,
    e("form", { onSubmit: submit },
      e("input", { value: doc.text, onChange: (ev) => merge({ text: ev.target.value }) }),
      e("button", { type: "submit" }, "Add")
    ),
    docs.map(item => e("div", { key: item._id },
      item.text,
      e("button", { onClick: () => database.del(item._id) }, "Delete")
    ))
  );
}
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

