/**
 * Lazy ledger discovery — queries D1 directly via Cloudflare REST API
 * to find the ledger for a given app. Bypasses Worker-to-Worker fetch
 * limitation (error 1042) by going through the CF API instead.
 */

interface DiscoverOptions {
  accountId: string;
  apiToken: string;
  d1DatabaseId: string;
  appName: string;
}

interface D1Result {
  results: Array<{ ledgerId: string; name: string }>;
  success: boolean;
}

export async function discoverLedgerId(opts: DiscoverOptions): Promise<string | null> {
  const { accountId, apiToken, d1DatabaseId, appName } = opts;

  try {
    // Query the Ledgers table directly via Cloudflare D1 REST API
    const hostname = `${appName}.vibesos.com`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "SELECT ledgerId, name FROM Ledgers WHERE name LIKE ? LIMIT 10",
          params: [`%${hostname}%`],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[ledger-discovery] D1 API returned ${res.status}: ${errText.slice(0, 500)}`);
      return null;
    }

    const body = await res.json() as { result: D1Result[] };
    const rows = body.result?.[0]?.results || [];
    console.log(`[ledger-discovery] Found ${rows.length} ledger(s) for ${appName}: ${JSON.stringify(rows.map(l => ({ id: l.ledgerId, name: l.name })))}`);
    if (rows.length === 0) return null;

    // Match by app name in ledger name
    const match = rows.find((l) =>
      l.name.startsWith(appName + ".") ||
      l.name === appName ||
      l.name.startsWith("oidc-" + appName + ".")
    );
    const result = match ? match.ledgerId : rows[0].ledgerId;
    console.log(`[ledger-discovery] Selected ledger: ${result} (match: ${match?.name || 'fallback to first'})`);
    return result;
  } catch (err) {
    console.error(`[ledger-discovery] Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
