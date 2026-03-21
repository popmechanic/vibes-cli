# TinyBase Prompt Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix prompt instructions so generated apps reliably use TinyBase hooks with simple string table names — no variables, no template literals, no abstraction layers over hooks.

**Architecture:** Update 3 files: SKILL.md (builder instructions), generate.ts (editor prompt), and the reference app example. Add explicit anti-patterns and a concrete "copy this" example to each prompt surface.

**Tech Stack:** Text editing only. No code changes.

---

## Root Cause

The builder generated `useRowIds('${tableId}')` — a template literal inside regular quotes, creating a literal string `${tableId}` that doesn't match any table. The builder wanted to abstract the table name but broke the hook call.

TinyBase docs show hooks always use **simple string literals**: `useRowIds('pets')`, `useCell('pets', 'fido', 'color')`. The Provider makes the store implicit — no store reference needed.

## Task 1: Harden SKILL.md

**Files:**
- Modify: `skills/vibes/SKILL.md`

- [ ] **Step 1: Add explicit rule to Core Rules section**

Find the "Core Rules" section. Add this rule:

```markdown
- **Simple string table names** - Always use string literals for table names: `useRowIds('todos')`, `useCell('items', id, 'name')`. NEVER abstract table names into variables, constants, or template literals. Each table name should be a plain string that appears directly in the hook call.
```

- [ ] **Step 2: Add anti-pattern to Common Mistakes**

Add to the Common Mistakes section:

```markdown
- **DON'T** abstract table names into variables or use template literals:
  ```jsx
  // BAD — variable table name breaks hook calls
  const TABLE = 'todos';
  const ids = useRowIds(TABLE);

  // BAD — template literal inside wrong quotes
  const ids = useRowIds('${tableId}');

  // GOOD — simple string literal directly in hook call
  const ids = useRowIds('todos');
  ```
- **DON'T** create wrapper functions around TinyBase hooks. Call them directly with string literals:
  ```jsx
  // BAD — unnecessary abstraction
  function useItems() { return useRowIds('items'); }

  // GOOD — direct hook call
  const itemIds = useRowIds('items');
  ```
```

- [ ] **Step 3: Add "Table Design" step to Generation Process**

After the Design Reasoning step (Step 1), add:

```markdown
### Step 1.1: Table Design

Before writing code, decide on your TinyBase tables in the `<design>` block:

```
<design>
Tables:
- 'items' — main data (cells: name, description, createdAt, done)
- 'categories' — grouping (cells: name, color)

Values:
- 'sortOrder' — current sort preference
- 'filterActive' — whether filter is on
</design>
```

Use descriptive, lowercase, plural table names. These exact strings will appear in every hook call throughout your code.
```

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "fix: harden SKILL.md against table name abstraction and hook wrapping"
```

---

## Task 2: Harden Editor Generate Prompt

**Files:**
- Modify: `scripts/server/handlers/generate.ts`

- [ ] **Step 1: Add concrete example to DATABASE block**

Find the two DATABASE instruction blocks in generate.ts. After the hook list, add a concrete mini-example and explicit anti-patterns:

```
EXAMPLE — a todo list using TinyBase (copy this pattern):
  const ids = useRowIds('todos');
  const addTodo = useAddRowCallback('todos', (text) => ({ text, done: false, createdAt: Date.now() }), []);
  // In child: const text = useCell('todos', id, 'text');
  // Toggle: useSetCellCallback('todos', id, 'done', (_e) => (curr) => !curr);
  // Delete: useDelRowCallback('todos', id);

CRITICAL: Table names MUST be simple string literals ('todos', 'items', 'notes').
NEVER use variables, constants, or template literals for table names.
WRONG: useRowIds(tableName)  useRowIds('${tableId}')  useRowIds(TABLE_NAME)
RIGHT: useRowIds('todos')    useCell('todos', id, 'text')
```

Apply this to BOTH DATABASE blocks (reference path ~line 195 and theme path ~line 315).

- [ ] **Step 2: Commit**

```bash
git add scripts/server/handlers/generate.ts
git commit -m "fix: add concrete TinyBase example and anti-patterns to editor prompts"
```

---

## Task 3: Harden Editor Chat Prompt

**Files:**
- Modify: `scripts/server/handlers/chat.ts`

- [ ] **Step 1: Add table name rule to chat RULES block**

Find the RULES section in the chat prompt (~line 211). Add:

```
- Table names are always simple string literals ('todos', 'items'). Never refactor them into variables or constants.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/server/handlers/chat.ts
git commit -m "fix: add table name rule to chat prompt"
```

---

## Task 4: Test and Verify

- [ ] **Step 1: Restart editor server**

- [ ] **Step 2: Generate a fresh app**

Use a simple prompt like "make me a todo list" and verify the generated code uses string literal table names like `useRowIds('todos')`.

- [ ] **Step 3: Deploy and test sync**

Deploy the new app and verify data syncs between two browser tabs.
