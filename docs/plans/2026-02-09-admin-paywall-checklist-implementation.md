# Admin Paywall Checklist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a clear "Paywall Test Checklist" card to the Sell admin dashboard so testers know how to force or bypass the paywall.

**Architecture:** Update the Sell template markup to include a new informational card above the existing Quota Tools card. Add an integration test to assert the checklist text appears in assembled sell output.

**Tech Stack:** React-in-HTML template (`skills/sell/template.delta.html`), Vitest integration tests (`scripts/__tests__/integration/assembly-pipeline.test.js`).

### Task 1: Add a failing test for the new checklist copy

**Files:**
- Modify: `scripts/__tests__/integration/assembly-pipeline.test.js`
- Test: `scripts/__tests__/integration/assembly-pipeline.test.js`

**Step 1: Write the failing test**
Add a new expectation in the `sell-ready.jsx` suite after assembly to check for the checklist copy.

```js
const html = readFileSync(output, 'utf8');
expect(html).toContain('Paywall Test Checklist');
expect(html).toContain('Revoke = paywall. Grant = bypass.');
```

**Step 2: Run test to verify it fails**
Run:
```bash
cd scripts
npm run test:fixtures
```
Expected: FAIL because the checklist text is not yet in the template.

**Step 3: Commit the failing test**
```bash
git add scripts/__tests__/integration/assembly-pipeline.test.js
git commit -m "test: expect paywall checklist copy in sell output"
```

### Task 2: Add the Paywall Test Checklist card to the Sell admin template

**Files:**
- Modify: `skills/sell/template.delta.html`
- Test: `scripts/__tests__/integration/assembly-pipeline.test.js`

**Step 1: Implement the checklist card**
Insert a new card above the existing "Quota Tools" card, using the same card styling. Use this copy exactly:

Title: `Paywall Test Checklist`
Intro: `Use this quick checklist to force or bypass the paywall during testing.`
List:
1. `Find the target user ID (from Clerk or the claims table below).`
2. `Click Revoke to force the paywall for that user.`
3. `Have the user visit a new subdomain they do not already own.`
4. `They should see the paywall and complete checkout.`
5. `Click Grant to bypass the paywall for future tests.`
Rule-of-thumb: `Revoke = paywall. Grant = bypass.`
Note: `If a user already owns a subdomain, they may be redirected instead of seeing the paywall.`

**Step 2: Run tests to verify pass**
Run:
```bash
cd scripts
npm run test:fixtures
```
Expected: PASS.

**Step 3: Commit**
```bash
git add skills/sell/template.delta.html
git commit -m "feat: add paywall test checklist to admin"
```

### Task 3: Re-assemble sell output for local verification (optional but recommended)

**Files:**
- Modify (generated): `index.html`

**Step 1: Assemble**
Run:
```bash
node scripts/assemble-sell.js app.jsx index.html \
  --clerk-key "${VITE_CLERK_PUBLISHABLE_KEY}" \
  --app-name "trick-noisemaker" \
  --app-title "Trick Noisemaker" \
  --domain "trick-noisemaker.marcus-e.workers.dev" \
  --tagline "Your Pocket Prank Arsenal" \
  --subtitle "Create custom sound boards, share hilarious trick noises with friends, and discover the wildest effects from the community." \
  --billing-mode "required" \
  --features '["Unlimited custom sound boards with drag-and-drop creation","Share prank boards instantly with a single link","Community library of trick sounds and effects","Real-time sync across all your devices"]' \
  --admin-ids '["user_37iciZd4FJyNArSOQpoPU3yohcY"]'
```

**Step 2: Spot-check admin route**
Open:
`https://trick-noisemaker.marcus-e.workers.dev/?subdomain=admin`

**Step 3: Commit (if index.html is tracked on this branch)**
```bash
git add index.html
git commit -m "chore: reassemble sell output"
```

