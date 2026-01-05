---
name: vibes
description: Generate React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
---

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░░▒▓███████▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░  ░▒▓██████▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
   ░▒▓██▓▒░  ░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓███████▓▒░
```

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

**Platform Name vs User Intent**: "Vibes" is the name of this app platform (Vibes DIY). When users say "vibe" or "vibes" in their prompt, interpret it as:
- Their project/brand name ("my vibes tracker")
- A positive descriptor ("good vibes app")
- NOT as "mood/atmosphere" literally

Do not default to ambient mood generators, floating orbs, or meditation apps unless explicitly requested.

**Import Map Note**: The import map aliases `use-fireproof` to `use-vibes` because `use-vibes` re-exports all Fireproof APIs (useFireproof, useLiveQuery, useDocument) plus additional helpers. Your code uses `import { useFireproof } from "use-fireproof"` but the browser resolves this to the `use-vibes` package. This is intentional—it ensures compatible versions.

## Core Rules

- **Use JSX** - Standard React syntax with Babel transpilation
- **Single HTML file** - App code assembled into template
- **Fireproof for data** - Use `useFireproof`, `useLiveQuery`, `useDocument`
- **Tailwind for styling** - Mobile-first, responsive design

## Generation Process

### Step 1: Design Reasoning

Before writing code, reason about the design in `<design>` tags:

```
<design>
- What is the core functionality and user flow?
- What OKLCH colors fit this theme? (dark/light, warm/cool, vibrant/muted)
- What layout best serves the content? (cards, list, dashboard, single-focus)
- What micro-interactions would feel satisfying? (hover states, transitions)
- What visual style matches the purpose? (minimal, bold, playful, professional)
</design>
```

### Step 2: Output Code

After reasoning, output the complete JSX in `<code>` tags:

```
<code>
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
</code>
```

**⚠️ CRITICAL: Fireproof Hook Pattern**

Always destructure hooks FROM useFireproof(), never import directly:

```jsx
// ✅ CORRECT - destructure hooks from useFireproof()
const { useDocument, useLiveQuery } = useFireproof("my-db");
const { doc, merge } = useDocument({ _id: "doc1" });

// ❌ WRONG - this does NOT work
import { useDocument } from "use-fireproof";  // ERROR!
```

## Assembly Workflow

1. Extract the code from `<code>` tags and write to `app.jsx`
2. Optionally save `<design>` content to `design.md` for documentation
3. Run assembly:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble.js" app.jsx index.html
   ```
4. Tell user: "Open `index.html` in your browser to view your app."

---

## UI Style & Theming

### OKLCH Colors (Recommended)

Use OKLCH for predictable, vibrant colors. Unlike RGB/HSL, OKLCH has perceptual lightness - changing L by 10% looks the same across all hues.

```css
oklch(L C H)
/* L = Lightness (0-1): 0 black, 1 white */
/* C = Chroma (0-0.4): 0 gray, higher = more saturated */
/* H = Hue (0-360): color wheel degrees */
```

**Theme-appropriate palettes:**

```jsx
{/* Dark/moody theme */}
className="bg-[oklch(0.15_0.02_250)]"  /* Deep blue-black */

{/* Warm/cozy theme */}
className="bg-[oklch(0.25_0.08_30)]"   /* Warm brown */

{/* Fresh/bright theme */}
className="bg-[oklch(0.95_0.03_150)]"  /* Mint white */

{/* Vibrant accent */}
className="bg-[oklch(0.7_0.2_145)]"    /* Vivid green */
```

### Better Gradients with OKLCH

Use `in oklch` for smooth gradients without muddy middle zones:

```jsx
{/* Smooth gradient - no gray middle */}
className="bg-[linear-gradient(in_oklch,oklch(0.6_0.2_250),oklch(0.6_0.2_150))]"

{/* Sunset gradient */}
className="bg-[linear-gradient(135deg_in_oklch,oklch(0.7_0.25_30),oklch(0.5_0.2_330))]"

{/* Dark glass effect */}
className="bg-[linear-gradient(180deg_in_oklch,oklch(0.2_0.05_270),oklch(0.1_0.02_250))]"
```

### Neobrute Style (Optional)

For bold, graphic UI:

- **Borders**: thick 4px, dark `border-[#0f172a]`
- **Shadows**: hard offset `shadow-[6px_6px_0px_#0f172a]`
- **Corners**: square (0px) OR pill (rounded-full) - no in-between

```jsx
<button className="px-6 py-3 bg-[oklch(0.95_0.02_90)] border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a] hover:shadow-[4px_4px_0px_#0f172a] font-bold">
  Click Me
</button>
```

### Glass Morphism (Dark themes)

```jsx
<div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl">
  {/* content */}
</div>
```

### Color Modifications

Lighten/darken using L value:
- **Hover**: increase L by 0.05-0.1
- **Active/pressed**: decrease L by 0.05
- **Disabled**: reduce C to near 0

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

## AI Features (Optional)

If the user's prompt suggests AI-powered features (chatbot, summarization, content generation, etc.), the app needs AI capabilities via the `useAI` hook.

### Detecting AI Requirements

Look for these patterns in the user's prompt:
- "chatbot", "chat with AI", "ask AI"
- "summarize", "generate", "write", "create content"
- "analyze", "classify", "recommend"
- "AI-powered", "intelligent", "smart" (in context of features)

### Collecting OpenRouter Key

When AI is needed, ask the user:

> This app needs AI capabilities. Please provide your OpenRouter API key.
> Get one at: https://openrouter.ai/keys

Store the key for use with the `--ai-key` flag during deployment.

### Using the useAI Hook

The `useAI` hook is automatically included in the template when AI features are detected:

```jsx
import React from "react";
import { useFireproof } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery } = useFireproof("ai-chat-db");
  const { callAI, loading, error } = useAI();

  const handleSend = async (message) => {
    // Save user message
    await database.put({ role: "user", content: message, type: "message" });

    // Call AI
    const response = await callAI({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: message }]
    });

    // Save AI response
    const aiMessage = response.choices[0].message.content;
    await database.put({ role: "assistant", content: aiMessage, type: "message" });
  };

  // Handle limit exceeded
  if (error?.code === 'LIMIT_EXCEEDED') {
    return (
      <div className="p-4 bg-amber-100 text-amber-800 rounded">
        AI usage limit reached. Please wait for monthly reset or upgrade your plan.
      </div>
    );
  }

  // ... rest of UI
}
```

### useAI API

```jsx
const { callAI, loading, error, clearError } = useAI();

// callAI options
await callAI({
  model: "anthropic/claude-sonnet-4",  // or other OpenRouter models
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ],
  temperature: 0.7,  // optional
  max_tokens: 1000   // optional
});

// error structure
error = {
  code: "LIMIT_EXCEEDED" | "API_ERROR" | "NETWORK_ERROR",
  message: "Human-readable error message"
}
```

### Deployment with AI

When deploying AI-enabled apps, include the OpenRouter key:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" \
  --name myapp \
  --file index.html \
  --ai-key "sk-or-v1-your-key"
```

---

## Common Mistakes to Avoid

- **DON'T** use `useState` for form fields - use `useDocument`
- **DON'T** use `Fireproof.fireproof()` - use `useFireproof()` hook
- **DON'T** use white text on light backgrounds
- **DON'T** use `call-ai` directly - use `useAI` hook instead (it handles proxying and limits)

---

## Deployment Options

After generating your app, you can deploy it:

- **exe.dev** - VM hosting with nginx. Use `/vibes:exe` to deploy.
- **Local** - Just open `index.html` in your browser. Works offline with Fireproof.

---

## What's Next?

After generating and assembling the app, present these options using AskUserQuestion:

```
Question: "Your app is ready! What would you like to do next?"
Header: "Next"
Options:
- Label: "Keep improving this app"
  Description: "Continue iterating on what you've built. Add new features, refine the styling, or adjust functionality. Great when you have a clear vision and want to polish it further."

- Label: "Explore variations (/riff)"
  Description: "Not sure if this is the best approach? Riff generates 3-10 completely different interpretations of your idea in parallel. You'll get ranked variations with business model analysis to help you pick the winner."

- Label: "Make it a SaaS (/sell)"
  Description: "Ready to monetize? Sell transforms your app into a multi-tenant SaaS with Clerk authentication, subscription billing, and isolated databases per customer. Each user gets their own subdomain."

- Label: "Deploy to exe.dev (/exe)"
  Description: "Go live right now. Deploy creates a persistent VM at yourapp.exe.xyz with HTTPS, nginx, and Claude pre-installed for remote development. Your app stays online even when you close your laptop."

- Label: "I'm done for now"
  Description: "Wrap up this session. Your files are saved locally - come back anytime to continue."
```

**After user responds:**
- "Keep improving" → Acknowledge and stay ready for iteration prompts
- "Explore variations" → Auto-invoke /vibes:riff skill
- "Make it a SaaS" → Auto-invoke /vibes:sell skill
- "Deploy" → Auto-invoke /vibes:exe skill
- "I'm done" → Confirm files saved, wish them well
