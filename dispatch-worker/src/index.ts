import { AppSyncDO } from './do';

export { AppSyncDO };

interface Env {
  APP_SYNC: DurableObjectNamespace;
  APP_META: KVNamespace;
  DISPATCH: { get(name: string): { fetch(request: Request): Promise<Response> } };
  OIDC_JWKS_URL: string;
}

let cachedJwks: { keys: JsonWebKey[]; cryptoKeys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
const JWKS_TTL = 5 * 60_000;

async function fetchJwks(url: string): Promise<{ keys: JsonWebKey[]; cryptoKeys: Map<string, CryptoKey> }> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL) {
    return cachedJwks;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: JsonWebKey[] };
  cachedJwks = { keys: data.keys, cryptoKeys: new Map(), fetchedAt: Date.now() };
  return cachedJwks;
}

async function verifyJwt(token: string, jwksUrl: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (header.alg !== 'RS256') return false;

    const jwks = await fetchJwks(jwksUrl);
    const jwk = header.kid
      ? jwks.keys.find((k: any) => k.kid === header.kid)
      : jwks.keys.find((k: any) => k.kty === 'RSA');
    if (!jwk) return false;

    const cacheKey = (jwk as any).kid || 'default';
    let cryptoKey = jwks.cryptoKeys.get(cacheKey);
    if (!cryptoKey) {
      cryptoKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['verify']
      );
      jwks.cryptoKeys.set(cacheKey, cryptoKey);
    }

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

function getSubdomain(hostname: string): string {
  const parts = hostname.split('.');
  return parts.length > 2 ? parts[0] : hostname;
}

function getTokenFromRequest(request: Request, url: URL): string | null {
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

      // Default-deny: require auth unless explicitly marked public
      if (appMeta?.public !== true) {
        const token = getTokenFromRequest(request, url);
        if (!token) return new Response('Unauthorized', { status: 401 });
        const valid = await verifyJwt(token, env.OIDC_JWKS_URL);
        if (!valid) return new Response('Unauthorized', { status: 401 });
      }

      const doId = env.APP_SYNC.idFromName(appName);
      return env.APP_SYNC.get(doId).fetch(request);
    }

    const appName = getSubdomain(url.hostname);
    return env.DISPATCH.get(appName).fetch(request);
  },
};
