import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyJWT } from "../jwt";

// Helper: base64url encode
function b64url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Helper: create a fake JWT with given header + payload (signature is garbage)
function fakeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>
): string {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.fakesig`;
}

describe("verifyJWT", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no auth header provided", async () => {
    const result = await verifyJWT(undefined, "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when auth header is empty string", async () => {
    const result = await verifyJWT("", "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when auth header is not Bearer", async () => {
    const result = await verifyJWT("Basic abc123", "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null for malformed token (not 3 parts)", async () => {
    const result = await verifyJWT("Bearer not-a-jwt", "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null for non-RS256 algorithm", async () => {
    const token = fakeJwt(
      { alg: "HS256", typ: "JWT" },
      { sub: "user1", iss: "https://example.com", exp: 9999999999, iat: 1000 }
    );
    // This won't even try to fetch JWKS since alg check happens first
    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when JWKS fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );

    const token = fakeJwt(
      { alg: "RS256", typ: "JWT", kid: "key1" },
      { sub: "user1", iss: "https://example.com", exp: 9999999999, iat: 1000 }
    );

    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when no matching key found in JWKS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "other-key" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const token = fakeJwt(
      { alg: "RS256", typ: "JWT", kid: "nonexistent" },
      { sub: "user1", iss: "https://example.com", exp: 9999999999, iat: 1000 }
    );

    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toBeNull();
  });

  it("returns { sub } for a valid token with real RSA keypair", async () => {
    // Generate a real RSA key pair
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );

    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    (publicJwk as Record<string, unknown>).kid = "test-key-1";

    // Build JWT
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: "test-key-1" };
    const payload = { sub: "user-123", iss: "https://example.com", exp: now + 3600, iat: now };

    const headerB64 = b64url(JSON.stringify(header));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const token = `${headerB64}.${payloadB64}.${sigB64}`;

    // Mock JWKS endpoint
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toEqual({ sub: "user-123" });
  });

  it("returns null for expired token", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );

    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    (publicJwk as Record<string, unknown>).kid = "test-key-2";

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: "test-key-2" };
    const payload = { sub: "user-456", iss: "https://example.com", exp: now - 100, iat: now - 3700 };

    const headerB64 = b64url(JSON.stringify(header));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const token = `${headerB64}.${payloadB64}.${sigB64}`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toBeNull();
  });

  it("returns null for wrong issuer", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );

    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    (publicJwk as Record<string, unknown>).kid = "test-key-3";

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: "test-key-3" };
    const payload = { sub: "user-789", iss: "https://wrong-issuer.com", exp: now + 3600, iat: now };

    const headerB64 = b64url(JSON.stringify(header));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signedData);
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const token = `${headerB64}.${payloadB64}.${sigB64}`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await verifyJWT(`Bearer ${token}`, "https://example.com");
    expect(result).toBeNull();
  });
});
