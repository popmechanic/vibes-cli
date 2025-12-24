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
              "react": "https://esm.sh/react@19.2.1",
              "react-dom": "https://esm.sh/react-dom@19.2.1",
              "react-dom/client": "https://esm.sh/react-dom@19.2.1/client",
              "use-fireproof": "https://esm.sh/use-vibes@0.19.4-dev-vibes-refactor?external=react,react-dom",
              "call-ai": "https://esm.sh/call-ai@0.19.4-dev-vibes-refactor?external=react,react-dom"
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

## Fireproof API

Fireproof is a local-first database - no loading or error states required, just empty data states. Data persists across sessions and can sync in real-time.

### Setup
```javascript
const { useLiveQuery, useDocument, database } = useFireproof("my-app-db");
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

