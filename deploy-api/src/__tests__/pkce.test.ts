import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateCodeChallenge } from "../pkce";

describe("PKCE", () => {
  it("generates a code verifier of appropriate length", async () => {
    const verifier = await generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // Must be URL-safe base64
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
  });

  it("generates a valid S256 code challenge", async () => {
    const verifier = await generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    // Must be URL-safe base64 without padding
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
    expect(challenge).not.toContain("=");
  });

  it("same verifier produces same challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it("different verifiers produce different challenges", async () => {
    const v1 = await generateCodeVerifier();
    const v2 = await generateCodeVerifier();
    const c1 = await generateCodeChallenge(v1);
    const c2 = await generateCodeChallenge(v2);
    expect(c1).not.toBe(c2);
  });
});
