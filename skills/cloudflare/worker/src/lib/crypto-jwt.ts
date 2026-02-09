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
// Debug version that returns failure reason
export async function verifyClerkJWTDebug(
  authHeader: string | null,
  pemPublicKey: string,
  permittedOrigins: string[]
): Promise<{ userId: string; pla?: string } | { error: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "no_auth_header" };
  }

  const token = authHeader.slice(7);
  const parsed = parseJwt(token);

  if (!parsed) {
    return { error: "parse_jwt_failed" };
  }

  if (parsed.header.alg !== "RS256") {
    return { error: `bad_algorithm:${parsed.header.alg}` };
  }

  try {
    const keyData = pemToArrayBuffer(pemPublicKey);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      parsed.signature,
      parsed.signedData
    );

    if (!isValid) {
      return { error: "signature_invalid" };
    }

    const timingResult = validateJwtTiming(parsed.payload as { exp?: number; nbf?: number });
    if (!timingResult.valid) {
      return { error: `timing:${timingResult.reason}` };
    }

    if (!matchAzp(parsed.payload.azp as string | undefined, permittedOrigins)) {
      return { error: `azp_mismatch:${parsed.payload.azp}` };
    }

    const userId = parsed.payload.sub as string;
    if (!userId) {
      return { error: "no_sub_claim" };
    }

    const pla = parsed.payload.pla as string | undefined;
    return { userId, pla };
  } catch (error) {
    return { error: `exception:${error}` };
  }
}

export async function verifyClerkJWT(
  authHeader: string | null,
  pemPublicKey: string,
  permittedOrigins: string[]
): Promise<{ userId: string; pla?: string } | null> {
  const result = await verifyClerkJWTDebug(authHeader, pemPublicKey, permittedOrigins);
  if ('error' in result) {
    console.error("JWT verification failed:", result.error);
    return null;
  }
  return result;
}
