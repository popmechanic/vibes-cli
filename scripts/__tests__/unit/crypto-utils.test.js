/**
 * Unit tests for crypto-utils.js
 *
 * Tests base58 encoding, JWK-to-env conversion, and key generation.
 */

import { describe, it, expect } from 'vitest';
import {
  base58Encode,
  jwkToEnv,
  generateSessionTokens,
  generateDeviceCAKeys
} from '../../lib/crypto-utils.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

describe('base58Encode', () => {
  it('returns "1" for empty input (initial digit converted)', () => {
    expect(base58Encode(new Uint8Array([]))).toBe('1');
  });

  it('encodes single zero byte as "11"', () => {
    // Leading zero becomes "1" + initial digit "1"
    expect(base58Encode([0])).toBe('11');
  });

  it('encodes single byte 1 as "2"', () => {
    expect(base58Encode([1])).toBe('2');
  });

  it('preserves leading zeros as "1" characters', () => {
    const result = base58Encode([0, 0, 0, 1]);
    expect(result).toMatch(/^111/);
    expect(result.length).toBe(4); // three "1"s + one char for value 1
  });

  it('produces deterministic output', () => {
    const input = [72, 101, 108, 108, 111]; // "Hello"
    const first = base58Encode(input);
    const second = base58Encode(input);
    expect(first).toBe(second);
  });

  it('result contains only valid base58 characters', () => {
    const input = new Uint8Array(32);
    for (let i = 0; i < 32; i++) input[i] = i * 7 + 3;
    const result = base58Encode(input);
    for (const ch of result) {
      expect(BASE58_ALPHABET).toContain(ch);
    }
  });

  it('accepts Uint8Array input', () => {
    const result = base58Encode(new Uint8Array([1, 2, 3]));
    expect(result.length).toBeGreaterThan(0);
  });

  it('accepts plain array input', () => {
    const result = base58Encode([1, 2, 3]);
    expect(result.length).toBeGreaterThan(0);
  });

  it('Uint8Array and plain array produce same result', () => {
    const arr = [10, 20, 30, 40, 50];
    expect(base58Encode(arr)).toBe(base58Encode(new Uint8Array(arr)));
  });
});

describe('jwkToEnv', () => {
  const sampleJwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };

  it('output starts with "z" prefix', () => {
    const result = jwkToEnv(sampleJwk);
    expect(result[0]).toBe('z');
  });

  it('encoding is deterministic', () => {
    const first = jwkToEnv(sampleJwk);
    const second = jwkToEnv(sampleJwk);
    expect(first).toBe(second);
  });

  it('remainder after "z" is non-empty', () => {
    const result = jwkToEnv(sampleJwk);
    expect(result.length).toBeGreaterThan(1);
  });

  it('remainder contains only valid base58 characters', () => {
    const result = jwkToEnv(sampleJwk);
    const encoded = result.slice(1);
    for (const ch of encoded) {
      expect(BASE58_ALPHABET).toContain(ch);
    }
  });

  it('different JWKs produce different encodings', () => {
    const other = { kty: 'EC', crv: 'P-256', x: 'xyz', y: '123' };
    expect(jwkToEnv(sampleJwk)).not.toBe(jwkToEnv(other));
  });
});

describe('generateSessionTokens', () => {
  it('returns object with publicEnv and privateEnv', async () => {
    const result = await generateSessionTokens();
    expect(result).toHaveProperty('publicEnv');
    expect(result).toHaveProperty('privateEnv');
  });

  it('both values start with "z" prefix', async () => {
    const { publicEnv, privateEnv } = await generateSessionTokens();
    expect(publicEnv[0]).toBe('z');
    expect(privateEnv[0]).toBe('z');
  });

  it('both values are non-empty strings', async () => {
    const { publicEnv, privateEnv } = await generateSessionTokens();
    expect(typeof publicEnv).toBe('string');
    expect(typeof privateEnv).toBe('string');
    expect(publicEnv.length).toBeGreaterThan(1);
    expect(privateEnv.length).toBeGreaterThan(1);
  });

  it('public and private keys are different', async () => {
    const { publicEnv, privateEnv } = await generateSessionTokens();
    expect(publicEnv).not.toBe(privateEnv);
  });
});

describe('generateDeviceCAKeys', () => {
  it('returns object with privKey and cert', async () => {
    const result = await generateDeviceCAKeys();
    expect(result).toHaveProperty('privKey');
    expect(result).toHaveProperty('cert');
  });

  it('privKey starts with "z" prefix', async () => {
    const { privKey } = await generateDeviceCAKeys();
    expect(privKey[0]).toBe('z');
  });

  it('cert is valid JWT format (three dot-separated parts)', async () => {
    const { cert } = await generateDeviceCAKeys();
    const parts = cert.split('.');
    expect(parts.length).toBe(3);
    parts.forEach(part => {
      expect(part.length).toBeGreaterThan(0);
    });
  });

  it('cert header contains alg ES256 and typ CERT+JWT', async () => {
    const { cert } = await generateDeviceCAKeys();
    const headerB64 = cert.split('.')[0];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('CERT+JWT');
  });

  it('cert header contains kid and x5c fields', async () => {
    const { cert } = await generateDeviceCAKeys();
    const headerB64 = cert.split('.')[0];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header).toHaveProperty('kid');
    expect(header).toHaveProperty('x5c');
    expect(header.kid.length).toBeGreaterThan(0);
  });

  it('cert payload contains expected fields', async () => {
    const { cert } = await generateDeviceCAKeys();
    const payloadB64 = cert.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload).toHaveProperty('iss');
    expect(payload).toHaveProperty('sub');
    expect(payload).toHaveProperty('aud', 'certificate-users');
    expect(payload).toHaveProperty('iat');
    expect(payload).toHaveProperty('nbf');
    expect(payload).toHaveProperty('exp');
    expect(payload).toHaveProperty('jti');
    expect(payload).toHaveProperty('certificate');
  });

  it('default options produce issuer "Docker Dev CA"', async () => {
    const { cert } = await generateDeviceCAKeys();
    const payloadB64 = cert.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload.iss).toBe('Docker Dev CA');
    expect(payload.sub).toBe('Docker Dev CA');
    expect(payload.certificate.subject.commonName).toBe('Docker Dev CA');
    expect(payload.certificate.subject.organization).toBe('Vibes DIY Development');
  });

  it('custom options are reflected in cert payload', async () => {
    const { cert } = await generateDeviceCAKeys({
      issuer: 'Custom CA',
      organization: 'Custom Org',
      locality: 'Portland',
      state: 'Oregon'
    });
    const payloadB64 = cert.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload.iss).toBe('Custom CA');
    expect(payload.sub).toBe('Custom CA');
    expect(payload.certificate.subject.commonName).toBe('Custom CA');
    expect(payload.certificate.subject.organization).toBe('Custom Org');
    expect(payload.certificate.subject.locality).toBe('Portland');
    expect(payload.certificate.subject.stateOrProvinceName).toBe('Oregon');
  });

  it('cert expiration is approximately one year from now', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { cert } = await generateDeviceCAKeys();
    const after = Math.floor(Date.now() / 1000);
    const payloadB64 = cert.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const oneYear = 365 * 24 * 60 * 60;
    expect(payload.exp).toBeGreaterThanOrEqual(before + oneYear);
    expect(payload.exp).toBeLessThanOrEqual(after + oneYear);
  });

  it('certificate contains public key info', async () => {
    const { cert } = await generateDeviceCAKeys();
    const payloadB64 = cert.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const spki = payload.certificate.subjectPublicKeyInfo;
    expect(spki.kty).toBe('EC');
    expect(spki.crv).toBe('P-256');
    expect(spki).toHaveProperty('x');
    expect(spki).toHaveProperty('y');
  });
});
