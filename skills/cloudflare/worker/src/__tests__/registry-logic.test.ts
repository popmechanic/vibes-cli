import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SubdomainRecord } from "../types";
import {
  isSubdomainAvailable,
  createSubdomainRecord,
  freezeSubdomain,
  unfreezeSubdomain,
  addCollaborator,
  activateCollaborator,
  removeCollaborator,
  hasAccess,
  hasAccessByEmail,
  // Legacy wrappers
  isSubdomainAvailableLegacy,
  createClaim,
  getUserClaims,
  processSubscriptionChange,
} from "../lib/registry-logic";

function makeRecord(overrides: Partial<SubdomainRecord> = {}): SubdomainRecord {
  return {
    ownerId: "user_owner",
    claimedAt: "2026-02-08T00:00:00Z",
    collaborators: [],
    status: 'active',
    ...overrides,
  };
}

describe("isSubdomainAvailable (per-key model)", () => {
  const reserved = ["admin", "api", "www"];
  const preallocated = { demo: "user_admin" };

  it("returns available for unclaimed subdomain", () => {
    const result = isSubdomainAvailable("mysite", null, reserved, preallocated);
    expect(result.available).toBe(true);
  });

  it("rejects reserved subdomains", () => {
    const result = isSubdomainAvailable("admin", null, reserved, preallocated);
    expect(result).toEqual({ available: false, reason: "reserved" });
  });

  it("rejects preallocated subdomains", () => {
    const result = isSubdomainAvailable("demo", null, reserved, preallocated);
    expect(result).toEqual({
      available: false,
      reason: "preallocated",
      ownerId: "user_admin",
    });
  });

  it("rejects already-claimed subdomains", () => {
    const existing = makeRecord({ ownerId: "user_abc" });
    const result = isSubdomainAvailable("mysite", existing, reserved, preallocated);
    expect(result).toEqual({
      available: false,
      reason: "claimed",
      ownerId: "user_abc",
    });
  });

  it("rejects subdomains that are too short", () => {
    const result = isSubdomainAvailable("ab", null, reserved, preallocated);
    expect(result.reason).toBe("too_short");
  });

  it("rejects subdomains that are too long", () => {
    const result = isSubdomainAvailable("a".repeat(64), null, reserved, preallocated);
    expect(result.reason).toBe("too_long");
  });

  it("rejects invalid format", () => {
    const result = isSubdomainAvailable("-bad-", null, reserved, preallocated);
    expect(result.reason).toBe("invalid_format");
  });

  it("is case-insensitive", () => {
    const result = isSubdomainAvailable("ADMIN", null, reserved, preallocated);
    expect(result.reason).toBe("reserved");
  });
});

describe("createSubdomainRecord", () => {
  it("creates a new record with empty collaborators and active status", () => {
    const record = createSubdomainRecord("user_abc");
    expect(record.ownerId).toBe("user_abc");
    expect(record.collaborators).toEqual([]);
    expect(record.claimedAt).toBeTruthy();
    expect(record.status).toBe('active');
  });
});

describe("freezeSubdomain", () => {
  it("sets status to frozen and adds frozenAt timestamp", () => {
    const record = makeRecord();
    const frozen = freezeSubdomain(record);
    expect(frozen.status).toBe('frozen');
    expect(frozen.frozenAt).toBeTruthy();
    expect(frozen.ownerId).toBe(record.ownerId);
    expect(frozen.collaborators).toEqual(record.collaborators);
  });

  it("does not mutate original record", () => {
    const record = makeRecord();
    freezeSubdomain(record);
    expect(record.status).toBe('active');
  });
});

describe("unfreezeSubdomain", () => {
  it("sets status to active and removes frozenAt", () => {
    const record = makeRecord({ status: 'frozen', frozenAt: '2026-02-10T00:00:00Z' });
    const unfrozen = unfreezeSubdomain(record);
    expect(unfrozen.status).toBe('active');
    expect(unfrozen.frozenAt).toBeUndefined();
    expect(unfrozen.ownerId).toBe(record.ownerId);
  });

  it("does not mutate original record", () => {
    const record = makeRecord({ status: 'frozen', frozenAt: '2026-02-10T00:00:00Z' });
    unfreezeSubdomain(record);
    expect(record.status).toBe('frozen');
    expect(record.frozenAt).toBe('2026-02-10T00:00:00Z');
  });
});

describe("addCollaborator", () => {
  it("adds a new collaborator with invited status", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "bob@example.com", "write");
    expect(updated.collaborators).toHaveLength(1);
    expect(updated.collaborators[0].email).toBe("bob@example.com");
    expect(updated.collaborators[0].status).toBe("invited");
    expect(updated.collaborators[0].right).toBe("write");
    expect(updated.collaborators[0].invitedAt).toBeTruthy();
  });

  it("normalizes email to lowercase", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "Bob@Example.COM");
    expect(updated.collaborators[0].email).toBe("bob@example.com");
  });

  it("is idempotent — does not add duplicate email", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const updated = addCollaborator(record, "bob@example.com", "read");
    expect(updated.collaborators).toHaveLength(1);
    // Should return the same reference since no change
    expect(updated).toBe(record);
  });

  it("defaults right to write", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "bob@example.com");
    expect(updated.collaborators[0].right).toBe("write");
  });

  it("does not mutate original record", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "bob@example.com");
    expect(record.collaborators).toHaveLength(0);
    expect(updated.collaborators).toHaveLength(1);
  });

  it("stores ledgerId on the collaborator when provided", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "bob@example.com", "write", "ledger_xyz");
    expect(updated.collaborators[0].ledgerId).toBe("ledger_xyz");
  });

  it("omits ledgerId when not provided", () => {
    const record = makeRecord();
    const updated = addCollaborator(record, "bob@example.com", "write");
    expect(updated.collaborators[0].ledgerId).toBeUndefined();
  });
});

describe("activateCollaborator", () => {
  it("sets status to active and assigns userId", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const updated = activateCollaborator(record, "bob@example.com", "user_bob");
    expect(updated.collaborators[0].status).toBe("active");
    expect(updated.collaborators[0].userId).toBe("user_bob");
    expect(updated.collaborators[0].joinedAt).toBeTruthy();
  });

  it("only activates matching email (case-insensitive)", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
        {
          email: "carol@example.com",
          status: "invited",
          right: "read",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const updated = activateCollaborator(record, "BOB@EXAMPLE.COM", "user_bob");
    expect(updated.collaborators[0].status).toBe("active");
    expect(updated.collaborators[1].status).toBe("invited");
  });

  it("does not mutate original record", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    activateCollaborator(record, "bob@example.com", "user_bob");
    expect(record.collaborators[0].status).toBe("invited");
  });
});

describe("removeCollaborator", () => {
  it("removes collaborator by email", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "active",
          right: "write",
          userId: "user_bob",
          invitedAt: "2026-02-08T00:00:00Z",
          joinedAt: "2026-02-08T01:00:00Z",
        },
      ],
    });
    const updated = removeCollaborator(record, "bob@example.com");
    expect(updated.collaborators).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const updated = removeCollaborator(record, "BOB@EXAMPLE.COM");
    expect(updated.collaborators).toHaveLength(0);
  });

  it("leaves other collaborators intact", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "active",
          right: "write",
          userId: "user_bob",
          invitedAt: "2026-02-08T00:00:00Z",
        },
        {
          email: "carol@example.com",
          status: "invited",
          right: "read",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const updated = removeCollaborator(record, "bob@example.com");
    expect(updated.collaborators).toHaveLength(1);
    expect(updated.collaborators[0].email).toBe("carol@example.com");
  });
});

describe("hasAccess", () => {
  it("owner has access with role owner", () => {
    const record = makeRecord({ ownerId: "user_owner" });
    const result = hasAccess(record, "user_owner");
    expect(result).toEqual({ hasAccess: true, role: "owner", frozen: false });
  });

  it("active collaborator has access with role collaborator", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          userId: "user_bob",
          status: "active",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
          joinedAt: "2026-02-08T01:00:00Z",
        },
      ],
    });
    const result = hasAccess(record, "user_bob");
    expect(result).toEqual({ hasAccess: true, role: "collaborator", frozen: false });
  });

  it("invited (not active) collaborator does NOT have access", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          userId: "user_bob",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    const result = hasAccess(record, "user_bob");
    expect(result).toEqual({ hasAccess: false, role: "none", frozen: false });
  });

  it("non-member has no access", () => {
    const record = makeRecord();
    const result = hasAccess(record, "user_stranger");
    expect(result).toEqual({ hasAccess: false, role: "none", frozen: false });
  });

  it("frozen record reports frozen=true", () => {
    const record = makeRecord({ status: 'frozen', frozenAt: '2026-02-10T00:00:00Z' });
    const result = hasAccess(record, "user_owner");
    expect(result).toEqual({ hasAccess: true, role: "owner", frozen: true });
  });
});

describe("hasAccessByEmail", () => {
  it("returns true for invited collaborator email", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    expect(hasAccessByEmail(record, "bob@example.com")).toBe(true);
  });

  it("returns true for active collaborator email", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          userId: "user_bob",
          status: "active",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
          joinedAt: "2026-02-08T01:00:00Z",
        },
      ],
    });
    expect(hasAccessByEmail(record, "bob@example.com")).toBe(true);
  });

  it("returns false for non-member email", () => {
    const record = makeRecord();
    expect(hasAccessByEmail(record, "stranger@example.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    const record = makeRecord({
      collaborators: [
        {
          email: "bob@example.com",
          status: "invited",
          right: "write",
          invitedAt: "2026-02-08T00:00:00Z",
        },
      ],
    });
    expect(hasAccessByEmail(record, "BOB@EXAMPLE.COM")).toBe(true);
  });
});

describe("legacy compatibility wrappers", () => {
  describe("isSubdomainAvailableLegacy", () => {
    it("works with old Registry format", () => {
      const registry = {
        claims: { alice: { userId: "u1", claimedAt: "2026-01-01" } },
        reserved: ["admin"],
        preallocated: {},
      };
      expect(isSubdomainAvailableLegacy(registry, "alice").available).toBe(false);
      expect(isSubdomainAvailableLegacy(registry, "newsite").available).toBe(true);
      expect(isSubdomainAvailableLegacy(registry, "admin").available).toBe(false);
    });
  });

  describe("createClaim", () => {
    it("creates a claim in legacy format", () => {
      const registry = { claims: {}, reserved: [], preallocated: {} };
      const result = createClaim(registry, "mysite", "user_abc");
      expect(result.success).toBe(true);
      expect(registry.claims.mysite.userId).toBe("user_abc");
    });
  });

  describe("processSubscriptionChange", () => {
    it("releases claims when subscription reduces", () => {
      const registry = {
        claims: {
          a: { userId: "u1", claimedAt: "2026-01-01" },
          b: { userId: "u1", claimedAt: "2026-01-02" },
        },
        reserved: [],
        preallocated: {},
      };
      const result = processSubscriptionChange(registry, "u1", 0);
      expect(result.released).toHaveLength(2);
      expect(Object.keys(registry.claims)).toHaveLength(0);
    });
  });
});
