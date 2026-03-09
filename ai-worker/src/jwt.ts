// JWT Verification — Dynamic JWKS
// Ported from deploy-api/src/index.ts, adapted for standalone use.
// Takes issuer as a param and uses global fetch (no Service Binding).

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchJwks(issuer: string): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  const res = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: JsonWebKey[] };
  cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function importJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

interface JWTPayload {
  sub?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  aud?: string | string[];
  [key: string]: unknown;
}

function parseJwt(token: string): {
  header: { alg: string; typ?: string; kid?: string };
  payload: JWTPayload;
  signature: Uint8Array;
  signedData: Uint8Array;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    const sigBase64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPadded = sigBase64 + "=".repeat((4 - (sigBase64.length % 4)) % 4);
    const sigBinary = atob(sigPadded);
    const signature = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      signature[i] = sigBinary.charCodeAt(i);
    }

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    return { header, payload, signature, signedData };
  } catch {
    return null;
  }
}

async function findKey(kid: string | undefined, issuer: string): Promise<JsonWebKey | null> {
  let keys = await fetchJwks(issuer);

  let match = kid
    ? keys.find((k) => (k as unknown as Record<string, unknown>).kid === kid)
    : keys.find((k) => (k as unknown as Record<string, unknown>).kty === "RSA");

  if (!match) {
    // Cache bust and retry once (handles key rotation mid-cache)
    cachedJwks = null;
    keys = await fetchJwks(issuer);
    match = kid
      ? keys.find((k) => (k as unknown as Record<string, unknown>).kid === kid)
      : keys.find((k) => (k as unknown as Record<string, unknown>).kty === "RSA");
  }

  return match ?? null;
}

/**
 * Verify an RS256 JWT by fetching JWKS from the issuer's discovery endpoint.
 * Returns { sub } on success, null on failure.
 */
export async function verifyJWT(
  authHeader: string | undefined,
  issuer: string
): Promise<{ sub: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const parsed = parseJwt(token);
  if (!parsed) return null;

  if (parsed.header.alg !== "RS256") return null;

  try {
    const jwk = await findKey(parsed.header.kid, issuer);
    if (!jwk) return null;

    const cryptoKey = await importJwk(jwk);

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      parsed.signature,
      parsed.signedData
    );

    if (!isValid) return null;

    const now = Math.floor(Date.now() / 1000);

    // Check expiry
    if (typeof parsed.payload.exp !== "number" || parsed.payload.exp < now) {
      return null;
    }

    // Check iat is not in the future (with 60s clock skew tolerance)
    if (typeof parsed.payload.iat !== "number" || parsed.payload.iat > now + 60) {
      return null;
    }

    // Validate issuer
    if (parsed.payload.iss !== issuer) {
      return null;
    }

    // Must have a subject
    if (!parsed.payload.sub) {
      return null;
    }

    return { sub: parsed.payload.sub };
  } catch {
    return null;
  }
}
