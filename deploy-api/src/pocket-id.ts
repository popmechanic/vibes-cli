/**
 * Pocket ID Admin API Helpers
 *
 * Thin wrappers around Pocket ID's admin API for per-app access control.
 * All calls use X-API-Key header auth via the POCKET_ID service binding.
 */

interface PocketIdFetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

// ---------------------------------------------------------------------------
// OIDC Client (App Registration)
// ---------------------------------------------------------------------------

export async function createApp(
  fetcher: PocketIdFetcher,
  apiKey: string,
  opts: { name: string; callbackURLs: string[]; isPublic?: boolean }
): Promise<{ id: string }> {
  const res = await fetcher.fetch("https://pocket-id/api/oidc/clients", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      callbackURLs: opts.callbackURLs,
      isPublic: opts.isPublic ?? true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createApp failed (${res.status}): ${text}`);
  }

  return (await res.json()) as { id: string };
}

export async function getApp(
  fetcher: PocketIdFetcher,
  apiKey: string,
  clientId: string
): Promise<{ id: string } | null> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/oidc/clients/${clientId}`,
    {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    }
  );

  if (res.status === 404) return null;
  if (!res.ok) return null;

  return (await res.json()) as { id: string };
}

// ---------------------------------------------------------------------------
// User Groups
// ---------------------------------------------------------------------------

export async function createUserGroup(
  fetcher: PocketIdFetcher,
  apiKey: string,
  opts: { name: string }
): Promise<{ id: string }> {
  const res = await fetcher.fetch("https://pocket-id/api/user-groups", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ friendlyName: opts.name }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createUserGroup failed (${res.status}): ${text}`);
  }

  return (await res.json()) as { id: string };
}

export async function addUsersToGroup(
  fetcher: PocketIdFetcher,
  apiKey: string,
  groupId: string,
  userIds: string[]
): Promise<void> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/user-groups/${groupId}/users`,
    {
      method: "PUT",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(userIds),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`addUsersToGroup failed (${res.status}): ${text}`);
  }
}

export async function setAllowedGroups(
  fetcher: PocketIdFetcher,
  apiKey: string,
  clientId: string,
  groupIds: string[]
): Promise<void> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/oidc/clients/${clientId}/allowed-user-groups`,
    {
      method: "PUT",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(groupIds),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`setAllowedGroups failed (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// User Management
// ---------------------------------------------------------------------------

export async function findOrCreateUser(
  fetcher: PocketIdFetcher,
  apiKey: string,
  opts: { email: string }
): Promise<{ id: string }> {
  // Search for existing user by email
  const searchRes = await fetcher.fetch(
    `https://pocket-id/api/users?search=${encodeURIComponent(opts.email)}`,
    {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    }
  );

  if (searchRes.ok) {
    const users = (await searchRes.json()) as Array<{ id: string; email?: string }>;
    const match = users.find(
      (u) => u.email?.toLowerCase() === opts.email.toLowerCase()
    );
    if (match) return { id: match.id };
  }

  // Create new user
  const createRes = await fetcher.fetch("https://pocket-id/api/users", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email: opts.email }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`findOrCreateUser create failed (${createRes.status}): ${text}`);
  }

  return (await createRes.json()) as { id: string };
}

export async function createOneTimeAccessToken(
  fetcher: PocketIdFetcher,
  apiKey: string,
  userId: string
): Promise<{ token: string }> {
  const res = await fetcher.fetch(
    `https://pocket-id/api/users/${userId}/one-time-access-token`,
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createOneTimeAccessToken failed (${res.status}): ${text}`);
  }

  return (await res.json()) as { token: string };
}
