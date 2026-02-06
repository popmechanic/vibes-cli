import { describe, it, expect } from "vitest";
import { parseAccountId, parseOauthToken } from "../../lib/resolve-workers-url.js";

describe("parseAccountId", () => {
  it("extracts 32-char hex account ID from wrangler whoami table output", () => {
    const output = `
 ⛅️ wrangler 4.54.0
─────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email user@example.com.
┌──────────────────────────────┬──────────────────────────────────┐
│ Account Name                 │ Account ID                       │
├──────────────────────────────┼──────────────────────────────────┤
│ User's Account               │ e33948793047032de7f5e18ec342a7d1 │
└──────────────────────────────┴──────────────────────────────────┘`;
    expect(parseAccountId(output)).toBe("e33948793047032de7f5e18ec342a7d1");
  });

  it("returns null when no account ID found", () => {
    expect(parseAccountId("Not logged in. Please run wrangler login.")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAccountId("")).toBeNull();
  });

  it("handles multi-account output (returns first match)", () => {
    const output = `
┌──────────────────────────────┬──────────────────────────────────┐
│ Account Name                 │ Account ID                       │
├──────────────────────────────┼──────────────────────────────────┤
│ Personal Account             │ aaaa00001111222233334444aaaabbbb │
│ Team Account                 │ bbbb00001111222233334444ccccdddd │
└──────────────────────────────┴──────────────────────────────────┘`;
    expect(parseAccountId(output)).toBe("aaaa00001111222233334444aaaabbbb");
  });

  it("ignores non-hex 32-char strings", () => {
    // 'g' is not a hex character
    expect(parseAccountId("gggg0000111122223333444455556666")).toBeNull();
  });
});

describe("parseOauthToken", () => {
  it("extracts token from typical wrangler config TOML", () => {
    const toml = `oauth_token = "abc123.def456"
expiration_time = "2026-02-06T07:44:37.416Z"
refresh_token = "refresh.token"
scopes = [ "account:read" ]`;
    expect(parseOauthToken(toml)).toBe("abc123.def456");
  });

  it("returns null when no oauth_token found", () => {
    expect(parseOauthToken("refresh_token = \"something\"")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseOauthToken("")).toBeNull();
  });

  it("handles token with dots and special characters", () => {
    const toml = `oauth_token = "JoS86Fst.6N0bb3pV-Q1bvTcq_IA687J"`;
    expect(parseOauthToken(toml)).toBe("JoS86Fst.6N0bb3pV-Q1bvTcq_IA687J");
  });

  it("handles extra whitespace around equals sign", () => {
    const toml = `oauth_token   =   "mytoken"`;
    expect(parseOauthToken(toml)).toBe("mytoken");
  });

  it("picks up oauth_token even if not on first line", () => {
    const toml = `# some comment
expiration_time = "2026-01-01"
oauth_token = "found-it"`;
    expect(parseOauthToken(toml)).toBe("found-it");
  });
});
