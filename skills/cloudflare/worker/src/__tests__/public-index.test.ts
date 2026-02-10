import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const html = readFileSync(new URL("../../../../sell/templates/unified.html", import.meta.url), "utf-8");

describe("public index billing gates", () => {
  it("removes JWT plan claim fast-paths", () => {
    expect(html).not.toContain("sessionClaims?.pla");
  });

  it("removes non-post-payment JWT pla retry", () => {
    expect(html).not.toContain("payload.pla");
  });

  it("removes jwtQuota fallback", () => {
    expect(html).not.toContain("jwtQuota");
  });

  it("uses has() for plan check instead of session claims", () => {
    expect(html).toContain("has({ plan:");
  });

  it("does not contain quota_exceeded error handling", () => {
    expect(html).not.toContain("quota_exceeded");
  });
});
