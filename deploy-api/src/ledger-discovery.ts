/**
 * Lazy ledger discovery — queries the Connect dashboard's listLedgersByUser
 * endpoint to find the ledger for a given app. Uses service auth as the
 * app owner.
 *
 * Supports two modes:
 * - Dashboard HTTP API (preferred, via custom domain to avoid CF error 1042)
 * - D1 REST API fallback (for apps provisioned before custom domains were added)
 */

interface DiscoverOptions {
  /** Dashboard API URL (custom domain preferred, e.g. https://connect-app.vibesos.com/api) */
  apiUrl: string;
  serviceToken: string;
  appName: string;
  /** Fallback: D1 direct access if dashboard HTTP fails */
  d1Fallback?: {
    accountId: string;
    apiToken: string;
    d1DatabaseId: string;
  };
}

interface LedgerEntry {
  ledgerId: string;
  name: string;
  role: string;
}

export async function discoverLedgerId(opts: DiscoverOptions): Promise<string | null> {
  const { apiUrl, serviceToken, appName, d1Fallback } = opts;

  // Try dashboard HTTP API first
  try {
    const res = await fetch(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reqListLedgersByUser",
        auth: { type: "service", token: serviceToken },
      }),
    });

    if (res.ok) {
      const body = (await res.json()) as { ledgers?: LedgerEntry[] };
      const ledgers = body.ledgers || [];
      console.log(`[ledger-discovery] Found ${ledgers.length} ledger(s) for ${appName}: ${JSON.stringify(ledgers.map(l => ({ id: l.ledgerId, name: l.name })))}`);
      return matchLedger(ledgers, appName);
    }

    const errText = await res.text().catch(() => "");
    console.warn(`[ledger-discovery] Dashboard returned ${res.status}: ${errText.slice(0, 200)}`);
    // Fall through to D1 fallback
  } catch (err) {
    console.warn(`[ledger-discovery] Dashboard fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    // Fall through to D1 fallback
  }

  // D1 REST API fallback
  if (d1Fallback) {
    try {
      const hostname = `${appName}.vibesos.com`;
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${d1Fallback.accountId}/d1/database/${d1Fallback.d1DatabaseId}/query`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${d1Fallback.apiToken}`,
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

      const body = await res.json() as { result: Array<{ results: Array<{ ledgerId: string; name: string }> }> };
      const rows = body.result?.[0]?.results || [];
      console.log(`[ledger-discovery] D1 fallback found ${rows.length} ledger(s) for ${appName}: ${JSON.stringify(rows.map(l => ({ id: l.ledgerId, name: l.name })))}`);
      return matchLedger(rows, appName);
    } catch (err) {
      console.error(`[ledger-discovery] D1 fallback error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  return null;
}

function matchLedger(ledgers: Array<{ ledgerId: string; name: string }>, appName: string): string | null {
  if (ledgers.length === 0) return null;

  const match = ledgers.find((l) =>
    l.name.startsWith(appName + ".") ||
    l.name === appName ||
    l.name.startsWith("oidc-" + appName + ".")
  );
  const result = match ? match.ledgerId : ledgers[0].ledgerId;
  console.log(`[ledger-discovery] Selected ledger: ${result} (match: ${match?.name || 'fallback to first'})`);
  return result;
}
