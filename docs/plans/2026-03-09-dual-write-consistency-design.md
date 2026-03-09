# Dual-Write Consistency: KV-Authoritative Access Control with Pocket ID Sync

**Date:** 2026-03-09
**Depends on:** `2026-03-09-access-control-audit.md`

---

## Problem

KV registry and Pocket ID groups are written independently during deploy and invite flows. Six concrete divergence scenarios exist where one system gets written and the other doesn't — and there's zero reconciliation infrastructure. The `removeCollaborator()` function exists in registry-logic.ts but is never exposed as an HTTP endpoint, so orphaned access can't be cleaned up.

## Principle

KV registry is the source of truth for all access decisions. Pocket ID group membership is a **derived effect** — kept in sync via retries, flags, and reconciliation. Every write to collaborator state goes through KV first, then propagates to Pocket ID.

---

## Data Model Changes

### Collaborator (KV)

```typescript
Collaborator {
  email: string;
  userId?: string;
  status: 'invited' | 'active';
  right: 'read' | 'write';
  ledgerId?: string;
  inviteId?: string;
  invitedAt: string;
  joinedAt?: string;
  // NEW fields
  pocketIdSynced: boolean;        // false if Pocket ID write failed/pending
  pocketIdSyncError?: string;     // last error message
  pocketIdSyncAttempts?: number;  // retry count
  lastSyncAttempt?: string;       // ISO timestamp
}
```

### SubdomainRecord (KV)

```typescript
SubdomainRecord {
  ownerId: string;
  claimedAt: string;
  collaborators: Collaborator[];
  status: 'active' | 'frozen';
  frozenAt?: string;
  oidcClientId?: string;
  userGroupId?: string;
  // NEW fields
  pocketIdGroupSynced: boolean;   // false if group creation failed on deploy
  pendingRemovals?: PendingRemoval[]; // collaborators removed from KV but not yet from Pocket ID
}

PendingRemoval {
  email: string;
  userId?: string;
  removedAt: string;
  attempts: number;
  lastAttempt?: string;
  error?: string;
}
```

---

## Write Path Changes

### Deploy (`POST /deploy`)

1. Register app in Pocket ID (create client + group) — up to 3 retries with exponential backoff
2. Write KV record. If Pocket ID registration failed, set `pocketIdGroupSynced: false` and store empty `oidcClientId`/`userGroupId`
3. No more silent null-swallowing — failure is tracked in the record

### Invite (`POST /apps/:name/invite`)

1. Write collaborator to KV first with `pocketIdSynced: false`
2. Call Pocket ID: `findOrCreateUser` → `addUsersToGroup` → `createOneTimeAccessToken` — up to 3 retries
3. On success: update KV `pocketIdSynced: true`
4. On failure: leave `pocketIdSynced: false`, return 207 (partial success) with invite URL omitting OTA token, and `sync: "pending"` in response body

### Remove (`DELETE /apps/:name/collaborators/:email`) — NEW

1. Remove collaborator from KV record
2. Remove user from Pocket ID group — up to 3 retries
3. If Pocket ID removal fails: add entry to `pendingRemovals` array on SubdomainRecord so reconciliation can clean it up

### SharingBridge Changes

- Remove direct KV POST (step 3 of the current triple-write). The Deploy API invite endpoint now handles both KV and Pocket ID writes.
- Reduces triple-write to double-write: Deploy API + Fireproof Connect
- If Deploy API fails, still attempt Fireproof Connect (data sync is independent of access control)

---

## Reconciliation Endpoints

Both on the Deploy API Worker. Authenticated via API key or owner JWT.

### `POST /admin/reconcile/:subdomain` — Single Subdomain

1. Read KV record
2. If `pocketIdGroupSynced: false`: retry group creation in Pocket ID
3. For each collaborator with `pocketIdSynced: false`: retry `addUsersToGroup`
4. For each entry in `pendingRemovals`: retry removal from Pocket ID group
5. Fetch Pocket ID group members, diff against KV collaborators:
   - In Pocket ID group but not in KV → remove from Pocket ID group
   - In KV (active) but not in Pocket ID group → add to Pocket ID group
6. Return diff report: `{ fixed: [], alreadySynced: [], failed: [] }`

### `POST /admin/reconcile` — Bulk Sweep

1. List all subdomain KV keys
2. Filter to records with `pocketIdGroupSynced: false` OR any collaborator with `pocketIdSynced: false` OR any `pendingRemovals`
3. Run single-subdomain reconciliation for each
4. Return summary: `{ total, synced, failed, details[] }`

---

## Retry Strategy

```
Attempt 1: immediate
Attempt 2: 500ms delay
Attempt 3: 2000ms delay
```

All retries inline during the request. If all 3 fail, the sync flag is set and the request completes with partial success.

---

## Error Reporting

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| KV + Pocket ID both succeed | 200/201 | Normal response |
| KV succeeds, Pocket ID fails after retries | 207 | `{ ok: true, sync: "pending", error: "..." }` |
| KV fails | 500 | Full failure, nothing written |
| Reconciliation fix succeeds | 200 | `{ fixed: [...] }` |
| Reconciliation fix partially fails | 200 | `{ fixed: [...], failed: [...] }` |

---

## Files Affected

| File | Change |
|------|--------|
| `deploy-api/src/index.ts` | Reorder writes (KV first), add retry logic, add remove endpoint, add reconcile endpoints |
| `deploy-api/src/pocket-id.ts` | Add `removeUsersFromGroup()`, `listGroupMembers()` methods |
| `deploy-api/src/types.ts` | Update `SubdomainRecord`, `Collaborator` types with sync fields |
| `skills/cloudflare/worker/src/lib/registry-logic.ts` | Update types, expose `removeCollaborator` in HTTP routes |
| `skills/cloudflare/worker/src/lib/kv-storage.ts` | Handle new fields in read/write |
| `source-templates/base/template.html` | Remove KV POST from SharingBridge (step 3 of triple-write) |
| `skills/cloudflare/worker/src/index.ts` | No new routes needed (remove endpoint lives on Deploy API) |

---

## Out of Scope

- Audit logging (separate feature)
- Role granularity beyond read/write (separate feature)
- Multi-authority OIDC (not planned)
- Automatic cron-based reconciliation (use manual sweep for now)
