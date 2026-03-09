import { describe, it, expect } from 'vitest';
import { generateSessionTokens, generateDeviceCAKeys, base58Encode, jwkToEnv } from '../crypto';

describe('crypto', () => {
  describe('base58Encode', () => {
    it('encodes bytes to base58', () => {
      const bytes = new Uint8Array([0, 1, 2, 3]);
      const result = base58Encode(bytes);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Leading zero byte becomes '1'
      expect(result[0]).toBe('1');
    });
  });

  describe('jwkToEnv', () => {
    it('encodes JWK as z-prefixed base58 string', () => {
      const jwk = { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' };
      const result = jwkToEnv(jwk);
      expect(result[0]).toBe('z');
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('generateSessionTokens', () => {
    it('returns publicEnv and privateEnv as z-prefixed strings', async () => {
      const result = await generateSessionTokens();
      expect(result.publicEnv).toMatch(/^z/);
      expect(result.privateEnv).toMatch(/^z/);
      expect(result.publicEnv).not.toBe(result.privateEnv);
    });
  });

  describe('generateDeviceCAKeys', () => {
    it('returns privKey and cert', async () => {
      const result = await generateDeviceCAKeys();
      expect(result.privKey).toMatch(/^z/);
      // cert is a JWT (3 dot-separated base64url segments)
      expect(result.cert.split('.').length).toBe(3);
    });
  });
});
