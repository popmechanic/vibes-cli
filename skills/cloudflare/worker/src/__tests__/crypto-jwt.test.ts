import { describe, it, expect } from "vitest";
import { verifyClerkJWT, pemToArrayBuffer } from "../lib/crypto-jwt";

// Test PEM key (DO NOT USE IN PRODUCTION - this is for testing only)
const TEST_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWy
-----END PUBLIC KEY-----`;

describe("pemToArrayBuffer", () => {
  it("converts PEM to ArrayBuffer", () => {
    const result = pemToArrayBuffer(TEST_PEM);
    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  it("strips header and footer", () => {
    const result = pemToArrayBuffer(TEST_PEM);
    expect(result.byteLength).toBeGreaterThan(0);
  });
});

describe("verifyClerkJWT", () => {
  it("returns null for missing Authorization header", async () => {
    const result = await verifyClerkJWT(null, TEST_PEM, []);
    expect(result).toBeNull();
  });

  it("returns null for non-Bearer token", async () => {
    const result = await verifyClerkJWT("Basic abc123", TEST_PEM, []);
    expect(result).toBeNull();
  });

  it("returns null for malformed JWT", async () => {
    const result = await verifyClerkJWT("Bearer not-a-jwt", TEST_PEM, []);
    expect(result).toBeNull();
  });

  it("returns null for JWT with wrong number of parts", async () => {
    const result = await verifyClerkJWT("Bearer only.two", TEST_PEM, []);
    expect(result).toBeNull();
  });

  it("returns null for empty bearer token", async () => {
    const result = await verifyClerkJWT("Bearer ", TEST_PEM, []);
    expect(result).toBeNull();
  });
});
