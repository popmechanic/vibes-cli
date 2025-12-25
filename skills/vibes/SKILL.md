---
name: vibes
description: Generate React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
---

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

**Note**: "Vibes" is the name of this app platform. If the user mentions "vibe" or "vibes" in their prompt, interpret it as their project/brand name OR as a general positive descriptor - NOT as "mood/atmosphere." Do not default to ambient mood generators, floating orbs, or chill atmosphere apps unless explicitly requested.

## Core Rules

- **Use JSX** - Standard React syntax with Babel transpilation
- **Single HTML file** - App code assembled into template
- **Fireproof for data** - Use `useFireproof`, `useLiveQuery`, `useDocument`
- **Tailwind for styling** - Mobile-first, neo-brutalist aesthetic

## Output Format

Output a complete JSX App component file with imports:

```jsx
import React, { useState } from "react";
import { useFireproof } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, useDocument } = useFireproof("app-name-db");
  // ... component logic

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-4">
      {/* Your app UI */}
    </div>
  );
}
```

## Assembly Workflow

After generating the App code:

1. Write the App code to `app.jsx`
2. Copy template: `cp skills/vibes/templates/index.html index.html` (or read and write it)
3. Run assembly: `node scripts/assemble.js app.jsx index.html`
4. Serve: `npx serve .` and open http://localhost:3000

---

## UI Style (Neobrute Blueprint)

Apply this visual style:

- **Colors**: `#f1f5f9` (bg), `#0f172a` (text/borders), `#ffffff` (surfaces)
- **Borders**: thick 4px, color `#0f172a`
- **Shadows**: hard offset `shadow-[6px_6px_0px_#0f172a]`
- **Corners**: square (0px) OR pill (rounded-full) - no in-between
- **Never white text** - use `#0f172a` for text

```jsx
{/* Button example */}
<button className="px-6 py-3 bg-[#f1f5f9] border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a] hover:shadow-[4px_4px_0px_#0f172a] active:shadow-[2px_2px_0px_#0f172a] font-bold text-[#0f172a]">
  Click Me
</button>

{/* Card example */}
<div className="p-4 bg-white border-4 border-[#0f172a] shadow-[4px_4px_0px_#0f172a]">
  {/* content */}
</div>

{/* Input example */}
<input
  className="w-full px-4 py-3 border-4 border-[#0f172a] bg-white text-[#0f172a]"
  placeholder="Enter text..."
/>
```

---

## Fireproof API

Fireproof is a local-first database - no loading or error states required, just empty data states. Data persists across sessions and can sync in real-time.

### Setup
```jsx
const { useLiveQuery, useDocument, database } = useFireproof("my-app-db");
```

### Choosing Your Pattern

**useDocument** = Form-like editing. Accumulate changes with `merge()`, then save with `submit()` or `save()`. Best for: text inputs, multi-field forms, editing workflows.

**database.put() + useLiveQuery** = Immediate state changes. Each action writes directly. Best for: counters, toggles, buttons, any single-action updates.

```jsx
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

```jsx
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

```jsx
// Simple: query by field value
const { docs } = useLiveQuery("type", { key: "item" });

// Recent items (_id is roughly temporal - great for simple sorting)
const { docs } = useLiveQuery("_id", { descending: true, limit: 100 });

// Range query
const { docs } = useLiveQuery("rating", { range: [3, 5] });
```

**CRITICAL**: Custom index functions are SANDBOXED and CANNOT access external variables. Query all, filter in render:

```jsx
// GOOD: Query all, filter in render
const { docs: allItems } = useLiveQuery("type", { key: "item" });
const filtered = allItems.filter(d => d.category === selectedCategory);
```

### Direct Database Operations
```jsx
// Create/update
const { id } = await database.put({ text: "hello", type: "item" });

// Delete
await database.del(item._id);
```

### Common Pattern - Form + List
```jsx
import React from "react";
import { useFireproof } from "use-fireproof";

export default function App() {
  const { useLiveQuery, useDocument, database } = useFireproof("my-db");

  // Form for new items (submit resets for next entry)
  const { doc, merge, submit } = useDocument({ text: "", type: "item" });

  // Live list of all items of type "item"
  const { docs } = useLiveQuery("type", { key: "item" });

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-4">
      <form onSubmit={submit} className="mb-4">
        <input
          value={doc.text}
          onChange={(e) => merge({ text: e.target.value })}
          className="w-full px-4 py-3 border-4 border-[#0f172a]"
        />
        <button type="submit" className="mt-2 px-4 py-2 bg-[#0f172a] text-[#f1f5f9]">
          Add
        </button>
      </form>
      {docs.map(item => (
        <div key={item._id} className="p-2 mb-2 bg-white border-4 border-[#0f172a]">
          {item.text}
          <button onClick={() => database.del(item._id)} className="ml-2 text-red-500">
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
```

---

## Common Mistakes to Avoid

- **DON'T** use `useState` for form fields - use `useDocument`
- **DON'T** use `Fireproof.fireproof()` - use `useFireproof()` hook
- **DON'T** use white text on light backgrounds
