# Vibes Brainstorm: Pre-Generation Requirements Gathering

Improve generated app quality by running a lightweight, non-technical Q&A before generation. Helps Claude understand user intent — especially data modeling and sync strategy — so it builds the right thing on the first try.

## Problem

Users submit short, low-information prompts ("a board game", "a recipe tracker"). Claude generates an app immediately but makes wrong assumptions about:

- Whether the app is single-player or multiplayer
- What data should persist between sessions
- What data should sync across devices
- How to attribute data to specific users
- Whether interactions are real-time or asynchronous

This produces apps where sync doesn't work, game state is lost on reload, or data from different users gets mixed together. The root cause: Claude starts coding before it has enough context.

## Design

### 1. Vibes Brainstorm Skill

A new standalone skill at `skills/vibes-brainstorm/` that runs before app generation. It is not a rigid questionnaire — it's an adaptive conversation where Claude identifies what it can't infer from the prompt and asks only what it needs.

**Principles:**
- Questions are non-technical. Users should never see words like "sync", "state management", "rows", "tables", or "CRDT." Questions are about features, saving, sharing, and how the app works.
- Questions are multiple-choice with 2-4 concrete options. The user can always type a custom answer instead.
- The number of questions adapts to the prompt. A detailed prompt ("a shared grocery list for my roommates with categories and checkboxes") might need 0-1 questions. An ambiguous prompt ("a game") might need 3-5.
- Maximum 5 questions before moving to generation.

**Question categories (user-facing language):**
- **Who uses this?** — "Is this just for you, or will other people use it too?" → [Just me / Shared with a group / Real-time with others]
- **What gets saved?** — "What should still be there when you come back tomorrow?" → options specific to the app type
- **What do others see?** — if shared: "Should everyone see the same thing, or does each person have their own view?" → [Same view / Personal views / Mix of both]
- **How does it work?** — key interaction patterns, presented as options. "How do players take turns?" → [Real-time / Turn-based / Each player plays solo]

Claude decides which categories to ask about and frames the specific options based on the app concept. Not every category is asked for every app.

**Data modeling translation layer:**

The skill prompt includes principles (not templates) that help Claude translate user answers into TinyBase architecture decisions:

- "Just me" → all data in TinyBase tables, no user attribution needed, sync gives the user their data on all their devices
- "Shared with a group" → all data in TinyBase, include `createdBy` on rows that belong to a specific person, consider what's visible to everyone vs personal
- "Real-time with others" → shared state in TinyBase tables with user attribution, ephemeral interaction state (drag position, cursor) can stay in useState if sub-second latency isn't critical
- "Each person has their own view" → tag all rows with `createdBy: user?.email`, filter queries by current user
- "Everyone sees the same thing" → no user filtering needed, all rows visible to all clients

These are reasoning frameworks, not rigid rules. Claude adapts them to the specific app.

**Example Q&A flows:**

The skill includes 2-3 worked examples showing how different prompts lead to different questions:

- "a board game" → Who plays? [Solo / 2 players / Group] → How do players interact? [Take turns / Real-time / Everyone plays independently] → What should be saved? [High scores / Game progress / Nothing] → Brief: "2-player turn-based board game, shared board state, per-user scores saved."
- "a recipe tracker" → Just for you or shared? [Just me / Share with family] → Brief: "Personal recipe collection, saved across devices, no sharing needed."
- "a poll" → Brief generated immediately — obvious shared app, no questions needed.

### 2. Clickable Choice Buttons in Chat

When the brainstorm presents a multiple-choice question, the options render as tappable buttons inside the assistant chat bubble.

**Implementation:**
- The assistant message includes a special marker for choices (e.g., options on separate lines prefixed with a bullet or emoji)
- The chat UI detects this pattern and renders clickable buttons
- Buttons are styled with existing editor conventions: monospace font, muted background (`var(--bg-secondary)` or similar), subtle border, hover highlight
- Clicking a button sends its label as a user chat message and dismisses the other options
- The normal text input remains active — users can always type a custom response
- If the user types instead of clicking, the buttons dismiss

**Styling:**
- Buttons appear as a vertical stack or horizontal row below the question text, inside the assistant bubble
- No new design language — consistent with existing chat bubble aesthetic
- Simple and tappable on both desktop and mobile

### 3. Generate Flow Change

**Current flow:**
```
User prompt → buildGeneratePrompt() → bridge.sendMessage() → app generated
```

**New flow:**
```
User prompt → transition to chat UI → brainstorm via persistent bridge →
  Q&A turns (0-5 questions) → user confirms brief →
  Claude generates within the same session → app created
```

**Mechanically:**
- The `generate` case in `ws.ts` sends the user's prompt through the bridge with the vibes brainstorm skill as the initial system context
- The brainstorm Q&A happens as normal chat turns through the persistent bridge
- When Claude finishes gathering requirements, it presents a brief summary and asks the user to confirm
- On confirmation, Claude transitions from brainstorming to code generation within the same conversation — no process restart, no new bridge
- The persistent bridge makes this natural: it's a multi-turn conversation where early turns gather requirements and later turns generate code

**The brainstorm is optional by design.** If Claude determines the prompt is clear enough (detailed prompt, obvious app pattern), it can skip straight to the brief confirmation and generate immediately.

### 4. Invariant SKILL.md Rules

These rules are enforced in every generated app regardless of brainstorm output. They belong in SKILL.md and the prompt builder:

**`useApp()` is mandatory:**
Every app must call `const { isReady, isSyncing, user } = useApp()` in the root App component. This activates the sync connection. Without it, TinyBase data is local-only and never syncs. No exceptions.

**All persistent data goes in TinyBase:**
`useState` is only for ephemeral UI state — which button is hovered, is a modal open, current form input text. Anything the user would expect to "still be there when they come back" goes in a TinyBase table.

**User attribution on shared data:**
When an app is used by multiple people, every row that belongs to a specific user must include `createdBy: user?.email || 'anonymous'` so data can be filtered and attributed. This enables per-user views in shared apps.

**Cells are scalars only:**
Strings, numbers, booleans. Never objects or arrays. TinyBase's CRDT merge is cell-level — concurrent edits to different fields inside a nested object will lose data. Flatten the data model.

## Files Changed

| File | Change |
|------|--------|
| `skills/vibes-brainstorm/SKILL.md` | New skill: brainstorm prompt with question framework, translation layer, and example flows |
| `skills/vibes/SKILL.md` | Add invariant rules: useApp() mandatory, persistent data in TinyBase, user attribution, cells are scalars |
| `scripts/server/ws.ts` | Generate case routes through brainstorm before generation |
| `scripts/server/prompt-builders.ts` | `buildGeneratePrompt()` accepts brainstorm brief, injects invariant TinyBase rules |
| `skills/vibes/templates/editor.html` | Choice button rendering in chat bubbles |

## What This Does NOT Change

- The vibes skill itself (generation, chat, theme handling)
- The persistent bridge architecture
- The deploy workflow
- Theme selection and style guides
- The editor UI layout (beyond adding clickable choices in chat)

## Testing

- Generate with a short ambiguous prompt ("a game") — verify brainstorm asks relevant questions with clickable choices
- Generate with a detailed prompt — verify brainstorm skips or asks minimal questions
- Verify clicking a choice button sends it as a chat message
- Verify typing a custom answer dismisses the buttons
- Verify the generated app calls `useApp()` and uses TinyBase for all persistent data
- Verify a multiplayer app includes `createdBy` on user-owned rows
- Verify sync works across two devices after generation
