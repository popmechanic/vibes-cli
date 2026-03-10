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

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[ledger-discovery] Dashboard returned ${res.status}: ${errText.slice(0, 500)}`);
      return null;
    }

    const body = (await res.json()) as { ledgers?: LedgerEntry[] };
    const ledgers = body.ledgers || [];
    console.log(`[ledger-discovery] Found ${ledgers.length} ledger(s) for ${appName}: ${JSON.stringify(ledgers.map(l => ({ id: l.ledgerId, name: l.name })))}`);
    if (ledgers.length === 0) return null;

    // Match by app name in ledger name. OIDC bridge names ledgers after the hostname, prefixed
    // with "oidc-": e.g. "oidc-ai-dog.vibesos.com-{dbName}-{userId}". Match the hostname segment
    // "-{appName}." or "{appName}." (anchored to avoid "my-app" matching "app").
    const match = ledgers.find((l) =>
      l.name.startsWith(appName + ".") ||
      l.name === appName ||
      l.name.startsWith("oidc-" + appName + ".")
    );
    const result = match ? match.ledgerId : ledgers[0].ledgerId;
    console.log(`[ledger-discovery] Selected ledger: ${result} (match: ${match?.name || 'fallback to first'})`);
    return result;
  } catch (err) {
    console.error(`[ledger-discovery] Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
