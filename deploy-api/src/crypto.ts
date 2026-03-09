/**
 * Cryptographic utilities for Connect provisioning.
 * Uses Web Crypto API (native in CF Workers).
 * Ported from scripts/lib/crypto-utils.js — no Node.js deps.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

export function jwkToEnv(jwk: JsonWebKey): string {
  const jsonStr = JSON.stringify(jwk);
  const bytes = new TextEncoder().encode(jsonStr);
  return 'z' + base58Encode(bytes);
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateSessionTokens(): Promise<{ publicEnv: string; privateEnv: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as JsonWebKey;

  publicJwk.alg = 'ES256';
  privateJwk.alg = 'ES256';

  return { publicEnv: jwkToEnv(publicJwk), privateEnv: jwkToEnv(privateJwk) };
}

export async function generateDeviceCAKeys(): Promise<{ privKey: string; cert: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;

  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as JsonWebKey;
  privateJwk.alg = 'ES256';
  const privKey = jwkToEnv(privateJwk);

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;

  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const kidBytes = new Uint8Array(32);
  crypto.getRandomValues(kidBytes);
  const kid = base58Encode(kidBytes);

  const header = { alg: 'ES256', typ: 'CERT+JWT', kid, x5c: [] as string[] };

  const jtiBytes = new Uint8Array(32);
  crypto.getRandomValues(jtiBytes);
  const serialBytes = new Uint8Array(32);
  crypto.getRandomValues(serialBytes);

  const payload = {
    iss: 'Docker Dev CA',
    sub: 'Docker Dev CA',
    aud: 'certificate-users',
    iat: now,
    nbf: now,
    exp: now + oneYear,
    jti: base58Encode(jtiBytes),
    certificate: {
      version: '3',
      serialNumber: base58Encode(serialBytes),
      subject: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD',
      },
      issuer: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD',
      },
      validity: {
        notBefore: new Date(now * 1000).toISOString(),
        notAfter: new Date((now + oneYear) * 1000).toISOString(),
      },
      subjectPublicKeyInfo: {
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
      },
      signatureAlgorithm: 'ES256',
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage: ['serverAuth'],
    },
  };

  const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);

  const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    dataToSign
  );
  const signatureB64 = toBase64Url(signature);

  const cert = `${headerB64}.${payloadB64}.${signatureB64}`;
  return { privKey, cert };
}
