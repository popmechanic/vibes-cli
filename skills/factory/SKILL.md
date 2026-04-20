---
name: factory
argument-hint: "[app-name]"
description: Self-contained SaaS pipeline — invoke directly, do not decompose. Generates a factory app with landing page, Stripe subscription checkout, Vibe Token economics, and deploys to Cloudflare Workers. Use when the user wants to monetize an app, add billing, create token-backed revenue sharing, or turn an app into a business.
license: MIT
allowed-tools: Read, Write, Bash, Glob, AskUserQuestion
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:factory". Do not decompose the steps below into separate plan tasks.

**Display this ASCII art immediately when starting:**

```
░▒▓████████▓▒░░▒▓██████▓▒░ ░▒▓██████▓▒░▒▓████████▓▒░░▒▓██████▓▒░░▒▓███████▓▒░░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░
░▒▓██████▓▒░ ░▒▓████████▓▒░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░  ░▒▓██████▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░   ░▒▓█▓▒░  ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░   ░▒▓█▓▒░
```

## Quick Navigation

- [Critical Rules](#-critical-rules---read-first-) - Read this first
- [Step 1: Pre-Flight](#step-1-pre-flight) - Verify prerequisites
- [Step 2: Subscription Pricing](#step-2-subscription-pricing) - Set monthly price
- [Step 3: AI Token Billing](#step-3-ai-token-billing) - Configure AI margins
- [Step 4: Vibe Token Config](#step-4-vibe-token-configuration) - Set revenue share
- [Step 5: Stripe Connect](#step-5-stripe-connect-onboarding) - Developer onboarding
- [Step 6: Deploy](#step-6-deploy) - Build and deploy
- [Step 7: Generate Invite Codes](#step-7-generate-invite-codes-optional) - Invite partners

---

## CRITICAL RULES - READ FIRST

**DO NOT generate code manually.** This skill uses pre-built scripts and API calls:

| Step | Tool | What it does |
|------|------|--------------|
| Assembly | `assemble-factory.js` | Generates unified index.html |
| Deploy | `deploy-cloudflare.js` | Deploys to Cloudflare Workers |
| Configure | `POST /app/configure` | Stores billing config in KV |
| Initialize | `POST /token/:appName/initialize` | Sets up Vibe Token economics |
| Grant | `POST /token/:appName/grant` | Grants tokens to partners |

**Script location:**
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
```

**Factory API base:** `https://factory.vibesos.com`

---

# Factory - App Monetization Pipeline

Transform your Vibes app into a revenue-generating SaaS with token-backed contributor rewards.

## Architecture

The factory skill sets up:
- **Stripe Subscriptions** — flat monthly price + metered AI token billing
- **Vibe Token Economics** — revenue-sharing tokens for distribution partners
- **Factory Dashboard** — manage tokens, view revenue, process payouts

All configuration is stored in the factory worker. Token state lives in a Durable Object per app.

---

### Terminal or Editor UI?

Detect whether you're running in a terminal (Claude Code CLI) or an editor. **Terminal agents** use `AskUserQuestion` for all input. **Editor agents** present requirements as a checklist comment, wait for user edits, then proceed. See the vibes skill for the full detection and interaction pattern.

## Step 1: Pre-Flight

**Before starting, verify these prerequisites. STOP if any check fails.**

### 1.1 Auth Check

Auth is automatic — on first deploy, a browser window opens for Pocket ID login. Tokens are cached at `~/.vibes/auth.json` for subsequent deploys.

### 1.2 Detect Existing App

```bash
ls -la app.jsx 2>/dev/null || echo "NOT_FOUND"
```

**Decision tree:**
- Found `app.jsx` -> Proceed to Step 2
- Found multiple `riff-*/app.jsx` -> Ask user to select one
- Found nothing -> Tell user to run `/vibes:vibes` first

### 1.3 Check Existing Config

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
APP_NAME="${1:-}"
if [ -n "$APP_NAME" ]; then
  curl -s "https://factory.vibesos.com/connect/status/$APP_NAME" \
    -H "Authorization: Bearer $(cat ~/.vibes/auth.json | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")" 2>/dev/null
fi
```

If the app already has billing configured, offer to update or show current config.

### 1.4 Pre-Flight Summary

> "Pre-flight checks passed:
> - App found (app.jsx)
> - Auth is automatic via Pocket ID
>
> Ready to configure your app factory."

---

## Step 2: Subscription Pricing

Use AskUserQuestion:

```
Question 1: "What should your app cost per month?"
Header: "Monthly Price"
Options:
- "$5/month"
- "$10/month"
- "$25/month"
- Other (enter custom amount)
Description: "This is the flat monthly subscription price. AI token usage is billed separately."

Question 2: "Offer a free trial?"
Header: "Free Trial"
Options:
- "No trial"
- "7-day trial"
- "14-day trial"
Description: "Trial lets users try before paying. Stripe handles the trial period automatically."
```

Store: `price` (number, dollars), `trialDays` (number, 0/7/14)

---

## Step 3: AI Token Billing

Use AskUserQuestion:

```
Question: "Does your app use AI features?"
Header: "AI Billing"
Options:
- Label: "No AI features"
  Description: "Skip AI billing setup"
- Label: "Yes, 2x margin (recommended)"
  Description: "Customers pay 2x the model cost. You keep the difference."
- Label: "Yes, 3x margin"
  Description: "Higher margin, customers pay 3x model cost."
- Label: "Yes, custom margin"
  Description: "Enter your own multiplier."
```

If AI is enabled, explain:
> "OpenRouter routes to the underlying provider; the factory worker meters token usage per customer and posts events to a shared Stripe Billing Meter. Your customers will see AI usage as a line item on their monthly invoice alongside the flat subscription fee."

Store: `aiMarginPercent` (number: 0 for no AI, 200 for 2x, 300 for 3x, etc.)

---

## Step 4: Vibe Token Configuration

Use AskUserQuestion:

```
Question: "What percentage of revenue should flow to token holders? This is locked forever."
Header: "Revenue Share (Alpha)"
Options:
- "10% — Conservative"
- "15% — Balanced"
- "20% — Generous (recommended)"
- "25% — Very generous"
- Other (enter custom %)
Description: "Alpha determines how much of each invoice goes to Vibe Token holders. Higher alpha = more attractive to partners, but less developer take-home. This cannot be changed after launch."
```

Store: `alpha` (number, 0.10-0.50)

**Auto-calculate remaining parameters:**

```javascript
const k = Math.max((price * 12) / 10_000_000, 0.005);
const preMint = Math.round(100 * price * 12);
const initialPrice = k * Math.sqrt(1000); // price at s_min
```

**Show summary and confirm:**

Use AskUserQuestion:
```
Question: "Confirm these token economics? (This is permanent)"
Header: "Token Summary"
Options:
- "Confirm and proceed"
- "Go back and adjust"
Description: |
  Revenue Share: {alpha*100}%
  Pricing Constant (k): {k}
  Treasury Size: {preMint} tokens
  Initial Token Price: ${initialPrice.toFixed(4)}
  Formula: P = {k} * sqrt(supply)

  At 100 subscribers ($X/mo each):
  - Monthly revenue: ${price * 100}
  - Token holder pool: ${Math.floor(alpha * price * 100 * 100)/100}
  - Token price: ${(k * Math.sqrt(1000 + preMint * 0.1)).toFixed(4)}
```

---

## Step 5: Stripe Connect Onboarding

**Get the auth token:**
```bash
TOKEN=$(cat ~/.vibes/auth.json | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null || echo "")
```

**Create Stripe Connect account:**
```bash
curl -s -X POST "https://factory.vibesos.com/connect/onboard" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"appName\": \"$APP_NAME\"}"
```

Expected response: `{ "ok": true, "url": "https://connect.stripe.com/...", "accountId": "acct_..." }`

**Open the onboarding URL in the user's browser:**
```bash
open "$ONBOARD_URL"  # macOS
```

**Poll for completion:**
```bash
while true; do
  STATUS=$(curl -s "https://factory.vibesos.com/connect/status/$APP_NAME" \
    -H "Authorization: Bearer $TOKEN")
  COMPLETE=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('complete', False))")
  if [ "$COMPLETE" = "True" ]; then
    echo "Stripe Connect onboarding complete!"
    break
  fi
  sleep 5
done
```

Store: `stripeConnectAccountId` from the response

---

## Step 6: Deploy

### 6.1 Store Billing Configuration

```bash
curl -s -X POST "https://factory.vibesos.com/app/configure" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"appName\": \"$APP_NAME\",
    \"stripeConnectAccountId\": \"$ACCOUNT_ID\",
    \"price\": $PRICE,
    \"aiMarginPercent\": $AI_MARGIN,
    \"vibeToken\": {
      \"alpha\": $ALPHA,
      \"k\": $K,
      \"preMint\": $PREMINT
    }
  }"
```

### 6.2 Assemble Factory App

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/assemble-factory.js" app.jsx index.html \
  --app-name "$APP_NAME" \
  --app-title "$APP_TITLE" \
  --domain "$APP_NAME.vibesos.com" \
  --tagline "$TAGLINE" \
  --subtitle "$SUBTITLE" \
  --billing-mode "required" \
  --features "$FEATURES_JSON" \
  --admin-ids '[]'
```

### 6.3 Deploy to Cloudflare

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name "$APP_NAME" \
  --file index.html
```

### 6.4 Initialize Vibe Token Engine

```bash
curl -s -X POST "https://factory.vibesos.com/token/$APP_NAME/initialize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

The initialize endpoint reads the billing config from KV and creates the VibeTokenDO with the correct alpha, k, and preMint values.

### 6.5 Verify Deployment

```bash
curl -s -o /dev/null -w "%{http_code}" "https://$APP_NAME.vibesos.com"
```

Expected: `200`

---

## Step 7: Generate Invite Codes (Optional)

Use AskUserQuestion:

```
Question: "Would you like to generate invite codes for distribution partners now?"
Header: "Distribution Partners"
Options:
- Label: "Yes, generate invites"
  Description: "Create shareable codes that grant Vibe Tokens to whoever claims them."
- Label: "Skip for now"
  Description: "You can generate codes later from the dashboard."
```

**If generating invites:**

Use AskUserQuestion (repeatable):
```
Question: "How many tokens should this invite grant?"
Header: "Invite tokens"
Options:
- "500 tokens"
- "1000 tokens"
- "2500 tokens"
- Other (enter amount)
```

**For each invite, call the API:**

```bash
RESULT=$(curl -s -X POST "https://factory.vibesos.com/invite/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"appName\": \"$APP_NAME\", \"tokens\": $TOKEN_AMOUNT}")

CODE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])")
URL=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")
echo "Share this URL: $URL"
```

**Output:**

```
Invite 1: {CODE} — {TOKENS} tokens
  Claim URL: {URL}
```

---

## Completion Summary

Present the final summary:

> **Your app factory is live!**
>
> **App URL:** `https://{appName}.vibesos.com`
> **Dashboard:** `https://factory.vibesos.com/dashboard/apps/{appName}`
>
> **Configuration:**
> - Monthly price: ${price}/mo
> - AI margin: {aiMarginPercent}%
> - Revenue share (alpha): {alpha*100}%
> - Treasury: {preMint} tokens
> - Token price: ${initialPrice.toFixed(4)}
>
> **What happens next:**
> - Customers subscribe at your landing page
> - Revenue auto-distributes to token holders
> - Referrers earn new tokens from customers they bring
> - Monthly payouts transfer earnings to Stripe Connect accounts
> - Manage everything at the dashboard

## What's Next?

```
Question: "Your factory is deployed! What would you like to do?"
Header: "Next"
Options:
- Label: "Open dashboard"
  Description: "View your app at factory.vibesos.com/dashboard"
- Label: "Grant more tokens"
  Description: "Invite additional distribution partners"
- Label: "Customize landing page"
  Description: "Adjust colors, tagline, and features"
- Label: "I'm done for now"
  Description: "Your factory is live and accepting customers"
```
