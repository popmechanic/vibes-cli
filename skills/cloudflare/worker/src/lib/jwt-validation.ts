/**
 * JWT Validation Utilities
 * Copied from scripts/lib/jwt-validation.js with TypeScript types added.
 */

export function matchAzp(azp: string | undefined, permittedOrigins: string[]): boolean {
  if (!azp || !permittedOrigins || permittedOrigins.length === 0) {
    return true;
  }

  return permittedOrigins.some((pattern) => {
    if (pattern === azp) return true;

    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("^" + escaped.replace(/\*/g, "[^.]+") + "$");
      return regex.test(azp);
    }

    return false;
  });
}

export function validateJwtTiming(
  decoded: { exp?: number; nbf?: number },
  currentTime: number = Math.floor(Date.now() / 1000)
): { valid: boolean; reason?: string } {
  if (decoded.exp && decoded.exp <= currentTime) {
    return { valid: false, reason: "expired" };
  }

  if (decoded.nbf && decoded.nbf > currentTime) {
    return { valid: false, reason: "not_yet_valid" };
  }

  return { valid: true };
}

export function parsePermittedOrigins(originsString: string | undefined): string[] {
  if (!originsString) return [];
  return originsString.split(",").map((s) => s.trim()).filter(Boolean);
}
