---
globs:
  - "**/SharingBridge*"
  - "**/sharing*"
  - "**/invite*"
  - skills/*/template.delta.html
  - bundles/fireproof-oidc-bridge.js
description: Sharing and invite architecture for Fireproof collaboration
---

# Sharing / Invite Architecture

Users invite collaborators via the VibesPanel invite UI. The architecture uses a DOM event bridge pattern.

## DOM Event Bridge

VibesPanel (inside HiddenMenuWrapper) dispatches DOM events. SharingBridge (inside `OIDCProvider > SignedIn`) listens and calls `dashApi`:

```
VibesPanel → dispatches 'vibes-share-request' {email, right}
SharingBridge → calls dashApi.inviteUser() via useOIDCContext()
SharingBridge → dispatches 'vibes-share-success' or 'vibes-share-error'
VibesPanel → listens for result events, shows BrutalistCard feedback
```

**Why a bridge?** `useVibesPanelEvents()` runs outside `OIDCProvider` (called at AppWrapper top level), so it can't access `dashApi`. SharingBridge lives inside the provider tree.

## Ledger Discovery

SharingBridge calls `dashApi.listLedgersByUser({})` to find the current app's ledger. Matches by hostname (ledger name contains `window.location.hostname`), falls back to first ledger. Cached after first call.

## Available dashApi Methods

| Method | Purpose |
|--------|---------|
| `inviteUser({ ticket })` | Send invitation by email |
| `listLedgersByUser({})` | List user's ledgers for discovery |
| `findUser({ query })` | Look up users |

## useSharing Hook (for user app code)

Conditionally exported via `window.useSharing` in the delta template's `initApp()`:

```javascript
const { useSharing } = window;
const { inviteUser, listInvites, deleteInvite, findUser, ready } = useSharing();
```
