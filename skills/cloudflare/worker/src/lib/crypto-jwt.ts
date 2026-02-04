/**
 * JWT verification using Web Crypto API (SubtleCrypto)
 * Replaces jsonwebtoken for Cloudflare Workers compatibility.
 */

import { matchAzp, validateJwtTiming } from "./jwt-validation";

/**
 * Convert PEM-encoded public key to ArrayBuffer for Web Crypto API
 */
export function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Remove header, footer, and whitespace
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");

  // Decode base64 to binary
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decode base64url (JWT encoding) to string
 */
function base64UrlDecode(str: string): string {
  // Replace URL-safe chars with standard base64
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Parse JWT without verification (to extract header and payload)
 */
function parseJwt(token: string): {
  header: { alg: string; typ: string };
  payload: Record<string, unknown>;
  signature: Uint8Array;
  signedData: Uint8Array;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    // Decode signature
    const sigBase64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPadded = sigBase64 + "=".repeat((4 - (sigBase64.length % 4)) % 4);
    const sigBinary = atob(sigPadded);
    const signature = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      signature[i] = sigBinary.charCodeAt(i);
    }

    // The signed data is header.payload (without signature)
    const signedDataStr = `${parts[0]}.${parts[1]}`;
    const signedData = new TextEncoder().encode(signedDataStr);

    return { header, payload, signature, signedData };
  } catch {
    return null;
  }
}

/**
 * Verify Clerk JWT from Authorization header using Web Crypto API
 */
export async function verifyClerkJWT(
  authHeader: string | null,
  pemPublicKey: string,
  permittedOrigins: string[]
): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const parsed = parseJwt(token);

  if (!parsed) {
    console.error("Failed to parse JWT");
    return null;
  }

  // Verify algorithm
  if (parsed.header.alg !== "RS256") {
    console.error("Unsupported JWT algorithm:", parsed.header.alg);
    return null;
  }

  try {
    // Import the public key
    const keyData = pemToArrayBuffer(pemPublicKey);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify signature
    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      parsed.signature,
      parsed.signedData
    );

    if (!isValid) {
      console.error("JWT signature verification failed");
      return null;
    }

    // Validate timing (exp, nbf)
    const timingResult = validateJwtTiming(parsed.payload as { exp?: number; nbf?: number });
    if (!timingResult.valid) {
      console.error("JWT timing validation failed:", timingResult.reason);
      return null;
    }

    // Validate azp (authorized party)
    if (!matchAzp(parsed.payload.azp as string | undefined, permittedOrigins)) {
      console.error("Invalid azp claim:", parsed.payload.azp);
      return null;
    }

    // Extract user ID from sub claim
    const userId = parsed.payload.sub as string;
    if (!userId) {
      console.error("No sub claim in JWT");
      return null;
    }

    return { userId };
  } catch (error) {
    console.error("JWT verification error:", error);
    return null;
  }
}
