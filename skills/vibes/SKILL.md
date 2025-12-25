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

If the user is starting fresh (no existing index.html), read and write the template from `skills/vibes/templates/index.html` to their project directory.

Then provide the App component to replace the placeholder.

**Serve via HTTP** (required - do not open file directly):
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
