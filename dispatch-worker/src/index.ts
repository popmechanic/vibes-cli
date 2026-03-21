import { AppSyncDO } from './do';

export { AppSyncDO };

interface Env {
  APP_SYNC: DurableObjectNamespace;
  APP_META: KVNamespace;
  DISPATCH: { get(name: string): { fetch(request: Request): Promise<Response> } };
  OIDC_JWKS_URL: string;
}

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_TTL = 5 * 60_000;

async function fetchJwks(url: string): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL) {
    return cachedJwks.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: JsonWebKey[] };
  cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function verifyJwt(token: string, jwksUrl: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (header.alg !== 'RS256') return false;

    const keys = await fetchJwks(jwksUrl);
    const jwk = header.kid
      ? keys.find((k: any) => k.kid === header.kid)
      : keys.find((k: any) => k.kty === 'RSA');
    if (!jwk) return false;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const sigBase64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const sigPadded = sigBase64 + '='.repeat((4 - sigBase64.length % 4) % 4);
    const sigBinary = atob(sigPadded);
    const signature = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) signature[i] = sigBinary.charCodeAt(i);

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
    if (!valid) return false;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
    if (payload.iss !== 'https://vibesos.com') return false;
    if (typeof payload.iat === 'number' && payload.iat > now + 60) return false;
    return true;
  } catch {
    return false;
  }
}

function getSubdomain(request: Request): string {
  const host = new URL(request.url).hostname;
  const parts = host.split('.');
  return parts.length > 2 ? parts[0] : host;
}

function getTokenFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const qToken = url.searchParams.get('token');
  if (qToken) return qToken;
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const appName = url.pathname.slice(1);
      if (!appName || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/.test(appName)) {
        return new Response('Invalid app name', { status: 400 });
      }

      const appMeta = await env.APP_META.get(`app-meta:${appName}`, { type: 'json' }) as
        { public?: boolean } | null;

      // TODO(tinybase-deploy): TEMPORARY — default to public when no app-meta key exists.
      // The Deploy API hasn't been redeployed yet, so it doesn't write app-meta: keys.
      // REVERT to `appMeta?.public !== true` (default-deny) after the Deploy API is
      // deployed and writes app-meta: keys during deploy. See deploy-api/src/index.ts:550.
      if (appMeta && appMeta.public === false) {
        const token = getTokenFromRequest(request);
        if (!token) return new Response('Unauthorized', { status: 401 });
        const valid = await verifyJwt(token, env.OIDC_JWKS_URL);
        if (!valid) return new Response('Unauthorized', { status: 401 });
      }

      const doId = env.APP_SYNC.idFromName(appName);
      return env.APP_SYNC.get(doId).fetch(request);
    }

    const appName = getSubdomain(request);
    return env.DISPATCH.get(appName).fetch(request);
  },
};
