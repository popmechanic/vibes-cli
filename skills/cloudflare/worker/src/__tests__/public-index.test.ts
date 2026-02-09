import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf-8");

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

  it("retries subscription check after payment", () => {
    expect(html).toContain("pendingSubdomain");
  });
});
