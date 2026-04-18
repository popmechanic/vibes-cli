/**
 * Vibes AI Hook
 * Provides useAI() — a thin wrapper around the OpenRouter API.
 * Reads proxy URL from window.__APP_CONFIG__.aiProxyUrl.
 * Requires OIDC auth — token sourced from window.__VIBES_OIDC_TOKEN__.
 */

// --- Testable helpers (exported for unit tests) ---

/**
 * Build the OpenRouter request body from user options.
 * Destructures reserved props (messages, model, raw), spreads everything else.
 * @param {object} options - User-provided options
 * @param {object} [flags] - Internal flags (e.g. { stream: true })
 * @returns {object} Request body for OpenRouter
 */
export function buildRequestBody(options, flags) {
  const { messages, model, raw, ...apiParams } = options;
  return {
    model: model || "anthropic/claude-sonnet-4",
    messages,
    ...apiParams,
    ...(flags || {}),
  };
}

/**
 * Extract text content from an OpenRouter response.
 * @param {object} response - Parsed JSON response
 * @returns {string|null} The text content, or null if missing
 */
export function extractContent(response) {
  return response?.choices?.[0]?.message?.content ?? null;
}

/**
 * Map an HTTP error response to a structured error object.
 * @param {number} status - HTTP status code
 * @param {object} body - Parsed response body (may be empty)
 * @returns {{ code: string, message: string }}
 */
export function mapErrorResponse(status, body) {
  if (status === 401) {
    return { code: "UNAUTHORIZED", message: "Session expired — sign in again" };
  }
  if (status === 429) {
    return { code: "RATE_LIMITED", message: "Too many requests — try again shortly" };
  }
  const msg = body?.error?.message
    || (typeof body?.error === "string" ? body.error : null)
    || "AI service error: " + status;
  return { code: "API_ERROR", message: msg };
}

/**
 * Build URL + headers for an AI request based on factoryMode.
 * Returns: { url, headers }
 */
export function buildRequest(env) {
  if (env.factoryMode) {
    const slug = (typeof window !== "undefined")
      ? (window.location.pathname.replace(/^\//, "").split("/")[0] || "").trim()
      : "";
    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.token,
    };
    if (slug) headers["X-Instance-Slug"] = slug;
    return {
      url: env.factoryBase + "/ai/" + env.appName + "/chat",
      headers,
    };
  }
  return {
    url: env.proxyUrl + "/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.token,
    },
  };
}

/**
 * Side-effect handler for non-2xx responses.
 * Returns true if the response was handled (e.g. redirect issued); the caller
 * should NOT proceed to read the body. Returns false for legacy fall-through.
 */
export function handleNotOk(response, env) {
  if (env.factoryMode && response.status === 403 && typeof window !== "undefined") {
    window.location.href = env.factoryBase + "/checkout/" + env.appName;
    return true;
  }
  return false;
}

// --- SSE Parser (inlined from sse-parser.js for browser bundle) ---

async function* parseSSEStream(reader) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]") return;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }

  if (buffer.trim() && buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
    try {
      const json = JSON.parse(buffer.trim().slice(6));
      const content = json.choices?.[0]?.delta?.content;
      if (content) yield content;
    } catch {
      // Skip
    }
  }
}

// --- React Hook (module scope — no IIFE needed, loaded as type="module") ---

const React = typeof window !== "undefined" ? window.React : undefined;

if (React) {
  /**
   * Check if AI proxy and auth token are available.
   * Returns { proxyUrl, token, factoryMode, appName, factoryBase } on success,
   * or { error, message } on failure.
   */
  function checkReady() {
    const config = window.__APP_CONFIG__ || {};
    const proxyUrl = config.aiProxyUrl;
    if (!proxyUrl) return { error: "NOT_CONFIGURED", message: "This app was not deployed with AI enabled. Redeploy with the 'Use AI' option to use AI features." };
    const token = window.__VIBES_OIDC_TOKEN__;
    if (!token) return { error: "NOT_AUTHENTICATED", message: "Waiting for sign-in — AI will be available after you log in." };
    return {
      proxyUrl,
      token,
      factoryMode: !!config.factoryMode,
      appName: config.appName || "app",
      factoryBase: config.factoryBase || "https://factory.vibesos.com",
    };
  }

  function useAI() {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [isReady, setIsReady] = React.useState(function () { const r = checkReady(); return !!(r && r.proxyUrl); });

    // Listen for OIDC token availability
    React.useEffect(function () {
      function onReady() { const r = checkReady(); setIsReady(!!(r && r.proxyUrl)); }
      window.addEventListener('vibes-oidc-ready', onReady);
      // Re-check in case token arrived before this effect ran
      onReady();
      return function () { window.removeEventListener('vibes-oidc-ready', onReady); };
    }, []);

    const callAI = React.useCallback(async (options) => {
      const env = checkReady();
      if (env.error) {
        setError({ code: env.error, message: env.message });
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const body = buildRequestBody(options);
        const req = buildRequest(env);
        const response = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          if (handleNotOk(response, env)) return null;
          const errData = await response.json().catch(() => ({}));
          setError(mapErrorResponse(response.status, errData));
          return null;
        }

        const data = await response.json();
        return options.raw ? data : extractContent(data);
      } catch (err) {
        setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
        return null;
      } finally {
        setLoading(false);
      }
    }, []);

    const streamAI = React.useCallback((options) => {
      const env = checkReady();
      if (env.error) {
        setError({ code: env.error, message: env.message });
        return null;
      }

      setLoading(true);
      setError(null);

      const body = buildRequestBody(options, { stream: true });

      async function* generate() {
        try {
          const req = buildRequest(env);
          const response = await fetch(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            if (handleNotOk(response, env)) return;
            const errData = await response.json().catch(() => ({}));
            setError(mapErrorResponse(response.status, errData));
            return;
          }

          const reader = response.body.getReader();
          for await (const chunk of parseSSEStream(reader)) {
            yield chunk;
          }
        } catch (err) {
          setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
        } finally {
          setLoading(false);
        }
      }

      return generate();
    }, []);

    const clearError = React.useCallback(function () { setError(null); }, []);

    return { callAI, streamAI, loading, error, clearError, isReady };
  }

  window.useAI = useAI;
} else {
  console.warn("[vibes-ai] React not found on window, useAI unavailable");
}
