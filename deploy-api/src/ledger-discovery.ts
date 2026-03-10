/**
 * Lazy ledger discovery — queries the Connect dashboard's listLedgersByUser
 * endpoint to find the ledger for a given app. Uses service auth as the
 * app owner.
 */

interface DiscoverOptions {
  apiUrl: string;
  serviceToken: string;
  appName: string;
  fetchFn?: typeof fetch;
}

interface LedgerEntry {
  ledgerId: string;
  name: string;
  role: string;
}

export async function discoverLedgerId(opts: DiscoverOptions): Promise<string | null> {
  const { apiUrl, serviceToken, appName, fetchFn = fetch } = opts;

  try {
    const res = await fetchFn(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reqListLedgersByUser",
        auth: { type: "service", token: serviceToken },
      }),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as { ledgers?: LedgerEntry[] };
    const ledgers = body.ledgers || [];
    if (ledgers.length === 0) return null;

    // Match by app name in ledger name (OIDC bridge names ledgers after hostname)
    // Use anchored comparison to avoid substring false positives (e.g. "app" matching "my-app")
    const match = ledgers.find((l) => l.name.startsWith(appName + ".") || l.name === appName);
    return match ? match.ledgerId : ledgers[0].ledgerId;
  } catch {
    return null;
  }
}
