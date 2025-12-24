---
name: vibes
description: Generate React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
---

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

## NO BUILD Philosophy

**Apps must run directly in the browser without any build step.** This means:

- **NO JSX** - JSX requires Babel transpilation
- **Use React.createElement()** - Native JavaScript, no transpiler needed
- **ES Modules via CDN** - Import maps point to esm.sh
- **Open index.html directly** - No dev server needed
- **Zero extra dependencies** - Just React, ReactDOM, and Fireproof

As DHH says: "You can't get faster than No Build."

## Workflow

### 1. Project Detection

First, check the current directory:

1. **If `index.html` exists with Vibes imports** (use-fireproof, esm.sh):
   - This is an existing Vibes project
   - Modify the inline JavaScript in the existing `index.html`

2. **If other files exist but no Vibes setup**:
   - Ask the user: "Where should I create the Vibes app?"
     - "Add index.html to current directory"
     - "Create a `vibes/` subdirectory"

3. **If directory is empty**:
   - Create a single `index.html` file with all code inline

### 2. Project Initialization

**IMPORTANT: Generate a SINGLE HTML file with inline JavaScript.**

Do NOT create separate app.js files - this causes CORS errors when opening locally. Put all code inline in the HTML file within a `<script type="module">` tag.

When initializing a new project, **read and use the complete template** from `templates/index.html`. This template includes:

- CSS variables for theming
- Keyframe animations for the menu
- VibesSwitch component (animated toggle button)
- HiddenMenuWrapper component (slide-up menu panel)
- VibesPanel component (menu content)
- Placeholder App component

**CRITICAL: Always wrap your App in HiddenMenuWrapper when rendering:**

```javascript
ReactDOM.createRoot(document.getElementById("root")).render(
  e(HiddenMenuWrapper, { dbName: "your-app-db" }, e(App))
);
```

The user can then simply open `index.html` directly in their browser - no server needed.

---

## Code Generation Guidelines

When generating React components, follow these rules:

### Language & Framework
- Use **JavaScript only** (no TypeScript)
- Use **modern React practices** with hooks
- Use **Tailwind CSS** for mobile-first accessible styling
- Keep everything in a **single HTML file** with inline `<script type="module">`
- **NEVER create separate .js files** - causes CORS errors when opening locally

### React.createElement Syntax (CRITICAL - NO JSX)

**NEVER use JSX syntax** - it requires a build step. Use `React.createElement()` directly:

```javascript
// Define shorthand at top of script
const e = React.createElement;

// Syntax: e(type, props, ...children)
e("div", { className: "p-4" }, "Hello")           // <div className="p-4">Hello</div>
e("div", null, "Hello")                           // <div>Hello</div>
e("input", { type: "text", value: val })          // <input type="text" value={val} />
e(MyComponent, { prop: value })                   // <MyComponent prop={value} />
```

**Common patterns:**

```javascript
// Multiple children
e("div", { className: "container" },
  e("h1", null, "Title"),
  e("p", null, "Paragraph")
)

// Event handlers
e("button", { onClick: handleClick }, "Click me")
e("input", { onChange: (ev) => setValue(ev.target.value) })

// Conditional rendering
condition && e("div", null, "Shows if true")
condition ? e("span", null, "Yes") : e("span", null, "No")

// Mapping arrays
items.map(item => e("li", { key: item.id }, item.name))

// Fragments (multiple root elements)
e(React.Fragment, null,
  e("div", null, "First"),
  e("div", null, "Second")
)
```

### Fireproof Database

### Data Patterns
- Create granular documents (one per user action)
- Avoid patterns that require single documents to grow unbounded
- List data items on the main page so users can find them
- Make lists clickable for more details

### AI Features (optional)
- Use `callAI` for AI features with `stream: true` for streaming
- Use structured JSON outputs:
  ```js
  callAI(prompt, {
    schema: {
      properties: {
        items: { type: 'array', items: { type: 'string' } }
      }
    }
  })
  ```
- Save AI responses as individual Fireproof documents

### File Uploads
- Use drag-and-drop for file uploads
- Store files using `doc._files` API
- Retrieve with `await meta.file()` method

### Images
- Use placeholder APIs like `https://picsum.photos/400`
- Never generate base64 or PNG data inline

### Code Output
- Always output the **complete HTML file** including the template structure
- Keep explanations short and concise
- Never output partial snippets to change
- Keep the inline script as short as possible

---

## Example: App Component Only

When modifying an existing Vibes app, you only need to update the `App` function. The template already contains all the Vibes menu components.

```javascript
// Your App component - this is what you modify
function App() {
  const { useLiveQuery, useDocument } = useFireproof("my-app-db");

  // Form state with useDocument (NOT useState)
  const { doc, merge, submit } = useDocument({
    text: "",
    type: "item"
  });

  // Live query for real-time updates
  const { docs } = useLiveQuery("type", {
    key: "item",
    descending: true
  });

  return e("div", { className: "max-w-md mx-auto p-4" },
    e("h1", { className: "text-2xl font-bold mb-4" }, "My App"),
    e("form", { onSubmit: submit, className: "mb-4" },
      e("input", {
        type: "text",
        value: doc.text,
        onChange: (ev) => merge({ text: ev.target.value }),
        className: "w-full border rounded px-3 py-2",
        placeholder: "Enter text..."
      }),
      e("button", {
        type: "submit",
        className: "mt-2 px-4 py-2 bg-blue-500 text-white rounded"
      }, "Save")
    ),
    e("ul", { className: "space-y-2" },
      docs.map((item) =>
        e("li", { key: item._id, className: "p-2 bg-gray-100 rounded" }, item.text)
      )
    )
  );
}

// IMPORTANT: Wrap App in HiddenMenuWrapper
ReactDOM.createRoot(document.getElementById("root")).render(
  e(HiddenMenuWrapper, { dbName: "my-app-db" }, e(App))
);
```

**For new projects**: Read `templates/index.html` which contains the complete template with VibesSwitch, HiddenMenuWrapper, and all required CSS.

---

## Fireproof API Reference

Read the cached documentation at `cache/fireproof.txt` for the full Fireproof API reference including:

- `useFireproof(dbName)` - Create or access a database
- `useLiveQuery(field, options)` - Real-time queries with automatic updates
- `useDocument(initial)` - Form state management with `merge()`, `submit()`, `save()`, `reset()`
- `database.put(doc)` - Save a document
- `database.get(id)` - Get a document by ID
- `database.del(id)` - Delete a document
- `doc._files` - File attachment API

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for instructions on deploying to:
- Netlify
- Vercel
- GitHub Pages
- Cloudflare Pages
- Any static hosting

Key points:
- No build step required
- Just upload `index.html` (single file contains everything)
- Import map handles all dependencies via CDN
