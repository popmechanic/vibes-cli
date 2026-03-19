# Fireproof Patterns Reference

Detailed code examples for common Fireproof patterns. Read this when building apps that need form + list combinations, demo data seeding, or complex query patterns.

## useDocument - Form State (NOT useState)

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

## useLiveQuery - Real-time Lists

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

## Direct Database Operations
```jsx
// Create/update
const { id } = await database.put({ text: "hello", type: "item" });

// Delete
await database.del(item._id);
```

## Complete Example - Form + List
```jsx
import React from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("my-db");

  // Form for new items (submit resets for next entry)
  const { doc, merge, submit } = useDocument({ text: "", type: "item" });

  // Live list of all items of type "item"
  const { docs } = useLiveQuery("type", { key: "item" });

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] p-4">
      {/* Optional sync status indicator */}
      <div className="text-xs text-gray-500 mb-2">Sync: {syncStatus}</div>
      <form onSubmit={submit} className="mb-4">
        <input
          value={doc.text}
          onChange={(e) => merge({ text: e.target.value })}
          className="w-full px-4 py-3 border-4 border-[var(--app-border)]"
        />
        <button type="submit" className="mt-2 px-4 py-2 bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent-hover)]">
          Add
        </button>
      </form>
      {docs.map(item => (
        <div key={item._id} className="p-2 mb-2 bg-[var(--app-surface)] border-4 border-[var(--app-border)]">
          {item.text}
          <button onClick={() => database.del(item._id)} className="ml-2 text-[var(--vibes-red-accent)]">
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Demo Data & Empty States

Every generated app should include a "Load Demo Data" button visible only when the database is empty. This lets users immediately see the app working with realistic data instead of staring at a blank screen.

```jsx
import React from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("my-db");
  const { doc, merge, submit } = useDocument({ title: "", priority: "medium", type: "task" });
  const { docs } = useLiveQuery("type", { key: "task" });

  const seedDemo = async () => {
    if (docs.length > 0) return; // guard: only seed when empty
    await database.put({ title: "Design landing page", priority: "high", done: false, type: "task" });
    await database.put({ title: "Write API documentation", priority: "medium", done: false, type: "task" });
    await database.put({ title: "Fix mobile nav overflow", priority: "high", done: true, type: "task" });
    await database.put({ title: "Add dark mode toggle", priority: "low", done: false, type: "task" });
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] p-4">
      {docs.length === 0 && (
        <button
          onClick={seedDemo}
          className="mb-4 px-4 py-2 bg-[var(--app-accent)] text-white rounded hover:bg-[var(--app-accent-hover)]"
        >
          Load Demo Data
        </button>
      )}
      {/* ... rest of app */}
    </div>
  );
}
```

**Demo data rules:**
- Demo data names/content must be plausible for the app's domain (not "test1", "test2")
- Use `database.put()` directly (not `merge`/`submit`) — this is batch creation
- Guard condition (`docs.length > 0`) and render condition (`docs.length === 0`) must match
- Seed 3–5 documents with enough variety to populate all views and demonstrate features
- If the app has related document types, seed them with cross-references using returned `id` values:
  ```jsx
  const { id: projectId } = await database.put({ name: "Website Redesign", type: "project" });
  await database.put({ title: "Update hero section", projectId, type: "task" });
  ```
