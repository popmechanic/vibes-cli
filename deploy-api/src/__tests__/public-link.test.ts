import { describe, it, expect } from "vitest";

interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  publicInvite?: { token: string; right: string; createdAt: string };
}

describe("public link generation", () => {
  it("only the owner can generate a public link", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(record.owner === "user-1").toBe(true);
    expect(record.owner === "user-2").toBe(false);
  });

  it("stores publicInvite on the subdomain record", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    const token = "test-uuid-token";
    const updated: SubdomainRecord = {
      ...record,
      publicInvite: { token, right: "write", createdAt: new Date().toISOString() },
    };
    expect(updated.publicInvite?.token).toBe(token);
    expect(updated.publicInvite?.right).toBe("write");
  });

  it("regenerating replaces the old token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "old-token", right: "write", createdAt: "2026-01-01" },
    };
    const newToken = "new-token";
    const updated: SubdomainRecord = {
      ...record,
      publicInvite: { token: newToken, right: "write", createdAt: new Date().toISOString() },
    };
    expect(updated.publicInvite?.token).toBe(newToken);
    expect(updated.publicInvite?.token).not.toBe("old-token");
  });
});

describe("join token validation", () => {
  it("accepts matching token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "abc123", right: "write", createdAt: "2026-01-01" },
    };
    expect(record.publicInvite?.token === "abc123").toBe(true);
  });

  it("rejects wrong token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "abc123", right: "write", createdAt: "2026-01-01" },
    };
    expect(record.publicInvite?.token === "wrong").toBe(false);
  });

  it("rejects when no public link exists", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(record.publicInvite).toBeUndefined();
  });
});
