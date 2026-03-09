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

// Import base Fireproof (local-only) — used internally by useFireproofOIDC
import { useFireproof as _baseUseFireproof, toCloud as _toCloud } from "@fireproof/core";

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
  var client = { client_id: clientId };
  var codeVerifier = oauth.generateRandomCodeVerifier();
  var codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  var state = oauth.generateRandomState();

  // Store verifier and state for callback
  try {
    sessionStorage.setItem(STORAGE_KEY_VERIFIER, codeVerifier);
    sessionStorage.setItem("vibes_oidc_state", state);
  } catch (e) {}

  var authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  window.location.href = authUrl.toString();
}

async function handleCallback(authority, clientId, redirectUri) {
  var params = new URLSearchParams(window.location.search);
  var code = params.get("code");
  if (!code) return null;

  var codeVerifier;
  var expectedState;
  try {
    codeVerifier = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
    expectedState = sessionStorage.getItem("vibes_oidc_state");
  } catch (e) {}
  if (!codeVerifier) {
    console.error("[vibes-oidc] No code verifier found for callback");
    return null;
  }

  try {
    var as = await discoverIssuer(authority);
    var client = { client_id: clientId };
    var clientAuth = oauth.None();

    // Validate the authorization response (required by oauth4webapi before token exchange)
    var currentUrl = new URL(window.location.href);
    var callbackParams = oauth.validateAuthResponse(as, client, currentUrl, expectedState || oauth.skipStateCheck);

    var response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuth,
      callbackParams,
      redirectUri,
      codeVerifier
    );

    var result = await oauth.processAuthorizationCodeResponse(as, client, response);

    var tokens = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || null,
      idToken: result.id_token || null,
      expiresIn: result.expires_in || 3600
    };

    storeTokens(tokens.accessToken, tokens.refreshToken, tokens.idToken, tokens.expiresIn);

    // Clean up session storage
    try {
      sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
      sessionStorage.removeItem("vibes_oidc_state");
    } catch (e) {}

    // Clean up URL — remove code, state, and iss params
    params.delete("code");
    params.delete("state");
    params.delete("iss");
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
    var client = { client_id: clientId };
    var clientAuth = oauth.None();

    var response = await oauth.refreshTokenGrantRequest(as, client, clientAuth, stored.refreshToken);
    var result = await oauth.processRefreshTokenResponse(as, client, response);

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

  // Synchronous iframe detection — must resolve BEFORE first render so
  // SignedIn/SignedOut never flash the wrong state in editor preview.
  // Uses module-level _isPreviewMode (computed once at load time).
  var _initialState = _isPreviewMode
    ? { isLoading: false, isSignedIn: true, user: { firstName: "Preview", lastName: "User", email: "preview@localhost", id: "preview-user" }, accessToken: "preview-mode-token" }
    : { isLoading: true, isSignedIn: false, user: null, accessToken: null };

  var _s = React.useState(_initialState);
  var authState = _s[0];
  var setAuthState = _s[1];

  React.useEffect(function () {
    // In preview/iframe mode, auth is already set synchronously — skip OIDC flow
    if (_isPreviewMode) return;

    var cancelled = false;
    var redirectUri = window.location.origin + window.location.pathname;

    async function init() {
      // Step 0: Check for OTA (one-time-access-token) from invite link
      var params = new URLSearchParams(window.location.search);
      if (params.has("ota")) {
        var otaToken = params.get("ota");
        try {
          // Exchange OTA token with Pocket ID — this sets up the user's session
          var otaRes = await fetch(authority + "/api/one-time-access-token/" + encodeURIComponent(otaToken), {
            method: "POST",
            headers: { "Accept": "application/json" }
          });
          if (otaRes.ok) {
            console.debug("[vibes-oidc] OTA token redeemed, starting login flow");
          } else {
            console.warn("[vibes-oidc] OTA token redemption failed:", otaRes.status);
          }
        } catch (otaErr) {
          console.warn("[vibes-oidc] OTA token exchange error:", otaErr);
        }
        // Clean the OTA param from URL regardless of outcome
        params.delete("ota");
        var cleanOtaUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
        window.history.replaceState({}, "", cleanOtaUrl);
        // After OTA redemption, start normal OIDC login to get tokens
        startLogin(authority, clientId, redirectUri);
        return;
      }

      // Step 1: Check for callback code
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

  // Build dashApi-compatible interface matching upstream DashboardApiImpl protocol.
  // All requests use PUT to a single /api endpoint, with auth in the body.
  var dashApi = React.useMemo(function () {
    if (!authState.accessToken || !config.apiUrl) return null;
    var apiUrl = config.apiUrl.replace(/\/$/, "");
    // Use the ID token for dashApi calls — it contains user identity claims
    // (email, name, etc.) needed by the dashboard's claim mapping.
    // Fall back to access token if no ID token is available.
    var idToken = sessionStorage.getItem(STORAGE_KEY_ID);
    var token = idToken || authState.accessToken;
    var auth = { type: "clerk", token: token };

    function _dashRequest(body) {
      return fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(Object.assign({}, body, { auth: auth }))
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error("HTTP " + r.status + ": " + t); });
        return r.json();
      });
    }

    function _wrapResult(promise) {
      return promise.then(function (data) {
        return { isOk: function () { return true; }, Ok: function () { return data; }, isErr: function () { return false; } };
      }).catch(function (err) {
        return { isOk: function () { return false; }, isErr: function () { return true; }, Err: function () { return err; } };
      });
    }

    return {
      ensureUser: function (req) {
        return _wrapResult(_dashRequest(Object.assign({ type: "reqEnsureUser" }, req)));
      },
      ensureCloudToken: function (req) {
        return _dashRequest(Object.assign({ type: "reqEnsureCloudToken" }, req));
      },
      listLedgersByUser: function (req) {
        return _wrapResult(_dashRequest(Object.assign({ type: "reqListLedgersByUser" }, req)));
      },
      inviteUser: function (opts) {
        return _wrapResult(_dashRequest(Object.assign({ type: "reqInviteUser" }, opts)));
      },
      redeemInvite: function (opts) {
        return _wrapResult(_dashRequest(Object.assign({ type: "reqRedeemInvite" }, opts)));
      },
      findUser: function (opts) {
        return _wrapResult(_dashRequest(Object.assign({ type: "reqFindUser" }, opts)));
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
  var _s = React.useState(false);
  var isLoading = _s[0];
  var setIsLoading = _s[1];

  function handleClick() {
    if (isLoading) return;
    var authority = config.oidcAuthority;
    var clientId = config.oidcClientId;
    if (!authority || !clientId) {
      console.error("[vibes-oidc] Missing oidcAuthority or oidcClientId in config");
      return;
    }
    setIsLoading(true);
    startLogin(authority, clientId, window.location.origin + window.location.pathname)
      .catch(function (err) {
        console.error("[vibes-oidc] Login failed:", err);
        setIsLoading(false);
      });
  }

  // If children are provided (e.g., wrapping a button), clone with onClick + disabled state
  if (props.children) {
    return React.cloneElement(
      React.Children.only(props.children),
      {
        onClick: handleClick,
        disabled: isLoading,
        children: isLoading ? "Connecting…" : props.children.props.children
      }
    );
  }

  // Default button
  return React.createElement(
    "button",
    { onClick: handleClick, disabled: isLoading },
    isLoading ? "Connecting…" : "Sign In"
  );
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

// Detect iframe/preview mode once at module level
var _isPreviewMode = false;
try { _isPreviewMode = window.self !== window.top; } catch (e) { _isPreviewMode = true; }

// ─── Cloud Sync Constants ───────────────────────────────────────────────
var SYNC_POLL_INTERVAL_MS = 2000;
var SYNC_STABLE_THRESHOLD = 3;
var SYNC_POLL_MAX_MS = 20000;
var MAX_RETRY_COUNT = 8;
var BASE_RETRY_DELAY_MS = 2000;
var MAX_RETRY_DELAY_MS = 30000;

// ─── OIDCTokenStrategy ─────────────────────────────────────────────────
// Implements Fireproof's TokenStrategy interface using OIDC-authenticated
// dashboard API calls.

function _decodeJwtPayload(jwt) {
  try {
    var parts = jwt.split(".");
    if (parts.length !== 3) return {};
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch (e) { return {}; }
}

function OIDCTokenStrategy(dashApi, apiUrl) {
  this._dashApi = dashApi;
  this._apiUrl = apiUrl;
  this._lastExpiryMs = null;
  this._resolvedLedgerId = null;
}

OIDCTokenStrategy.prototype.hash = function () { return this._apiUrl; };
OIDCTokenStrategy.prototype.open = function () {};
OIDCTokenStrategy.prototype.stop = function () {};
OIDCTokenStrategy.prototype.tryToken = function () { return Promise.resolve(undefined); };

OIDCTokenStrategy.prototype.getLastTokenExpiry = function () { return this._lastExpiryMs; };
OIDCTokenStrategy.prototype.getLedgerId = function () { return this._resolvedLedgerId; };

OIDCTokenStrategy.prototype.waitForToken = function (_sthis, _logger, _deviceId, opts) {
  var self = this;
  var appId = (opts && opts.context && typeof opts.context.get === "function"
    ? opts.context.get("appId") : null)
    || ("oidc-" + (typeof window !== "undefined" ? window.location.host : "app") + "-" + _deviceId);

  // Ensure user exists in dashboard database first (required before any other API calls)
  return self._dashApi.ensureUser({}).then(function (rUser) {
    if (rUser.isErr()) {
      console.error("[vibes-oidc] ensureUser failed:", rUser.Err());
      return undefined;
    }

    // 3-tier ledger routing
    var dbName = _currentDbName;
    var ledgerParam;
    var ledgerMap = (typeof window !== "undefined" && window.__VIBES_LEDGER_MAP__) || {};
    if (dbName && ledgerMap[dbName]) {
      ledgerParam = ledgerMap[dbName];
    } else if (typeof window !== "undefined" && window.__VIBES_SHARED_LEDGER__) {
      ledgerParam = window.__VIBES_SHARED_LEDGER__;
    }

    // If no cached ledger, try discovery
    var discoveryPromise = ledgerParam
      ? Promise.resolve(ledgerParam)
      : self._dashApi.listLedgersByUser({}).then(function (rLedgers) {
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
              console.debug("[vibes] Discovered ledger:", matched.ledgerId);
              return matched.ledgerId;
            }
          }
          return undefined;
        }).catch(function () { return undefined; });

    return discoveryPromise.then(function (resolvedLedger) {
      return self._dashApi.ensureCloudToken({ appId: appId, ledger: resolvedLedger });
    });
  }).then(function (res) {
    if (!res || !res.cloudToken) {
      if (res === undefined) return undefined; // ensureUser failed
      console.error("[vibes-oidc] ensureCloudToken returned no token:", res);
      return undefined;
    }

    // Parse claims from the cloud JWT
    var claims = _decodeJwtPayload(res.cloudToken);

    if (res.expiresDate) {
      self._lastExpiryMs = new Date(res.expiresDate).getTime();
    }
    if (res.ledger) {
      self._resolvedLedgerId = res.ledger;
    }

    console.debug("[vibes-oidc] Got cloud token, ledger:", res.ledger);
    return { token: res.cloudToken, claims: claims };
  }).catch(function (err) {
    console.error("[vibes-oidc] waitForToken failed:", err);
    return undefined;
  });
};

// ─── useFireproofOIDC (with cloud sync) ──────────────────────────────────

export function useFireproofOIDC(name, opts) {
  // In preview mode, prefix DB name so preview data stays isolated from production
  var effectiveName = _isPreviewMode ? "preview-" + (name || "app") : name;

  var ctx = React.useContext(OIDCContext);
  var dashApi = ctx && ctx.dashApi;
  var config = (typeof window !== "undefined" && window.__VIBES_CONFIG__) || {};

  _currentDbName = effectiveName;
  var fpResult = _baseUseFireproof(effectiveName, opts);
  var database = fpResult.database;

  // Cloud sync state
  var _syncState = React.useState("idle");
  var syncStatus = _syncState[0];
  var setSyncStatus = _syncState[1];

  var _errState = React.useState(null);
  var lastSyncError = _errState[0];
  var setLastSyncError = _errState[1];

  var _attachState = React.useState("detached");
  var attachStatus = _attachState[0];
  var setAttachStatus = _attachState[1];

  var attachedRef = React.useRef(null);
  var strategyRef = React.useRef(null);
  var retryCountRef = React.useRef(0);
  var attachingRef = React.useRef(false);

  // Auto-attach cloud when dashApi becomes available (user signs in)
  React.useEffect(function () {
    // Skip cloud attach in preview/iframe mode
    if (_isPreviewMode) return;
    if (!dashApi || !config.cloudBackendUrl || attachingRef.current) return;
    if (attachStatus !== "detached") return;
    attachingRef.current = true;
    setSyncStatus("connecting");
    setAttachStatus("attaching");

    var strategy = new OIDCTokenStrategy(dashApi, config.tokenApiUri || "");
    strategyRef.current = strategy;

    var appId = "oidc-" + (typeof window !== "undefined" ? window.location.host : "app") + "-" + effectiveName;

    try {
      database.ledger.ctx.set("appId", appId);
    } catch (e) {
      console.debug("[vibes-oidc] Could not set appId on ledger ctx:", e);
    }

    var cloud = _toCloud({
      strategy: strategy,
      urls: { base: config.cloudBackendUrl }
    });

    database.attach(cloud).then(function (attached) {
      attachedRef.current = attached;
      retryCountRef.current = 0;
      setAttachStatus("attached");
      setSyncStatus("synced");
      setLastSyncError(null);
      console.debug("[vibes-oidc] Cloud attached, ledger:", strategy.getLedgerId());
    }).catch(function (err) {
      console.error("[vibes-oidc] Cloud attach failed:", err);
      setAttachStatus("error");
      setSyncStatus("error");
      setLastSyncError(err instanceof Error ? err : new Error(String(err)));
    }).finally(function () {
      attachingRef.current = false;
    });

    return function () {
      // Detach on cleanup
      if (attachedRef.current && typeof attachedRef.current.detach === "function") {
        attachedRef.current.detach().catch(function () {});
        attachedRef.current = null;
      }
    };
  }, [dashApi, config.cloudBackendUrl, effectiveName, attachStatus]);

  // Error recovery with exponential backoff
  React.useEffect(function () {
    if (attachStatus !== "error" || !dashApi) return;
    if (retryCountRef.current >= MAX_RETRY_COUNT) return;

    var delay = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current),
      MAX_RETRY_DELAY_MS
    );
    retryCountRef.current += 1;
    console.debug("[vibes-oidc] Retry " + retryCountRef.current + "/" + MAX_RETRY_COUNT + " in " + delay + "ms");

    var timer = setTimeout(function () {
      setAttachStatus("detached");
      setSyncStatus("idle");
    }, delay);
    return function () { clearTimeout(timer); };
  }, [attachStatus, dashApi]);

  // Tab visibility: reset retry budget when user returns
  React.useEffect(function () {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      if (attachStatus === "error") {
        retryCountRef.current = 0;
        setAttachStatus("detached");
        setSyncStatus("idle");
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return function () { document.removeEventListener("visibilitychange", handleVisibility); };
  }, [attachStatus]);

  // Sync polling: kick CRDT to process sync data after attach
  // (Workaround: database.attach resolves on WebSocket connect, but historical
  // data streams in asynchronously. allDocs() forces CRDT processing.)
  React.useEffect(function () {
    if (attachStatus !== "attached") return;
    var stopped = false;
    var lastCount = -1;
    var stableRuns = 0;

    function poll() {
      if (stopped) return;
      database.allDocs().then(function (res) {
        if (stopped) return;
        var count = res.rows.length;
        if (count === lastCount) {
          stableRuns++;
          if (stableRuns >= SYNC_STABLE_THRESHOLD) {
            console.debug("[vibes-oidc] Initial sync settled");
            stopped = true;
            // Kick useLiveQuery subscriptions — Fireproof's fast-forward path
            // sets clock.head without firing onTock, so useLiveQuery never
            // re-renders on a second device without this manual kick.
            try {
              database.ledger.crdt.clock.noPayloadWatchers.forEach(function(fn) { fn(); });
              console.debug("[vibes-oidc] Kicked onTock after sync settled,", count, "docs");
            } catch (e) {
              console.debug("[vibes-oidc] onTock kick failed:", e);
            }
            return;
          }
        } else {
          stableRuns = 0;
        }
        lastCount = count;
        if (!stopped) setTimeout(poll, SYNC_POLL_INTERVAL_MS);
      }).catch(function () {
        if (!stopped) setTimeout(poll, SYNC_POLL_INTERVAL_MS);
      });
    }

    var startTimer = setTimeout(poll, SYNC_POLL_INTERVAL_MS);
    var maxTimer = setTimeout(function () { stopped = true; }, SYNC_POLL_MAX_MS);

    return function () {
      stopped = true;
      clearTimeout(startTimer);
      clearTimeout(maxTimer);
    };
  }, [attachStatus, database]);

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

  // Sync status bridge: forward to window global for SyncStatusDot
  React.useEffect(function () {
    var changed = window.__VIBES_SYNC_STATUS__ !== syncStatus;
    var errChanged = window.__VIBES_SYNC_ERROR__ !== (lastSyncError ? String(lastSyncError) : null);
    if (changed || errChanged) {
      window.__VIBES_SYNC_STATUS__ = syncStatus;
      window.__VIBES_SYNC_ERROR__ = lastSyncError ? String(lastSyncError) : null;
      window.dispatchEvent(new CustomEvent("vibes-sync-status-change"));
    }
  }, [syncStatus, lastSyncError]);

  return Object.assign({}, fpResult, {
    syncStatus: syncStatus,
    isSyncing: attachStatus === "attached",
    lastSyncError: lastSyncError
  });
}

// Backward-compat alias: templates may use useFireproofClerk
export { useFireproofOIDC as useFireproofClerk };

// Export OIDC-enhanced hook as useFireproof so all apps get cloud sync automatically.
// When no OIDCProvider is present (local-only mode), dashApi is null and cloud attach
// is gracefully skipped — behaves identically to the base useFireproof.
export { useFireproofOIDC as useFireproof };
