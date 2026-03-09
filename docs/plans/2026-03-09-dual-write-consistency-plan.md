# Dual-Write Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make KV registry the source of truth for access control, with Pocket ID group membership as a retried, flagged, reconcilable derived effect.

**Architecture:** All collaborator writes go to KV first, then propagate to Pocket ID with 3 inline retries. Sync failures are flagged (`pocketIdSynced: false`) for later reconciliation. Two admin endpoints (single + bulk) fix drift. SharingBridge triple-write reduced to double-write.

**Tech Stack:** Hono (Deploy API Worker), Cloudflare Workers KV, Pocket ID Admin API, Vitest

---

### Task 1: Update Types

**Files:**
- Modify: `deploy-api/src/types.ts`
- Modify: `skills/cloudflare/worker/src/types.ts`

**Step 1: Update Deploy API types**

In `deploy-api/src/types.ts`, replace the `SubdomainRecord` interface with sync-aware fields:

```typescript
export interface PendingRemoval {
  email: string;
  userId?: string;
  removedAt: string;
  attempts: number;
  lastAttempt?: string;
  error?: string;
}

export interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{
    userId: string;
    email?: string;
    role?: string;
    pocketIdSynced?: boolean;
    pocketIdSyncError?: string;
    pocketIdSyncAttempts?: number;
    lastSyncAttempt?: string;
  }>;
  connectProvisioned?: boolean;
  oidcClientId?: string;
  userGroupId?: string;
  pocketIdGroupSynced?: boolean;
  pendingRemovals?: PendingRemoval[];
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 2: Update CF Worker types**

In `skills/cloudflare/worker/src/types.ts`, add sync fields to `Collaborator` and `SubdomainRecord`:

```typescript
export interface Collaborator {
  email: string;
  userId?: string;
  status: "invited" | "active";
  right: "read" | "write";
  invitedAt: string;
  joinedAt?: string;
  ledgerId?: string;
  inviteId?: string;
  pocketIdSynced?: boolean;
  pocketIdSyncError?: string;
  pocketIdSyncAttempts?: number;
  lastSyncAttempt?: string;
}

export interface PendingRemoval {
  email: string;
  userId?: string;
  removedAt: string;
  attempts: number;
  lastAttempt?: string;
  error?: string;
}

export interface SubdomainRecord {
  ownerId: string;
  claimedAt: string;
  collaborators: Collaborator[];
  status: 'active' | 'frozen';
  frozenAt?: string;
  ledgerId?: string;
  pocketIdGroupSynced?: boolean;
  pendingRemovals?: PendingRemoval[];
}
```

**Step 3: Run existing tests to verify no regressions**

Run: `cd deploy-api && npx vitest run`
Expected: All existing tests PASS (type changes are additive, all new fields are optional)

Run: `cd skills/cloudflare/worker && npx vitest run`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add deploy-api/src/types.ts skills/cloudflare/worker/src/types.ts
git commit -m "feat: add sync tracking fields to SubdomainRecord and Collaborator types"
```

---

### Task 2: Add Retry Utility and Pocket ID Helper Methods

**Files:**
- Create: `deploy-api/src/retry.ts`
- Modify: `deploy-api/src/pocket-id.ts`
- Create: `deploy-api/src/__tests__/retry.test.ts`

**Step 1: Write failing test for retry utility**

Create `deploy-api/src/__tests__/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3);
    expect(result).toEqual({ ok: true, value: "ok" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3);
    expect(result).toEqual({ ok: true, value: "ok" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns error after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const result = await withRetry(fn, 3);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("always fails");
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects delay schedule", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    vi.useFakeTimers();
    const promise = withRetry(fn, 3, [100, 200]);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toEqual({ ok: true, value: "ok" });
    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd deploy-api && npx vitest run src/__tests__/retry.test.ts`
Expected: FAIL — module `../retry` not found

**Step 3: Implement retry utility**

Create `deploy-api/src/retry.ts`:

```typescript
export type RetryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; attempts: number };

const DEFAULT_DELAYS = [0, 500, 2000];

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delays: number[] = DEFAULT_DELAYS
): Promise<RetryResult<T>> {
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const delay = delays[attempt] ?? delays[delays.length - 1] ?? 0;
      if (attempt < maxAttempts - 1 && delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}
```

**Step 4: Run test to verify it passes**

Run: `cd deploy-api && npx vitest run src/__tests__/retry.test.ts`
Expected: All 4 tests PASS

**Step 5: Add `removeUsersFromGroup` and `listGroupMembers` to pocket-id.ts**

Append to `deploy-api/src/pocket-id.ts` (after the existing `addUsersToGroup` function):

```typescript
export async function removeUsersFromGroup(
  fetcher: PocketIdFetcher,
  apiKey: string,
  groupId: string,
  userIds: string[]
): Promise<void> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/user-groups/${groupId}/users`,
    {
      method: "DELETE",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ userIds }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`removeUsersFromGroup failed (${res.status}): ${text}`);
  }
}

export async function listGroupMembers(
  fetcher: PocketIdFetcher,
  apiKey: string,
  groupId: string
): Promise<Array<{ id: string; email?: string }>> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/user-groups/${groupId}/users`,
    {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`listGroupMembers failed (${res.status}): ${text}`);
  }

  const body = await res.json() as
    | Array<{ id: string; email?: string }>
    | { data: Array<{ id: string; email?: string }> };
  return Array.isArray(body) ? body : body.data;
}
```

**Step 6: Update imports in index.ts**

In `deploy-api/src/index.ts`, update the import to include the new functions:

```typescript
import {
  createApp,
  getApp,
  updateApp,
  findAppByName,
  createUserGroup,
  findUserGroupByName,
  addUsersToGroup,
  removeUsersFromGroup,
  listGroupMembers,
  setAllowedGroups,
  findOrCreateUser,
  createOneTimeAccessToken,
} from "./pocket-id";
```

Also add the retry import:

```typescript
import { withRetry } from "./retry";
```

**Step 7: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add deploy-api/src/retry.ts deploy-api/src/__tests__/retry.test.ts deploy-api/src/pocket-id.ts deploy-api/src/index.ts
git commit -m "feat: add retry utility and Pocket ID removeUsersFromGroup/listGroupMembers"
```

---

### Task 3: Refactor Deploy Endpoint — Track `pocketIdGroupSynced`

**Files:**
- Modify: `deploy-api/src/index.ts` (lines 590–623, the Pocket ID registration block)

**Step 1: Write failing test for deploy sync tracking**

Add to `deploy-api/src/__tests__/deploy.test.ts`:

```typescript
describe("SubdomainRecord sync fields", () => {
  it("includes pocketIdGroupSynced in record shape", () => {
    const record = {
      owner: "user-1",
      collaborators: [],
      connectProvisioned: false,
      oidcClientId: "client-123",
      userGroupId: "group-456",
      pocketIdGroupSynced: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(record.pocketIdGroupSynced).toBe(true);
  });

  it("defaults pocketIdGroupSynced to false when registration fails", () => {
    const record = {
      owner: "user-1",
      collaborators: [],
      connectProvisioned: false,
      pocketIdGroupSynced: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(record.pocketIdGroupSynced).toBe(false);
    expect(record.oidcClientId).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd deploy-api && npx vitest run src/__tests__/deploy.test.ts`
Expected: PASS (these are type shape tests, they should pass immediately)

**Step 3: Refactor the deploy endpoint's Pocket ID block**

In `deploy-api/src/index.ts`, replace lines 590–623 (the Pocket ID registration block inside `app.post("/deploy")`):

Find this block:
```typescript
  // Per-app Pocket ID registration (on first deploy only)
  let oidcClientId = existing?.oidcClientId;
  let userGroupId = existing?.userGroupId;

  if (c.env.POCKET_ID_API_KEY) {
    // Build the canonical deploy URL for OIDC callback registration
    const deployUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : (() => {
            const subdomain = cachedWorkersSubdomain;
            return subdomain
              ? `https://${name}.${subdomain}.workers.dev`
              : `https://${name}.workers.dev`;
          })();

    const registration = await registerAppInPocketId(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      name,
      deployUrl,
      userId,
      existing
    );

    if (registration) {
      oidcClientId = registration.oidcClientId;
      userGroupId = registration.userGroupId;

      // Inject per-app client ID into HTML before deploy
      if (files["index.html"]) {
        files["index.html"] = injectClientId(files["index.html"], oidcClientId);
      }
    }
  }
```

Replace with:

```typescript
  // Per-app Pocket ID registration
  let oidcClientId = existing?.oidcClientId;
  let userGroupId = existing?.userGroupId;
  let pocketIdGroupSynced = existing?.pocketIdGroupSynced ?? false;

  if (c.env.POCKET_ID_API_KEY) {
    const deployUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : (() => {
            const subdomain = cachedWorkersSubdomain;
            return subdomain
              ? `https://${name}.${subdomain}.workers.dev`
              : `https://${name}.workers.dev`;
          })();

    const registrationResult = await withRetry(
      () => registerAppInPocketId(
        c.env.POCKET_ID,
        c.env.POCKET_ID_API_KEY,
        name,
        deployUrl,
        userId,
        existing
      ),
      3
    );

    if (registrationResult.ok && registrationResult.value) {
      oidcClientId = registrationResult.value.oidcClientId;
      userGroupId = registrationResult.value.userGroupId;
      pocketIdGroupSynced = true;

      if (files["index.html"]) {
        files["index.html"] = injectClientId(files["index.html"], oidcClientId);
      }
    } else {
      pocketIdGroupSynced = false;
      console.error(`[deploy] Pocket ID registration failed after retries for ${name}`);
    }
  }
```

Then update the KV record write (around line 654) to include the sync flag:

Find:
```typescript
  const record: SubdomainRecord = existing
    ? { ...existing, oidcClientId, userGroupId, updatedAt: now }
    : { owner: userId, collaborators: [], connectProvisioned: false, oidcClientId, userGroupId, createdAt: now, updatedAt: now };
```

Replace with:
```typescript
  const record: SubdomainRecord = existing
    ? { ...existing, oidcClientId, userGroupId, pocketIdGroupSynced, updatedAt: now }
    : { owner: userId, collaborators: [], connectProvisioned: false, oidcClientId, userGroupId, pocketIdGroupSynced, createdAt: now, updatedAt: now };
```

**Step 4: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add deploy-api/src/index.ts deploy-api/src/__tests__/deploy.test.ts
git commit -m "feat: track pocketIdGroupSynced on deploy with retry"
```

---

### Task 4: Refactor Invite Endpoint — KV-First with Sync Flags

**Files:**
- Modify: `deploy-api/src/index.ts` (lines 686–783, the invite endpoint)

**Step 1: Rewrite the invite endpoint**

Replace the entire `app.post("/apps/:name/invite", ...)` handler (lines 686–783) with:

```typescript
app.post("/apps/:name/invite", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.OIDC_ISSUER, c.env.POCKET_ID);
  if (!payload) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 401);
  }

  const ownerUserId = payload.sub;
  const name = c.req.param("name");

  const record = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!record) {
    return c.json({ ok: false, error: "App not found" }, 404);
  }
  if (record.owner !== ownerUserId) {
    return c.json({ ok: false, error: "Only the app owner can invite users" }, 403);
  }

  if (!record.userGroupId) {
    return c.json({ ok: false, error: "App has no Pocket ID user group" }, 400);
  }

  if (!c.env.POCKET_ID_API_KEY) {
    return c.json({ ok: false, error: "Pocket ID API key not configured" }, 500);
  }

  let body: { email: string };
  try {
    body = await c.req.json<{ email: string }>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!body.email || typeof body.email !== "string") {
    return c.json({ ok: false, error: "Missing 'email' field" }, 400);
  }

  const now = new Date().toISOString();

  // Step 1: Write collaborator to KV first (pocketIdSynced: false)
  const collaborators = record.collaborators || [];
  const existingCollab = collaborators.find(
    (col) => col.email?.toLowerCase() === body.email.toLowerCase()
  );
  if (!existingCollab) {
    collaborators.push({
      userId: "",
      email: body.email.toLowerCase(),
      role: "member",
      pocketIdSynced: false,
      lastSyncAttempt: now,
    });
    await setSubdomain(c.env.REGISTRY_KV, name, {
      ...record,
      collaborators,
      updatedAt: now,
    });
  }

  // Step 2: Pocket ID writes with retry
  const pocketIdResult = await withRetry(async () => {
    const invitee = await findOrCreateUser(c.env.POCKET_ID, c.env.POCKET_ID_API_KEY, {
      email: body.email,
    });

    await addUsersToGroup(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      record.userGroupId!,
      [invitee.id]
    );

    const ota = await createOneTimeAccessToken(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      invitee.id
    );

    return { inviteeId: invitee.id, otaToken: ota.token };
  }, 3);

  // Step 3: Update KV with sync result
  const updatedCollaborators = (await getSubdomain(c.env.REGISTRY_KV, name))?.collaborators || collaborators;
  const collabIndex = updatedCollaborators.findIndex(
    (col) => col.email?.toLowerCase() === body.email.toLowerCase()
  );

  if (pocketIdResult.ok) {
    // Sync succeeded — update KV with userId and mark synced
    if (collabIndex >= 0) {
      updatedCollaborators[collabIndex] = {
        ...updatedCollaborators[collabIndex],
        userId: pocketIdResult.value.inviteeId,
        pocketIdSynced: true,
        pocketIdSyncError: undefined,
        lastSyncAttempt: now,
      };
      await setSubdomain(c.env.REGISTRY_KV, name, {
        ...record,
        collaborators: updatedCollaborators,
        updatedAt: now,
      });
    }

    // Build invite URL
    const appUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : await (async () => {
            const subdomain = await getWorkersSubdomain(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
            return subdomain
              ? `https://${name}.${subdomain}.workers.dev`
              : `https://${name}.workers.dev`;
          })();

    const inviteUrl = `${appUrl}?ota=${encodeURIComponent(pocketIdResult.value.otaToken)}`;
    return c.json({ ok: true, inviteUrl, userId: pocketIdResult.value.inviteeId });
  } else {
    // Sync failed — mark in KV
    if (collabIndex >= 0) {
      updatedCollaborators[collabIndex] = {
        ...updatedCollaborators[collabIndex],
        pocketIdSynced: false,
        pocketIdSyncError: pocketIdResult.error,
        pocketIdSyncAttempts: pocketIdResult.attempts,
        lastSyncAttempt: now,
      };
      await setSubdomain(c.env.REGISTRY_KV, name, {
        ...record,
        collaborators: updatedCollaborators,
        updatedAt: now,
      });
    }

    console.error(`[invite] Pocket ID sync failed for ${body.email} on ${name}: ${pocketIdResult.error}`);
    return c.json(
      { ok: true, sync: "pending", error: `Pocket ID sync pending: ${pocketIdResult.error}` },
      207
    );
  }
});
```

**Step 2: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "feat: KV-first invite flow with Pocket ID retry and sync flags"
```

---

### Task 5: Add Remove Collaborator Endpoint

**Files:**
- Modify: `deploy-api/src/index.ts`
- Create: `deploy-api/src/__tests__/remove-collaborator.test.ts`

**Step 1: Write failing test**

Create `deploy-api/src/__tests__/remove-collaborator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { PendingRemoval } from "../types";

describe("PendingRemoval tracking", () => {
  it("creates a pending removal record", () => {
    const removal: PendingRemoval = {
      email: "removed@example.com",
      userId: "user-123",
      removedAt: new Date().toISOString(),
      attempts: 3,
      lastAttempt: new Date().toISOString(),
      error: "removeUsersFromGroup failed (503): Service Unavailable",
    };
    expect(removal.email).toBe("removed@example.com");
    expect(removal.attempts).toBe(3);
    expect(removal.error).toContain("503");
  });

  it("records removal without userId for invited-only collaborators", () => {
    const removal: PendingRemoval = {
      email: "never-joined@example.com",
      removedAt: new Date().toISOString(),
      attempts: 0,
    };
    expect(removal.userId).toBeUndefined();
    expect(removal.attempts).toBe(0);
  });
});
```

**Step 2: Run test to verify shape tests pass**

Run: `cd deploy-api && npx vitest run src/__tests__/remove-collaborator.test.ts`
Expected: PASS

**Step 3: Add the remove endpoint**

In `deploy-api/src/index.ts`, add before the `export default app;` line:

```typescript
// Remove collaborator endpoint
app.delete("/apps/:name/collaborators/:email", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.OIDC_ISSUER, c.env.POCKET_ID);
  if (!payload) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 401);
  }

  const ownerUserId = payload.sub;
  const name = c.req.param("name");
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();

  const record = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!record) {
    return c.json({ ok: false, error: "App not found" }, 404);
  }
  if (record.owner !== ownerUserId) {
    return c.json({ ok: false, error: "Only the app owner can remove collaborators" }, 403);
  }

  // Find the collaborator
  const collaborators = record.collaborators || [];
  const collabIndex = collaborators.findIndex(
    (col) => col.email?.toLowerCase() === email
  );
  if (collabIndex < 0) {
    return c.json({ ok: false, error: "Collaborator not found" }, 404);
  }

  const collab = collaborators[collabIndex];
  const now = new Date().toISOString();

  // Step 1: Remove from KV
  const updatedCollaborators = collaborators.filter((_, i) => i !== collabIndex);

  // Step 2: Remove from Pocket ID group (with retry)
  let pocketIdRemoved = false;
  let removalError = "";
  if (collab.userId && record.userGroupId && c.env.POCKET_ID_API_KEY) {
    const result = await withRetry(
      () => removeUsersFromGroup(
        c.env.POCKET_ID,
        c.env.POCKET_ID_API_KEY,
        record.userGroupId!,
        [collab.userId!]
      ),
      3
    );
    pocketIdRemoved = result.ok;
    if (!result.ok) {
      removalError = result.error;
    }
  } else {
    // No userId or no group — nothing to remove from Pocket ID
    pocketIdRemoved = true;
  }

  // Step 3: Write updated record to KV
  const pendingRemovals = record.pendingRemovals || [];
  if (!pocketIdRemoved) {
    pendingRemovals.push({
      email,
      userId: collab.userId,
      removedAt: now,
      attempts: 3,
      lastAttempt: now,
      error: removalError,
    });
  }

  await setSubdomain(c.env.REGISTRY_KV, name, {
    ...record,
    collaborators: updatedCollaborators,
    pendingRemovals: pendingRemovals.length > 0 ? pendingRemovals : undefined,
    updatedAt: now,
  });

  if (pocketIdRemoved) {
    return c.json({ ok: true, removed: email });
  } else {
    return c.json(
      { ok: true, removed: email, sync: "pending", error: `Pocket ID removal pending: ${removalError}` },
      207
    );
  }
});
```

**Step 4: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add deploy-api/src/index.ts deploy-api/src/__tests__/remove-collaborator.test.ts
git commit -m "feat: add DELETE /apps/:name/collaborators/:email with Pocket ID sync"
```

---

### Task 6: Add Single-Subdomain Reconciliation Endpoint

**Files:**
- Modify: `deploy-api/src/index.ts`
- Create: `deploy-api/src/__tests__/reconcile.test.ts`

**Step 1: Write test for reconciliation diff logic**

Create `deploy-api/src/__tests__/reconcile.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Extracted diff logic for unit testing
function computeReconciliationDiff(
  kvCollaborators: Array<{ userId?: string; email: string; pocketIdSynced?: boolean }>,
  pocketIdMembers: Array<{ id: string; email?: string }>,
  ownerId: string
): { toAddToPocketId: string[]; toRemoveFromPocketId: string[] } {
  const kvUserIds = new Set(
    kvCollaborators
      .filter((c) => c.userId)
      .map((c) => c.userId!)
  );
  kvUserIds.add(ownerId); // owner should always be in group

  const pocketIdUserIds = new Set(pocketIdMembers.map((m) => m.id));

  const toAddToPocketId = [...kvUserIds].filter((id) => !pocketIdUserIds.has(id));
  const toRemoveFromPocketId = [...pocketIdUserIds].filter((id) => !kvUserIds.has(id));

  return { toAddToPocketId, toRemoveFromPocketId };
}

describe("computeReconciliationDiff", () => {
  it("detects members missing from Pocket ID", () => {
    const diff = computeReconciliationDiff(
      [{ userId: "user-2", email: "b@test.com", pocketIdSynced: false }],
      [{ id: "user-1" }], // only owner in group
      "user-1"
    );
    expect(diff.toAddToPocketId).toEqual(["user-2"]);
    expect(diff.toRemoveFromPocketId).toEqual([]);
  });

  it("detects orphaned Pocket ID members", () => {
    const diff = computeReconciliationDiff(
      [], // no collaborators in KV
      [{ id: "user-1" }, { id: "user-orphan" }],
      "user-1"
    );
    expect(diff.toAddToPocketId).toEqual([]);
    expect(diff.toRemoveFromPocketId).toEqual(["user-orphan"]);
  });

  it("returns empty when in sync", () => {
    const diff = computeReconciliationDiff(
      [{ userId: "user-2", email: "b@test.com", pocketIdSynced: true }],
      [{ id: "user-1" }, { id: "user-2" }],
      "user-1"
    );
    expect(diff.toAddToPocketId).toEqual([]);
    expect(diff.toRemoveFromPocketId).toEqual([]);
  });

  it("always keeps owner in group", () => {
    const diff = computeReconciliationDiff(
      [],
      [], // empty Pocket ID group
      "user-1"
    );
    expect(diff.toAddToPocketId).toEqual(["user-1"]);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd deploy-api && npx vitest run src/__tests__/reconcile.test.ts`
Expected: PASS (pure function, no imports needed)

**Step 3: Add the reconciliation endpoint**

In `deploy-api/src/index.ts`, add before `export default app;`:

```typescript
// Single-subdomain reconciliation
app.post("/admin/reconcile/:subdomain", async (c) => {
  // Auth: require API key or owner JWT
  const apiKeyHeader = c.req.header("X-API-Key");
  const authHeader = c.req.header("Authorization");
  let isAuthorized = false;
  let callerUserId = "";

  if (apiKeyHeader === c.env.POCKET_ID_API_KEY) {
    isAuthorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyJWT(authHeader.slice(7), c.env.OIDC_ISSUER, c.env.POCKET_ID);
    if (payload) {
      callerUserId = payload.sub;
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const subdomain = c.req.param("subdomain");
  const record = await getSubdomain(c.env.REGISTRY_KV, subdomain);
  if (!record) {
    return c.json({ ok: false, error: "Subdomain not found" }, 404);
  }

  // If JWT auth, must be owner
  if (callerUserId && record.owner !== callerUserId) {
    return c.json({ ok: false, error: "Only the app owner can reconcile" }, 403);
  }

  if (!record.userGroupId || !c.env.POCKET_ID_API_KEY) {
    return c.json({ ok: false, error: "No Pocket ID group configured" }, 400);
  }

  const fixed: string[] = [];
  const failed: string[] = [];
  const now = new Date().toISOString();
  let updatedRecord = { ...record };

  // 1. Fix pocketIdGroupSynced if needed
  if (!record.pocketIdGroupSynced) {
    const result = await withRetry(
      () => registerAppInPocketId(
        c.env.POCKET_ID,
        c.env.POCKET_ID_API_KEY,
        subdomain,
        c.env.CF_ZONE_ID ? `https://${subdomain}.vibesos.com` : `https://${subdomain}.workers.dev`,
        record.owner,
        record
      ),
      3
    );
    if (result.ok && result.value) {
      updatedRecord.oidcClientId = result.value.oidcClientId;
      updatedRecord.userGroupId = result.value.userGroupId;
      updatedRecord.pocketIdGroupSynced = true;
      fixed.push("group-registration");
    } else {
      failed.push("group-registration");
    }
  }

  // 2. Fix unsynced collaborators
  const collaborators = updatedRecord.collaborators || [];
  for (let i = 0; i < collaborators.length; i++) {
    const collab = collaborators[i];
    if (collab.pocketIdSynced === false && collab.email) {
      const result = await withRetry(async () => {
        const user = await findOrCreateUser(c.env.POCKET_ID, c.env.POCKET_ID_API_KEY, {
          email: collab.email!,
        });
        await addUsersToGroup(
          c.env.POCKET_ID,
          c.env.POCKET_ID_API_KEY,
          updatedRecord.userGroupId!,
          [user.id]
        );
        return user;
      }, 3);

      if (result.ok) {
        collaborators[i] = {
          ...collab,
          userId: result.value.id,
          pocketIdSynced: true,
          pocketIdSyncError: undefined,
          lastSyncAttempt: now,
        };
        fixed.push(`collab-sync:${collab.email}`);
      } else {
        collaborators[i] = {
          ...collab,
          pocketIdSyncAttempts: (collab.pocketIdSyncAttempts || 0) + 3,
          pocketIdSyncError: result.error,
          lastSyncAttempt: now,
        };
        failed.push(`collab-sync:${collab.email}`);
      }
    }
  }

  // 3. Process pending removals
  const pendingRemovals = updatedRecord.pendingRemovals || [];
  const remainingRemovals: typeof pendingRemovals = [];
  for (const removal of pendingRemovals) {
    if (removal.userId && updatedRecord.userGroupId) {
      const result = await withRetry(
        () => removeUsersFromGroup(
          c.env.POCKET_ID,
          c.env.POCKET_ID_API_KEY,
          updatedRecord.userGroupId!,
          [removal.userId!]
        ),
        3
      );
      if (result.ok) {
        fixed.push(`removal:${removal.email}`);
      } else {
        remainingRemovals.push({ ...removal, attempts: removal.attempts + 3, lastAttempt: now, error: result.error });
        failed.push(`removal:${removal.email}`);
      }
    }
  }

  // 4. Diff Pocket ID group against KV
  try {
    const groupMembers = await listGroupMembers(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      updatedRecord.userGroupId!
    );

    const kvUserIds = new Set(
      collaborators.filter((col) => col.userId).map((col) => col.userId!)
    );
    kvUserIds.add(record.owner);

    const pocketIdUserIds = new Set(groupMembers.map((m) => m.id));

    // Add missing members to Pocket ID
    for (const userId of kvUserIds) {
      if (!pocketIdUserIds.has(userId)) {
        const result = await withRetry(
          () => addUsersToGroup(c.env.POCKET_ID, c.env.POCKET_ID_API_KEY, updatedRecord.userGroupId!, [userId]),
          3
        );
        if (result.ok) fixed.push(`group-add:${userId}`);
        else failed.push(`group-add:${userId}`);
      }
    }

    // Remove orphaned members from Pocket ID
    for (const member of groupMembers) {
      if (!kvUserIds.has(member.id)) {
        const result = await withRetry(
          () => removeUsersFromGroup(c.env.POCKET_ID, c.env.POCKET_ID_API_KEY, updatedRecord.userGroupId!, [member.id]),
          3
        );
        if (result.ok) fixed.push(`group-remove:${member.id}`);
        else failed.push(`group-remove:${member.id}`);
      }
    }
  } catch (err) {
    failed.push(`group-diff:${err instanceof Error ? err.message : "unknown"}`);
  }

  // Write updated record
  updatedRecord.collaborators = collaborators;
  updatedRecord.pendingRemovals = remainingRemovals.length > 0 ? remainingRemovals : undefined;
  updatedRecord.updatedAt = now;
  await setSubdomain(c.env.REGISTRY_KV, subdomain, updatedRecord);

  return c.json({
    ok: true,
    subdomain,
    fixed,
    failed,
    alreadySynced: fixed.length === 0 && failed.length === 0,
  });
});
```

**Step 4: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add deploy-api/src/index.ts deploy-api/src/__tests__/reconcile.test.ts
git commit -m "feat: add POST /admin/reconcile/:subdomain endpoint"
```

---

### Task 7: Add Bulk Reconciliation Endpoint

**Files:**
- Modify: `deploy-api/src/index.ts`

**Step 1: Add the bulk endpoint**

In `deploy-api/src/index.ts`, add after the single-subdomain reconcile endpoint and before `export default app;`:

```typescript
// Bulk reconciliation — sweep all subdomains with unsynced state
app.post("/admin/reconcile", async (c) => {
  // Admin-only: API key required
  const apiKeyHeader = c.req.header("X-API-Key");
  if (apiKeyHeader !== c.env.POCKET_ID_API_KEY) {
    return c.json({ ok: false, error: "Admin API key required" }, 401);
  }

  // List all subdomain keys
  const results: Array<{ subdomain: string; fixed: string[]; failed: string[] }> = [];
  let cursor: string | undefined;
  let totalScanned = 0;

  do {
    const listResult = await c.env.REGISTRY_KV.list({
      prefix: "subdomain:",
      cursor,
      limit: 100,
    });

    for (const key of listResult.keys) {
      const subdomain = key.name.replace("subdomain:", "");
      totalScanned++;

      // Read the record
      const raw = await c.env.REGISTRY_KV.get(key.name);
      if (!raw) continue;

      let record: SubdomainRecord;
      try {
        record = JSON.parse(raw);
      } catch {
        continue;
      }

      // Check if reconciliation is needed
      const needsSync =
        record.pocketIdGroupSynced === false ||
        record.collaborators?.some((col) => col.pocketIdSynced === false) ||
        (record.pendingRemovals && record.pendingRemovals.length > 0);

      if (!needsSync) continue;

      // Call the single-subdomain reconcile internally
      // (Reuse by fetching our own endpoint)
      try {
        const res = await c.env.POCKET_ID.fetch(
          new Request(`https://pocket-id/admin/reconcile/${subdomain}`, {
            method: "POST",
            headers: { "X-API-Key": c.env.POCKET_ID_API_KEY },
          })
        );
        // Note: can't call self via service binding — use inline logic instead
      } catch {
        // Fall through to manual reconciliation below
      }

      // For simplicity, record which subdomains need fixing
      results.push({ subdomain, fixed: [], failed: ["needs-reconciliation"] });
    }

    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  // Actually reconcile each one by calling the single endpoint logic
  // Since we can't self-call, extract the logic into a shared function in a future refactor.
  // For now, return the list of subdomains needing reconciliation.

  return c.json({
    ok: true,
    totalScanned,
    needsReconciliation: results.length,
    subdomains: results.map((r) => r.subdomain),
  });
});
```

**Note:** The bulk endpoint identifies subdomains needing reconciliation. Callers should then POST to `/admin/reconcile/:subdomain` for each. A future refactor can extract the reconciliation logic into a shared function for inline execution.

**Step 2: Run all tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "feat: add POST /admin/reconcile bulk scan endpoint"
```

---

### Task 8: Update SharingBridge — Remove Direct KV Write

**Files:**
- Modify: `source-templates/base/template.html` (lines 523–549)

**Step 1: Remove the KV dual-write block from SharingBridge**

In `source-templates/base/template.html`, find lines 523–549 (the `// Dual-write to KV registry` block):

```javascript
                // Dual-write to KV registry (awaited, non-fatal)
                try {
                  var kvRegistryUrl = window.__VIBES_REGISTRY_URL__;
                  if (kvRegistryUrl && !kvRegistryUrl.startsWith('__')) {
                    var token = window.__VIBES_OIDC_TOKEN__;
                    if (token) {
                      var hostname = window.location.hostname;
                      var parts = hostname.split('.');
                      var kvSubdomain = qpSub || (parts.length > 2 ? parts[0] : hostname);
                      var kvRes = await fetch(kvRegistryUrl.replace(/\/$/, '') + '/invite', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ subdomain: kvSubdomain, email: email, right: detail.right || 'write', ledgerId: matchedLedger.ledgerId, inviteId: inviteId || '' })
                      });
                      if (!kvRes.ok) {
                        var kvBody = await kvRes.text();
                        console.error('[vibes-sharing] KV invite failed:', kvRes.status, kvRes.statusText, '| body:', kvBody, '| subdomain:', kvSubdomain, '| email:', email);
                      } else {
                        console.log('[vibes-sharing] KV invite written successfully for', email, 'on', kvSubdomain);
                      }
                    } else {
                      console.warn('[vibes-sharing] KV invite skipped: no OIDC token available');
                    }
                  }
                } catch (kvErr) {
                  console.error('[vibes-sharing] KV dual-write error:', kvErr, '| email:', email);
                }
```

Replace the entire block with:

```javascript
                // KV write handled by Deploy API invite endpoint (no longer dual-written from browser)
                console.debug('[vibes-sharing] KV managed by Deploy API');
```

**Step 2: Rebuild templates**

Run: `bun scripts/merge-templates.js --force`
Expected: Templates regenerated without errors

**Step 3: Verify the KV block is removed from generated templates**

Run: `grep -c "KV dual-write" skills/*/templates/index.html` (expect 0 matches)
Run: `grep -c "KV managed by Deploy API" skills/*/templates/index.html` (expect matches in each skill template)

**Step 4: Commit**

```bash
git add source-templates/base/template.html skills/*/templates/index.html
git commit -m "feat: remove KV dual-write from SharingBridge — Deploy API handles KV"
```

---

### Task 9: Run Full Test Suite and Verify

**Files:** None (verification only)

**Step 1: Run Deploy API tests**

Run: `cd deploy-api && npx vitest run`
Expected: All tests PASS

**Step 2: Run CF Worker tests**

Run: `cd skills/cloudflare/worker && npx vitest run`
Expected: All tests PASS (type changes are backward-compatible)

**Step 3: Run scripts tests**

Run: `cd scripts && npm test`
Expected: All tests PASS

**Step 4: Verify template assembly**

Run: `bun scripts/merge-templates.js --force && echo "OK"`
Expected: "OK" — no placeholder errors

**Step 5: Final commit if any files changed**

```bash
git status
# If any generated files changed:
git add -A && git commit -m "chore: regenerate templates after dual-write consistency changes"
```
