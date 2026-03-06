/**
 * Vibes OIDC Bridge Module
 *
 * OIDC authentication bridge for Vibes apps (replaces the legacy Clerk-based bridge).
 * Implements standard OIDC authorization code flow with PKCE using oauth4webapi.
 *
 * Provides:
 *   1. OIDCProvider — React context for auth state (token lifecycle, user info)
 *   2. SignedIn / SignedOut — Conditional rendering based on auth state
 *   3. SignInButton / UserButton — UI primitives for auth actions
 *   4. useUser() — Current user from OIDC id_token claims
 *   5. useFireproofOIDC(name, opts) — Wraps useFireproof with dashApi patching
 *   6. Sync status bridge -> window.__VIBES_SYNC_STATUS__ + custom event
 *   7. Ledger discovery -> 3-tier routing for multi-tenant apps
 *   8. Invite auto-redemption -> reads ?invite= URL param
 *
 * Import map: "use-fireproof" -> this file
 *             "@fireproof/core" -> esm.sh (base use-fireproof package)
 *             "oauth4webapi" -> esm.sh
 */

import React from "react";
import * as oauth from "oauth4webapi";

// Re-export base Fireproof for user app code
export { useFireproof, useLiveQuery, useDocument } from "@fireproof/core";
import { useFireproof as _baseUseFireproof } from "@fireproof/core";

// ─── OIDC Token Management ───────────────────────────────────────────────

var STORAGE_KEY_ACCESS = "vibes_oidc_access_token";
var STORAGE_KEY_REFRESH = "vibes_oidc_refresh_token";
var STORAGE_KEY_ID = "vibes_oidc_id_token";
var STORAGE_KEY_EXPIRY = "vibes_oidc_token_expiry";
var STORAGE_KEY_VERIFIER = "vibes_oidc_code_verifier";

function getStoredTokens() {
  try {
    return {
      accessToken: sessionStorage.getItem(STORAGE_KEY_ACCESS),
      refreshToken: sessionStorage.getItem(STORAGE_KEY_REFRESH),
      idToken: sessionStorage.getItem(STORAGE_KEY_ID),
      expiry: parseInt(sessionStorage.getItem(STORAGE_KEY_EXPIRY) || "0", 10)
    };
  } catch (e) {
    return { accessToken: null, refreshToken: null, idToken: null, expiry: 0 };
  }
}

function storeTokens(accessToken, refreshToken, idToken, expiresIn) {
  try {
    sessionStorage.setItem(STORAGE_KEY_ACCESS, accessToken);
    if (refreshToken) sessionStorage.setItem(STORAGE_KEY_REFRESH, refreshToken);
    if (idToken) sessionStorage.setItem(STORAGE_KEY_ID, idToken);
    var expiry = Math.floor(Date.now() / 1000) + (expiresIn || 3600);
    sessionStorage.setItem(STORAGE_KEY_EXPIRY, String(expiry));
    // Expose for useAI hook and other consumers
    window.__VIBES_OIDC_TOKEN__ = accessToken;
  } catch (e) {
    console.warn("[vibes-oidc] Failed to store tokens:", e);
  }
}

function clearTokens() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_ACCESS);
    sessionStorage.removeItem(STORAGE_KEY_REFRESH);
    sessionStorage.removeItem(STORAGE_KEY_ID);
    sessionStorage.removeItem(STORAGE_KEY_EXPIRY);
    sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
    window.__VIBES_OIDC_TOKEN__ = null;
  } catch (e) {}
}

function isTokenExpired(expiry) {
  if (!expiry) return true;
  // Expire 60s early to allow refresh
  return Math.floor(Date.now() / 1000) > expiry - 60;
}

function parseIdTokenClaims(idToken) {
  if (!idToken) return null;
  try {
    var parts = idToken.split(".");
    if (parts.length !== 3) return null;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return {
      id: payload.sub,
      firstName: payload.given_name || "",
      lastName: payload.family_name || "",
      email: payload.email || "",
      username: payload.preferred_username || "",
      imageUrl: payload.picture || "",
      groups: payload.groups || []
    };
  } catch (e) {
    console.warn("[vibes-oidc] Failed to parse id_token:", e);
    return null;
  }
}

// ─── OIDC PKCE Flow ─────────────────────────────────────────────────────

async function discoverIssuer(authority) {
  var issuerUrl = new URL(authority);
  var as = await oauth.discoveryRequest(issuerUrl).then(function (response) {
    return oauth.processDiscoveryResponse(issuerUrl, response);
  });
  return as;
}

async function startLogin(authority, clientId, redirectUri) {
  var as = await discoverIssuer(authority);
  var client = { client_id: clientId, token_endpoint_auth_method: "none" };
  var codeVerifier = oauth.generateRandomCodeVerifier();
  var codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);

  // Store verifier for callback
  try {
    sessionStorage.setItem(STORAGE_KEY_VERIFIER, codeVerifier);
  } catch (e) {}

  var authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  window.location.href = authUrl.toString();
}

async function handleCallback(authority, clientId, redirectUri) {
  var params = new URLSearchParams(window.location.search);
  var code = params.get("code");
  if (!code) return null;

  var codeVerifier;
  try {
    codeVerifier = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
  } catch (e) {}
  if (!codeVerifier) {
    console.error("[vibes-oidc] No code verifier found for callback");
    return null;
  }

  try {
    var as = await discoverIssuer(authority);
    var client = { client_id: clientId, token_endpoint_auth_method: "none" };

    var currentUrl = new URL(window.location.href);
    var response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      currentUrl,
      redirectUri,
      codeVerifier
    );

    var result = await oauth.processAuthorizationCodeResponse(as, client, response);
    if (oauth.isOAuth2Error(result)) {
      console.error("[vibes-oidc] Token exchange error:", result);
      return null;
    }

    var tokens = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || null,
      idToken: result.id_token || null,
      expiresIn: result.expires_in || 3600
    };

    storeTokens(tokens.accessToken, tokens.refreshToken, tokens.idToken, tokens.expiresIn);

    // Clean up URL — remove code and state params
    params.delete("code");
    params.delete("state");
    var cleanUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState({}, "", cleanUrl);

    return tokens;
  } catch (err) {
    console.error("[vibes-oidc] Callback handling failed:", err);
    return null;
  }
}

async function refreshAccessToken(authority, clientId) {
  var stored = getStoredTokens();
  if (!stored.refreshToken) return null;

  try {
    var as = await discoverIssuer(authority);
    var client = { client_id: clientId, token_endpoint_auth_method: "none" };

    var response = await oauth.refreshTokenGrantRequest(as, client, stored.refreshToken);
    var result = await oauth.processRefreshTokenResponse(as, client, response);
    if (oauth.isOAuth2Error(result)) {
      console.warn("[vibes-oidc] Token refresh failed:", result);
      clearTokens();
      return null;
    }

    storeTokens(
      result.access_token,
      result.refresh_token || stored.refreshToken,
      result.id_token || stored.idToken,
      result.expires_in || 3600
    );

    return {
      accessToken: result.access_token,
      idToken: result.id_token || stored.idToken
    };
  } catch (err) {
    console.warn("[vibes-oidc] Token refresh error:", err);
    clearTokens();
    return null;
  }
}

// ─── Sign Out ────────────────────────────────────────────────────────────

function signOut() {
  clearTokens();
  window.location.reload();
}

// Expose for useVibesPanelEvents logout handler
window.__vibes_oidc_signOut = signOut;

// ─── React Auth Context ──────────────────────────────────────────────────

var OIDCContext = React.createContext({
  isSignedIn: false,
  isLoading: true,
  user: null,
  accessToken: null,
  signOut: signOut,
  dashApi: null
});

/**
 * OIDCProvider — manages token lifecycle, provides auth context.
 * Props: authority (string), clientId (string), config ({ apiUrl, cloudUrl })
 */
export function OIDCProvider(props) {
  var authority = props.authority || props.publishableKey; // backward compat
  var clientId = props.clientId;
  var config = props.config || {};

  var _s = React.useState({ isLoading: true, isSignedIn: false, user: null, accessToken: null });
  var authState = _s[0];
  var setAuthState = _s[1];

  React.useEffect(function () {
    var cancelled = false;
    var redirectUri = window.location.origin + window.location.pathname;

    async function init() {
      // Step 1: Check for callback code
      var params = new URLSearchParams(window.location.search);
      if (params.has("code")) {
        var tokens = await handleCallback(authority, clientId, redirectUri);
        if (tokens && !cancelled) {
          var user = parseIdTokenClaims(tokens.idToken);
          setAuthState({ isLoading: false, isSignedIn: true, user: user, accessToken: tokens.accessToken });
          return;
        }
      }

      // Step 2: Check stored tokens
      var stored = getStoredTokens();
      if (stored.accessToken && !isTokenExpired(stored.expiry)) {
        window.__VIBES_OIDC_TOKEN__ = stored.accessToken;
        var user = parseIdTokenClaims(stored.idToken);
        if (!cancelled) {
          setAuthState({ isLoading: false, isSignedIn: true, user: user, accessToken: stored.accessToken });
        }
        return;
      }

      // Step 3: Try refresh
      if (stored.refreshToken) {
        var refreshed = await refreshAccessToken(authority, clientId);
        if (refreshed && !cancelled) {
          var user = parseIdTokenClaims(refreshed.idToken);
          setAuthState({ isLoading: false, isSignedIn: true, user: user, accessToken: refreshed.accessToken });
          return;
        }
      }

      // Step 4: Not signed in
      if (!cancelled) {
        setAuthState({ isLoading: false, isSignedIn: false, user: null, accessToken: null });
      }
    }

    init();
    return function () { cancelled = true; };
  }, [authority, clientId]);

  // Set up token refresh timer
  React.useEffect(function () {
    if (!authState.isSignedIn) return;
    var stored = getStoredTokens();
    var timeUntilExpiry = (stored.expiry - 60) * 1000 - Date.now();
    if (timeUntilExpiry <= 0) timeUntilExpiry = 60000;

    var timer = setTimeout(function () {
      refreshAccessToken(authority, clientId).then(function (refreshed) {
        if (refreshed) {
          var user = parseIdTokenClaims(refreshed.idToken);
          setAuthState(function (prev) {
            return Object.assign({}, prev, { user: user, accessToken: refreshed.accessToken });
          });
        } else {
          setAuthState({ isLoading: false, isSignedIn: false, user: null, accessToken: null });
        }
      });
    }, timeUntilExpiry);

    return function () { clearTimeout(timer); };
  }, [authState.isSignedIn, authority, clientId]);

  // Build minimal dashApi-compatible interface
  var dashApi = React.useMemo(function () {
    if (!authState.accessToken || !config.apiUrl) return null;
    var apiUrl = config.apiUrl.replace(/\/$/, "");
    var token = authState.accessToken;

    return {
      ensureCloudToken: function (req) {
        return fetch(apiUrl + "/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(req)
        }).then(function (r) { return r.json(); });
      },
      listLedgersByUser: function () {
        return fetch(apiUrl + "/ledgers", {
          headers: { "Authorization": "Bearer " + token }
        }).then(function (r) { return r.json(); }).then(function (data) {
          return { isOk: function () { return true; }, Ok: function () { return data; }, isErr: function () { return false; } };
        }).catch(function (err) {
          return { isOk: function () { return false; }, isErr: function () { return true; }, Err: function () { return err; } };
        });
      },
      inviteUser: function (opts) {
        return fetch(apiUrl + "/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(opts)
        }).then(function (r) { return r.json(); }).then(function (data) {
          return { isOk: function () { return true; }, Ok: function () { return data; }, isErr: function () { return false; } };
        }).catch(function (err) {
          return { isOk: function () { return false; }, isErr: function () { return true; }, Err: function () { return err; } };
        });
      },
      redeemInvite: function (opts) {
        return fetch(apiUrl + "/invite/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(opts)
        }).then(function (r) { return r.json(); }).then(function (data) {
          return { isOk: function () { return true; }, Ok: function () { return data; }, isErr: function () { return false; } };
        }).catch(function (err) {
          return { isOk: function () { return false; }, isErr: function () { return true; }, Err: function () { return err; } };
        });
      }
    };
  }, [authState.accessToken, config.apiUrl]);

  var contextValue = {
    isSignedIn: authState.isSignedIn,
    isLoading: authState.isLoading,
    user: authState.user,
    accessToken: authState.accessToken,
    signOut: signOut,
    dashApi: dashApi
  };

  return React.createElement(
    OIDCContext.Provider,
    { value: contextValue },
    props.children
  );
}

// ─── Auth-Conditional Components ─────────────────────────────────────────

export function SignedIn(props) {
  var ctx = React.useContext(OIDCContext);
  if (ctx.isLoading) return null;
  return ctx.isSignedIn ? props.children : null;
}

export function SignedOut(props) {
  var ctx = React.useContext(OIDCContext);
  if (ctx.isLoading) return null;
  return ctx.isSignedIn ? null : props.children;
}

// ─── SignInButton ────────────────────────────────────────────────────────

export function SignInButton(props) {
  var config = window.__VIBES_CONFIG__ || {};

  function handleClick() {
    var authority = config.oidcAuthority;
    var clientId = config.oidcClientId;
    if (!authority || !clientId) {
      console.error("[vibes-oidc] Missing oidcAuthority or oidcClientId in config");
      return;
    }
    startLogin(authority, clientId, window.location.origin + window.location.pathname);
  }

  // If children are provided (e.g., wrapping a button), clone with onClick
  if (props.children) {
    return React.cloneElement(
      React.Children.only(props.children),
      { onClick: handleClick }
    );
  }

  // Default button
  return React.createElement("button", { onClick: handleClick }, "Sign In");
}

// ─── UserButton ──────────────────────────────────────────────────────────

export function UserButton() {
  var ctx = React.useContext(OIDCContext);
  var _s = React.useState(false);
  var showMenu = _s[0];
  var setShowMenu = _s[1];

  if (!ctx.isSignedIn || !ctx.user) return null;

  var initials = (ctx.user.firstName ? ctx.user.firstName[0] : "") + (ctx.user.lastName ? ctx.user.lastName[0] : "");
  if (!initials) initials = (ctx.user.email || "?")[0].toUpperCase();

  return React.createElement("div", { style: { position: "relative", display: "inline-block" } },
    React.createElement("button", {
      onClick: function () { setShowMenu(!showMenu); },
      style: {
        width: "32px", height: "32px", borderRadius: "50%",
        background: ctx.user.imageUrl ? "url(" + ctx.user.imageUrl + ") center/cover" : "#6366f1",
        color: "white", border: "none", cursor: "pointer", fontSize: "14px",
        display: "flex", alignItems: "center", justifyContent: "center"
      }
    }, ctx.user.imageUrl ? null : initials),
    showMenu ? React.createElement("div", {
      style: {
        position: "absolute", top: "36px", right: 0, background: "white",
        border: "1px solid #e5e5e5", borderRadius: "8px", padding: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)", minWidth: "180px", zIndex: 1000
      }
    },
      React.createElement("div", {
        style: { padding: "8px", borderBottom: "1px solid #e5e5e5", marginBottom: "4px" }
      },
        React.createElement("div", { style: { fontWeight: 500, fontSize: "14px" } },
          ctx.user.firstName + " " + ctx.user.lastName
        ),
        React.createElement("div", { style: { fontSize: "12px", color: "#666" } }, ctx.user.email)
      ),
      React.createElement("button", {
        onClick: signOut,
        style: {
          width: "100%", padding: "8px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left", fontSize: "14px", borderRadius: "4px"
        },
        onMouseEnter: function (e) { e.target.style.background = "#f5f5f5"; },
        onMouseLeave: function (e) { e.target.style.background = "none"; }
      }, "Sign out")
    ) : null
  );
}

// ─── useUser Hook ────────────────────────────────────────────────────────

export function useUser() {
  var ctx = React.useContext(OIDCContext);
  return {
    isSignedIn: ctx.isSignedIn,
    isLoaded: !ctx.isLoading,
    user: ctx.user
  };
}

// ─── useOIDCContext (for SharingBridge and other internal consumers) ──────

export function useOIDCContext() {
  return React.useContext(OIDCContext);
}
// Expose for SharingBridge in base template
window.useOIDCContext = useOIDCContext;

// ─── Fireproof + OIDC integration (useFireproofOIDC) ─────────────────────
// Wraps base useFireproof with dashApi patching (ledger routing),
// sync status bridge, invite auto-redemption, and onTock kick.

var _patchedApis = typeof WeakSet !== "undefined" ? new WeakSet() : { has: function () { return false; }, add: function () {} };
var _currentDbName = null;

export function useFireproofOIDC(name, opts) {
  var ctx = React.useContext(OIDCContext);
  var dashApi = ctx && ctx.dashApi;

  // Patch dashApi to route to correct per-database ledger (3-tier routing)
  if (dashApi && !_patchedApis.has(dashApi)) {
    _patchedApis.add(dashApi);
    var _origEnsure = dashApi.ensureCloudToken.bind(dashApi);
    dashApi.ensureCloudToken = function (req) {
      var dbName = _currentDbName;

      // Tier 1: Per-database ledger map
      var ledgerMap = (typeof window !== "undefined" && window.__VIBES_LEDGER_MAP__) || {};
      if (dbName && ledgerMap[dbName]) {
        req = Object.assign({}, req, { ledger: ledgerMap[dbName] });
        console.debug("[vibes] Using cached ledger for", dbName);
        return _origEnsure(req);
      }

      // Tier 2: Legacy global
      if (typeof window !== "undefined" && window.__VIBES_SHARED_LEDGER__) {
        req = Object.assign({}, req, { ledger: window.__VIBES_SHARED_LEDGER__ });
        console.debug("[vibes] Routing to shared ledger:", window.__VIBES_SHARED_LEDGER__);
        return _origEnsure(req);
      }

      // Tier 3: Discovery via listLedgersByUser
      return dashApi.listLedgersByUser({}).then(function (rLedgers) {
        if (rLedgers.isOk()) {
          var ledgers = rLedgers.Ok().ledgers || [];
          var appHost = typeof window !== "undefined" ? window.location.hostname : "";

          var matched = ledgers.find(function (l) {
            if (!l.name) return false;
            if (dbName && l.name.includes(dbName)) return true;
            if (appHost && l.name.includes(appHost)) return true;
            return false;
          });

          if (matched) {
            if (typeof window !== "undefined") {
              if (!window.__VIBES_LEDGER_MAP__) window.__VIBES_LEDGER_MAP__ = {};
              window.__VIBES_LEDGER_MAP__[dbName || appHost] = matched.ledgerId;
            }
            req = Object.assign({}, req, { ledger: matched.ledgerId });
            console.debug("[vibes] Discovered ledger:", matched.ledgerId, "for", dbName);
          } else {
            req = Object.assign({}, req, { ledger: undefined });
            console.debug("[vibes] No ledger match for", dbName, "-- creating new");
          }
        }
        return _origEnsure(req);
      }).catch(function (err) {
        console.warn("[vibes] Ledger discovery failed, falling back:", err && err.message);
        return _origEnsure(req);
      });
    };
  }

  _currentDbName = name;
  var result = _baseUseFireproof(name, opts);

  // Sync status bridge: use a simple state for tracking sync progress
  var syncVal = "idle";
  var syncErr = null;

  // Auto-redeem invite from ?invite=<id> URL param
  React.useEffect(function () {
    if (!dashApi) return;

    var params = new URLSearchParams(window.location.search);
    var inviteId = params.get("invite");
    if (inviteId) {
      console.debug("[vibes] Redeeming invite:", inviteId);
      dashApi.redeemInvite({ inviteId: inviteId }).then(function (rr) {
        if (rr.isOk()) {
          console.debug("[vibes] Invite redeemed, reloading");
          params.delete("invite");
          var newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
          window.history.replaceState({}, "", newUrl);
          window.location.reload();
        } else {
          console.warn("[vibes] redeemInvite failed:", rr.Err());
        }
      });
    }
  }, [dashApi]);

  // Sync status bridge
  React.useEffect(function () {
    var changed = window.__VIBES_SYNC_STATUS__ !== syncVal;
    var errChanged = window.__VIBES_SYNC_ERROR__ !== syncErr;
    if (changed || errChanged) {
      window.__VIBES_SYNC_STATUS__ = syncVal;
      window.__VIBES_SYNC_ERROR__ = syncErr;
      window.dispatchEvent(new CustomEvent("vibes-sync-status-change"));
    }
  }, [syncVal, syncErr]);

  return result;
}

// Backward-compat alias: templates may use useFireproofClerk
export { useFireproofOIDC as useFireproofClerk };

// Also export the hook under the standard name for import map consumers
export { _baseUseFireproof as useFireproof };
