# Vibes Brainstorm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, non-technical Q&A step before app generation so Claude understands user intent — especially data modeling and sync strategy — before writing code.

**Architecture:** A new `vibes-brainstorm` skill provides Claude with a framework for adaptive requirements gathering using plain-language multiple-choice questions. The generate flow in `ws.ts` routes through the brainstorm before building the app. Clickable choice buttons in the chat UI let users tap answers. Invariant TinyBase rules (`useApp()` mandatory, user attribution, etc.) are added to SKILL.md and enforced by the prompt builder.

**Tech Stack:** Markdown skill file, TypeScript (ws.ts, prompt-builders.ts), HTML/CSS/JS (editor.html)

**Spec:** `docs/superpowers/specs/2026-03-21-vibes-brainstorm-design.md`

---

### Task 1: Add invariant TinyBase rules to SKILL.md

**Files:**
- Modify: `skills/vibes/SKILL.md` (around line 440, the TinyBase Data API section)

These rules must be in SKILL.md so the agent sees them during both generation AND chat. They're independent of the brainstorm skill.

- [ ] **Step 1: Add mandatory useApp() rule**

After the existing `useApp()` documentation (line 461-465), add a prominent warning:

```markdown
### MANDATORY: Always Call useApp()

Every app MUST call `useApp()` in the root App component. This activates the sync connection. Without it, TinyBase data is local-only and never syncs across devices.

```jsx
function App() {
  const { isReady, isSyncing, user } = useApp();
  // ... rest of your app
}
```

This is not optional. Never skip it. Never move it to a child component.
```

- [ ] **Step 2: Add sync data modeling guidance**

After the Pattern Selection Guide (around line 562), add a new section:

```markdown
### Data Modeling for Sync

**What goes in TinyBase (syncs across devices):**
- Everything the user would expect to "still be there" when they come back
- Scores, progress, saved items, user-created content, settings
- In multiplayer: shared state that all users need to see

**What stays in useState (ephemeral, local only):**
- UI state: is a modal open, which tab is selected, hover state
- In-progress form input before the user submits
- Animations, transitions, temporary visual state

**User attribution — when multiple people use the app:**
Every row that belongs to a specific user must include `createdBy`:
```jsx
const addItem = useAddRowCallback(
  'items',
  (text) => ({
    text,
    createdBy: user?.email || 'anonymous',
    createdAt: Date.now(),
  }),
  [user],
);
```

To show only the current user's data, filter by `createdBy`:
```jsx
const allIds = useRowIds('scores');
// Filter in the component — TinyBase syncs all rows, filter on read
const myScores = allIds.filter(id => {
  const owner = useCell('scores', id, 'createdBy');
  return owner === user?.email;
});
```

**Single-player apps:** All persistent data goes in TinyBase. No user filtering needed — sync just gives the user their data on all their devices.

**Multiplayer apps:** Shared data goes in TinyBase with `createdBy` on user-owned rows. Each client sees all data; filter by user when showing "my stuff."
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd scripts && npm test`

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "docs: add mandatory useApp() and sync data modeling rules to SKILL.md"
```

---

### Task 2: Create the vibes-brainstorm skill

**Files:**
- Create: `skills/vibes-brainstorm/SKILL.md`

This is the core of the feature — the skill prompt that teaches Claude how to run the brainstorm.

- [ ] **Step 1: Create the skill directory and SKILL.md**

```bash
mkdir -p skills/vibes-brainstorm
```

Write `skills/vibes-brainstorm/SKILL.md` with this structure:

**Frontmatter:**
```yaml
---
name: vibes-brainstorm
description: Lightweight requirements gathering before app generation. Asks non-technical multiple-choice questions to understand user intent, then produces a brief for the generate prompt.
allowed-tools: Read, Glob, Grep
metadata:
  author: "Marcus Estes"
---
```

**Body sections:**

1. **Your Role** — You're helping a non-technical user clarify what they want to build before code generation begins. You ask short, friendly, multiple-choice questions. You never use technical jargon.

2. **How It Works** — Assess the user's prompt. Identify what you can confidently infer vs what's ambiguous. For each gap, ask ONE question with 2-4 concrete options. Maximum 5 questions total. Skip questions you can answer from the prompt.

3. **Question Framework** — Categories to draw from (not a checklist):
   - Who uses this? (just you / shared / real-time together)
   - What gets saved? (what persists between sessions)
   - What do others see? (same view / personal views / mix)
   - How does it work? (interaction patterns, specific to the app concept)

4. **Formatting choices** — Present each option on its own line, prefixed with `▸ `. This marker tells the chat UI to render clickable buttons:
   ```
   Who's going to use this?

   ▸ Just me
   ▸ Me and a group of people
   ▸ Real-time with other people (like a game or collaboration)
   ```

5. **Translation Layer** — Principles for mapping answers to data architecture (this section is for Claude, not shown to users):
   - "Just me" → all persistent state in TinyBase, no user attribution, sync gives cross-device access
   - "Shared with a group" → TinyBase with `createdBy: user?.email` on user-owned rows
   - "Real-time with others" → shared state in TinyBase, user attribution, ephemeral interaction state (drag, cursor) can use useState
   - "Personal views" → tag all rows with `createdBy`, filter by current user on read
   - "Same view" → no filtering, all rows visible to all clients

6. **The Brief** — When you have enough context, present a summary and ask "Ready to build?":
   ```
   Here's what I'll build:

   [2-3 sentence description of the app]

   - [key feature 1]
   - [key feature 2]
   - [data/sharing approach in plain language]

   ▸ Let's go!
   ▸ I want to change something
   ```

7. **Example Flows** — 3 worked examples:

   **"a board game":**
   - Q: Who's going to play? → [Just me / 2 players / A group]
   - Q: How do players take turns? → [Everyone moves at the same time / One at a time / Each person plays their own game]
   - Q: What should be saved between sessions? → [High scores / Game progress / Nothing, start fresh each time]
   - Brief: "A 2-player turn-based board game. Both players see the same board. High scores are saved per player."

   **"a recipe tracker":**
   - Q: Is this just for you, or will you share recipes with others? → [Just me / Share with family/friends]
   - Brief: "A personal recipe collection. Your recipes are saved and available on all your devices."

   **"a poll":**
   - (No questions needed — clearly shared, everyone sees results)
   - Brief: "A shared poll where anyone with the link can vote and see live results."

8. **After Confirmation** — When the user confirms, output the brief as a structured block that the generate system will use. Format:
   ```
   <vibes-brief>
   App: [description]
   Audience: [solo / shared / real-time multiplayer]
   Saves: [what persists]
   Sharing: [what others see, or "n/a" for solo]
   Key features: [list]
   </vibes-brief>
   ```
   Then tell the user: "Building your app now..." — the generate flow picks up from here.

- [ ] **Step 2: Commit**

```bash
git add skills/vibes-brainstorm/SKILL.md
git commit -m "feat: add vibes-brainstorm skill for pre-generation requirements gathering"
```

---

### Task 3: Clickable choice buttons in the editor chat UI

**Files:**
- Modify: `skills/vibes/templates/editor.html` (the chat rendering and WS message handler sections)

This adds the ability to render `▸ Option` lines as clickable buttons in assistant chat bubbles.

- [ ] **Step 1: Add CSS for choice buttons**

Find the existing chat bubble styles in the editor and add choice button styles nearby:

```css
.chat-bubble .choice-btn {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-top: 0.375rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.chat-bubble .choice-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.3);
}
.chat-bubble .choice-btn:active {
  background: rgba(255, 255, 255, 0.18);
}
.chat-bubble .choice-btn.chosen {
  border-color: var(--vibes-green, #4CAF50);
  background: rgba(76, 175, 80, 0.15);
}
.chat-bubble .choice-btn.dismissed {
  display: none;
}
```

- [ ] **Step 2: Add choice rendering to addMessage**

Modify the `addMessage` function. After setting `bubble.textContent = content`, detect `▸ ` prefixed lines and render them as buttons:

```javascript
// In addMessage, replace the simple textContent assignment for assistant role:
if (role === 'assistant' || role === 'system') {
  // Check for choice markers (▸ )
  const lines = content.split('\n');
  const textLines = [];
  const choices = [];
  for (const line of lines) {
    if (line.trim().startsWith('▸ ')) {
      choices.push(line.trim().slice(2));
    } else {
      textLines.push(line);
    }
  }

  bubble.textContent = textLines.join('\n');

  if (choices.length > 0) {
    const choiceContainer = document.createElement('div');
    choiceContainer.className = 'choice-container';
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = choice;
      btn.onclick = () => {
        // Send the choice as a user message
        sendChatMessage(choice);
        // Mark this as chosen, dismiss others
        btn.classList.add('chosen');
        choiceContainer.querySelectorAll('.choice-btn').forEach(b => {
          if (b !== btn) b.classList.add('dismissed');
        });
      };
      choiceContainer.appendChild(btn);
    }
    bubble.appendChild(choiceContainer);
  }
}
```

- [ ] **Step 3: Add sendChatMessage helper**

If not already present, add a function that sends a chat message programmatically (same as what happens when the user types and hits send):

```javascript
function sendChatMessage(text) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type: 'chat',
    message: text,
    app: currentAppName,
  }));
  addMessage('user', text);
  setThinking(true, null, 'Thinking...');
}
```

- [ ] **Step 4: Dismiss choice buttons when user types manually**

In the existing send button click handler or input submit handler, add logic to dismiss any visible choice buttons:

```javascript
// When user sends a typed message, dismiss any pending choices
document.querySelectorAll('.choice-container').forEach(c => {
  c.querySelectorAll('.choice-btn').forEach(b => b.classList.add('dismissed'));
});
```

- [ ] **Step 5: Also handle choices in streaming token flow**

The `token` event handler builds assistant bubbles incrementally. When streaming completes (on `complete` event), check the finalized bubble for `▸ ` lines and convert them to buttons. This handles the case where choices arrive via streaming.

In the `complete` handler, after `finalizeStreaming()`:

```javascript
// Convert any ▸ lines in the finalized bubble to clickable buttons
const lastBubble = document.querySelector('#chatMessages .chat-bubble.assistant:last-child');
if (lastBubble) convertChoiceMarkers(lastBubble);
```

Add a `convertChoiceMarkers(bubble)` function that scans the bubble's text content for `▸ ` lines and replaces them with buttons (same logic as Step 2 but operating on an existing DOM element).

- [ ] **Step 6: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: clickable choice buttons in chat for brainstorm Q&A"
```

---

### Task 4: Wire brainstorm into the generate flow

**Files:**
- Modify: `scripts/server/ws.ts` (the `generate` case)
- Modify: `scripts/server/prompt-builders.ts` (add `buildBrainstormPrompt`)

The generate flow needs to route through the brainstorm before building the app.

- [ ] **Step 1: Add buildBrainstormPrompt to prompt-builders.ts**

This function reads the vibes-brainstorm skill content and builds the initial prompt that starts the brainstorm conversation:

```typescript
export function buildBrainstormPrompt(
  ctx: ServerContext,
  userPrompt: string,
): string {
  // Read the vibes-brainstorm SKILL.md
  const skillPath = join(ctx.projectRoot, 'skills/vibes-brainstorm/SKILL.md');
  let skillContent = '';
  try {
    skillContent = readFileSync(skillPath, 'utf-8');
    // Strip YAML frontmatter
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    // Fallback: skip brainstorm if skill file missing
    return '';
  }

  return `${skillContent}

---

The user wants to build: "${userPrompt}"

Assess this prompt. If you can confidently infer all the key details (audience, what to save, sharing model), skip to the brief. Otherwise, ask your first question. Remember: non-technical language, multiple-choice with ▸ prefix, maximum 5 questions.`;
}
```

- [ ] **Step 2: Add invariant rules injection to buildGeneratePrompt**

In the existing `buildGeneratePrompt` function, add the mandatory TinyBase rules that must appear in every generate prompt regardless of brainstorm:

Find where the TinyBase instructions are injected (the large template string) and add:

```typescript
// After existing TinyBase patterns section:
const INVARIANT_RULES = `
## MANDATORY RULES (never skip these)

1. ALWAYS call useApp() in the root App component:
   const { isReady, isSyncing, user } = useApp();
   This activates sync. Without it, data is local-only.

2. ALL persistent data goes in TinyBase tables — not useState.
   useState is ONLY for ephemeral UI state (modals, hover, form input in progress).

3. For multiplayer/shared apps: include createdBy on every user-owned row:
   createdBy: user?.email || 'anonymous'

4. Cells are scalars only — strings, numbers, booleans. Never objects or arrays.
`;
```

- [ ] **Step 3: Modify the generate case in ws.ts**

Change the `generate` handler to start with the brainstorm instead of immediately generating:

```typescript
case 'generate': {
  if (!msg.prompt) {
    onEvent({ type: 'error', message: 'Please describe what you want to build.' });
    break;
  }

  // Create app directory from prompt
  const slug = slugifyPrompt(msg.prompt);
  const appName = resolveAppName(ctx.appsDir, slug);
  const newAppDir = join(ctx.appsDir, appName);
  mkdirSync(newAppDir, { recursive: true });
  onEvent({ type: 'app_created', name: appName });

  const themeId = msg.themeId || 'default';
  const themeColors = ctx.themeColors[themeId] || null;
  const themeName = ctx.themes?.[themeId]?.name || themeId;
  onEvent({ type: 'theme_selected', themeId, themeName, themeBackground: themeColors?.bg || null });

  // Switch to new app directory
  switchApp(ctx, newAppDir);
  appendMessage(newAppDir, { role: 'user', content: msg.prompt });

  // Start brainstorm — Claude will ask questions, then generate
  const brainstormPrompt = buildBrainstormPrompt(ctx, msg.prompt);
  if (brainstormPrompt) {
    // Brainstorm mode: Q&A first, then generation in same session
    const b = getOrCreateBridge(ctx, newAppDir);
    b.sendMessage(brainstormPrompt);
  } else {
    // Fallback: no brainstorm skill found, generate directly
    const result = buildGeneratePrompt(ctx, msg.prompt, {
      themeId: msg.themeId,
      reference: msg.reference,
      useAI: !!msg.useAI,
    });
    const b = getOrCreateBridge(ctx, newAppDir);
    b.sendMessage(result.prompt);
  }
  break;
}
```

**Important consideration:** The brainstorm runs as a multi-turn chat. When the user confirms and Claude says "Building your app now...", Claude needs the generate instructions (theme, style guide, TinyBase patterns) to actually write code. These should be included in the brainstorm prompt OR injected as context that Claude sees throughout the conversation.

The simplest approach: include the full generate prompt (theme, style guide, TinyBase rules) in the INITIAL brainstorm message, with a preamble that says "First, run the brainstorm. When the user confirms, use the instructions below to generate the app." This way Claude has everything it needs in one session.

Update `buildBrainstormPrompt` to accept and include the generate context:

```typescript
export function buildBrainstormPrompt(
  ctx: ServerContext,
  userPrompt: string,
  generateContext: string,  // The full generate prompt sans the user's description
): string {
  // ... read skill content ...

  return `${skillContent}

---

The user wants to build: "${userPrompt}"

When the user confirms the brief, use the following instructions to generate the app:

<generate-instructions>
${generateContext}
</generate-instructions>

Start now. Assess the prompt and either ask your first question or present the brief.`;
}
```

- [ ] **Step 4: Verify all tests pass**

Run: `cd scripts && npm test`

- [ ] **Step 5: Commit**

```bash
git add scripts/server/ws.ts scripts/server/prompt-builders.ts
git commit -m "feat: wire brainstorm into generate flow, add invariant TinyBase rules"
```

---

### Task 5: Update prompt builder to include invariant rules

**Files:**
- Modify: `scripts/server/prompt-builders.ts`

Ensure the invariant TinyBase rules (useApp mandatory, user attribution, cells are scalars) are included in every generate prompt, even when the brainstorm is skipped.

- [ ] **Step 1: Add INVARIANT_RULES constant**

At the top of prompt-builders.ts:

```typescript
const TINYBASE_INVARIANT_RULES = `
## MANDATORY (never skip)
1. ALWAYS call useApp() in the root App component: const { isReady, isSyncing, user } = useApp(); — this activates sync.
2. ALL persistent data in TinyBase tables. useState ONLY for ephemeral UI (modals, hover, in-progress form text).
3. For shared/multiplayer apps: every user-owned row must include createdBy: user?.email || 'anonymous'.
4. Cells are scalars only (string, number, boolean). Never objects or arrays.
`;
```

- [ ] **Step 2: Inject into buildGeneratePrompt**

Find where the TinyBase patterns block is constructed in `buildGeneratePrompt` and append `TINYBASE_INVARIANT_RULES` after it.

- [ ] **Step 3: Inject into buildChatPrompt**

The chat prompt should also include these rules so Claude follows them when editing existing apps. Find the rules/instructions block in `buildChatPrompt` and append `TINYBASE_INVARIANT_RULES`.

- [ ] **Step 4: Verify all tests pass**

Run: `cd scripts && npm test`

- [ ] **Step 5: Commit**

```bash
git add scripts/server/prompt-builders.ts
git commit -m "feat: inject mandatory TinyBase rules into all prompts"
```

---

### Task 6: Manual E2E testing

No code changes — this is a verification task.

- [ ] **Step 1: Rebuild templates**

```bash
bun scripts/merge-templates.js --force
```

- [ ] **Step 2: Start the server**

```bash
bun scripts/server.ts --mode=editor
```

- [ ] **Step 3: Test ambiguous prompt**

Type "a game" in the generate prompt. Verify:
- Claude asks a multiple-choice question (not a text prompt)
- Options appear as clickable buttons with `▸ ` prefix
- Clicking a button sends it as a user message
- After 1-5 questions, Claude presents a brief
- Confirming the brief starts generation
- Generated app calls `useApp()`
- Generated app uses TinyBase for persistent data

- [ ] **Step 4: Test detailed prompt**

Type "a shared grocery list where my roommates and I can add items, check them off, and see who added what" in the generate prompt. Verify:
- Claude asks 0-1 questions (prompt is detailed enough)
- Brief is presented quickly
- Generated app includes `createdBy` on rows

- [ ] **Step 5: Test choice button dismissal**

During a brainstorm question, type a custom answer instead of clicking a button. Verify the buttons dismiss.

- [ ] **Step 6: Commit any fixes**

```bash
git add <changed-files>
git commit -m "fix: brainstorm E2E fixes"
```
