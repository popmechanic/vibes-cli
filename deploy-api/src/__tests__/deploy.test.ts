import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// 1. Subdomain validation
// ---------------------------------------------------------------------------

const nameRegex = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

describe("subdomain validation", () => {
  it("accepts valid names", () => {
    expect(nameRegex.test("my-app")).toBe(true);
    expect(nameRegex.test("app123")).toBe(true);
    expect(nameRegex.test("a")).toBe(true);
    expect(nameRegex.test("a1")).toBe(true);
    expect(nameRegex.test("hello-world-123")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(nameRegex.test("My-App")).toBe(false);
    expect(nameRegex.test("APP")).toBe(false);
  });

  it("rejects leading hyphen", () => {
    expect(nameRegex.test("-app")).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    expect(nameRegex.test("app-")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(nameRegex.test("")).toBe(false);
  });

  it("rejects underscores", () => {
    expect(nameRegex.test("app_name")).toBe(false);
  });

  it("rejects names longer than 63 characters", () => {
    // 64 chars: 1 start + 62 middle + 1 end = 64
    const long = "a" + "b".repeat(62) + "c";
    expect(long.length).toBe(64);
    expect(nameRegex.test(long)).toBe(false);

    // 63 chars should be valid
    const maxLen = "a" + "b".repeat(61) + "c";
    expect(maxLen.length).toBe(63);
    expect(nameRegex.test(maxLen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. userOwnsOrCanCreate
// ---------------------------------------------------------------------------

interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

function userOwnsOrCanCreate(
  record: SubdomainRecord | null,
  userId: string
): boolean {
  if (!record) return true;
  if (record.owner === userId) return true;
  if (record.collaborators?.some((c) => c.userId === userId)) return true;
  return false;
}

describe("userOwnsOrCanCreate", () => {
  it("allows unclaimed subdomains (null record)", () => {
    expect(userOwnsOrCanCreate(null, "user-1")).toBe(true);
  });

  it("allows the owner", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(userOwnsOrCanCreate(record, "user-1")).toBe(true);
  });

  it("allows collaborators", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      collaborators: [
        { userId: "user-2", role: "editor" },
        { userId: "user-3" },
      ],
    };
    expect(userOwnsOrCanCreate(record, "user-2")).toBe(true);
    expect(userOwnsOrCanCreate(record, "user-3")).toBe(true);
  });

  it("rejects non-owners and non-collaborators", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      collaborators: [{ userId: "user-2" }],
    };
    expect(userOwnsOrCanCreate(record, "user-99")).toBe(false);
  });

  it("rejects when collaborators array is empty", () => {
    const record: SubdomainRecord = { owner: "user-1", collaborators: [] };
    expect(userOwnsOrCanCreate(record, "user-99")).toBe(false);
  });

  it("rejects when collaborators is undefined", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(userOwnsOrCanCreate(record, "user-99")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. JWT parsing / base64url decoding
// ---------------------------------------------------------------------------

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("base64url decoding", () => {
  it("decodes a simple string", () => {
    const encoded = base64UrlEncode("hello world");
    expect(base64UrlDecode(encoded)).toBe("hello world");
  });

  it("handles base64url characters (- and _)", () => {
    // Standard base64 with + and / chars
    const input = "subjects?q=1&r=2"; // produces + in base64
    const encoded = base64UrlEncode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(base64UrlDecode(encoded)).toBe(input);
  });

  it("handles padding edge cases", () => {
    // Length % 3 == 0 → no padding needed
    expect(base64UrlDecode(base64UrlEncode("abc"))).toBe("abc");
    // Length % 3 == 1 → 2 padding chars
    expect(base64UrlDecode(base64UrlEncode("abcd"))).toBe("abcd");
    // Length % 3 == 2 → 1 padding char
    expect(base64UrlDecode(base64UrlEncode("abcde"))).toBe("abcde");
  });

  it("decodes a JSON payload (like a JWT claim)", () => {
    const payload = JSON.stringify({ sub: "user-123", iss: "https://auth.example.com" });
    const encoded = base64UrlEncode(payload);
    const decoded = base64UrlDecode(encoded);
    expect(JSON.parse(decoded)).toEqual({ sub: "user-123", iss: "https://auth.example.com" });
  });

  it("round-trips empty string", () => {
    expect(base64UrlDecode(base64UrlEncode(""))).toBe("");
  });
});

describe("JWT parsing structure", () => {
  it("splits a mock JWT into three parts", () => {
    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64UrlEncode(
      JSON.stringify({ sub: "user-1", iss: "https://id.example.com", exp: 9999999999, iat: 1000000000 })
    );
    const signature = base64UrlEncode("fake-signature-bytes");
    const token = `${header}.${payload}.${signature}`;

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const parsedHeader = JSON.parse(base64UrlDecode(parts[0]));
    expect(parsedHeader.alg).toBe("RS256");

    const parsedPayload = JSON.parse(base64UrlDecode(parts[1]));
    expect(parsedPayload.sub).toBe("user-1");
    expect(parsedPayload.iss).toBe("https://id.example.com");
  });

  it("rejects tokens without three parts", () => {
    const parts1 = "onlyonepart".split(".");
    expect(parts1.length).not.toBe(3);

    const parts2 = "two.parts".split(".");
    expect(parts2.length).not.toBe(3);

    const parts4 = "four.parts.here.oops".split(".");
    expect(parts4.length).not.toBe(3);
  });
});
