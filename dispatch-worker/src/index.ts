import { AppSyncDO } from './do';

export { AppSyncDO };

interface Env {
  APP_SYNC: DurableObjectNamespace;
  APP_META: KVNamespace;
  DISPATCH: { get(name: string): { fetch(request: Request): Promise<Response> } };
  OIDC_JWKS_URL: string;
  OIDC_ISSUER: string;
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

async function verifyJwt(token: string, jwksUrl: string, issuer: string = 'https://vibesos.com'): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { console.log('[jwt] rejected: malformed token'); return false; }

    const decodeBase64Url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const header = JSON.parse(decodeBase64Url(parts[0]));
    if (header.alg !== 'RS256') { console.log('[jwt] rejected: unsupported alg:', header.alg); return false; }

    const jwks = await fetchJwks(jwksUrl);
    const jwk = header.kid
      ? jwks.keys.find((k: any) => k.kid === header.kid)
      : jwks.keys.find((k: any) => k.kty === 'RSA');
    if (!jwk) { console.log('[jwt] rejected: no matching JWK for kid:', header.kid); return false; }

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
    if (!valid) { console.log('[jwt] rejected: signature verification failed'); return false; }

    const payload = JSON.parse(decodeBase64Url(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== 'number' || payload.exp < now) {
      console.log('[jwt] rejected: expired (exp:', payload.exp, 'now:', now, ')');
      return false;
    }
    if (payload.iss !== issuer) {
      console.log('[jwt] rejected: issuer mismatch (got:', payload.iss, 'expected:', issuer, ')');
      return false;
    }
    if (typeof payload.iat === 'number' && payload.iat > now + 60) {
      console.log('[jwt] rejected: iat in future');
      return false;
    }
    if (!payload.sub) {
      console.log('[jwt] rejected: missing sub claim');
      return false;
    }
    if (!payload.aud) {
      console.log('[jwt] rejected: missing aud claim');
      return false;
    }
    return true;
  } catch (err) {
    console.log('[jwt] rejected: verification error:', err instanceof Error ? err.message : String(err));
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
        const valid = await verifyJwt(token, env.OIDC_JWKS_URL, env.OIDC_ISSUER);
        if (!valid) return new Response('Unauthorized', { status: 401 });
      }

      const doId = env.APP_SYNC.idFromName(appName);
      return env.APP_SYNC.get(doId).fetch(request);
    }

    // This worker only handles WebSocket upgrades for TinyBase sync.
    // Non-WebSocket requests (health checks, crawlers, etc.) get a simple response.
    return new Response('TinyBase sync endpoint. WebSocket connections only.', {
      status: 426,
      headers: { 'Upgrade': 'websocket' },
    });
  },
};
