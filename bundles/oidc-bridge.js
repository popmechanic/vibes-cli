/**
 * Vibes OIDC Bridge Module
 *
 * OIDC authentication bridge for Vibes apps.
 * Implements standard OIDC authorization code flow with PKCE using oauth4webapi.
 *
 * Provides:
 *   1. OIDCProvider — React context for auth state (token lifecycle, user info)
 *   2. SignedIn / SignedOut — Conditional rendering based on auth state
 *   3. SignInButton / UserButton — UI primitives for auth actions
 *   4. useUser() — Current user from OIDC id_token claims
 *   5. useOIDCContext() — Access to auth context (tokens, user, dashApi)
 *
 * Import map: "oauth4webapi" -> esm.sh
 */

import React from "react";
import * as oauth from "oauth4webapi";

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
    // Notify sync layer that token is now available
    window.dispatchEvent(new Event('vibes-oidc-ready'));
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

// Detect iframe/preview mode once at module level
var _isPreviewMode = false;
try { _isPreviewMode = window.self !== window.top; } catch (e) { _isPreviewMode = true; }

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
    // Persist joined state in sessionStorage so it survives the OIDC redirect chain
    // (query params in redirect_uri get stripped by some OIDC providers)
    if (window.__VIBES_JOINED__) {
      try { sessionStorage.setItem("vibes_joined", "true"); } catch (e) {}
    }
    var isJoined = window.__VIBES_JOINED__ ||
      (function () { try { return sessionStorage.getItem("vibes_joined") === "true"; } catch (e) { return false; } })();

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
    var auth = { type: "oidc", token: token };

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
  var config = window.__APP_CONFIG__ || window.__VIBES_CONFIG__ || {};
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

