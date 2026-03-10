/**
 * Vibes AI Hook
 * Provides useAI() for streaming AI responses from the Vibes AI proxy.
 * Reads proxy URL from window.__VIBES_CONFIG__.aiProxyUrl.
 * Requires OIDC auth — token sourced from window.__VIBES_OIDC_TOKEN__.
 */

(function () {
  const React = window.React;
  if (!React) {
    console.warn("[vibes-ai] React not found on window, useAI unavailable");
    return;
  }

  /**
   * Parse an SSE stream from OpenRouter.
   * Yields content deltas as strings. Handles chunks split across reads.
   */
  async function* parseSSEStream(reader) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last partial line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // empty or comment
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

    // Process any remaining buffer
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

  function useAI() {
    const [answer, setAnswer] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const ask = React.useCallback(async (options) => {
      const config = window.__VIBES_CONFIG__ || {};
      const proxyUrl = config.aiProxyUrl;
      if (!proxyUrl) {
        setError({ code: "NOT_CONFIGURED", message: "AI proxy not configured" });
        return;
      }

      const token = window.__VIBES_OIDC_TOKEN__;
      if (!token) {
        setError({ code: "AUTH_REQUIRED", message: "Sign in to use AI features" });
        return;
      }

      setLoading(true);
      setError(null);
      setAnswer("");

      try {
        const response = await fetch(proxyUrl + "/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
          },
          body: JSON.stringify({
            model: options.model || "anthropic/claude-sonnet-4.6",
            messages: options.messages,
            stream: true,
            ...options.params,
          }),
        });

        if (response.status === 401) {
          setError({ code: "UNAUTHORIZED", message: "Session expired — sign in again" });
          setLoading(false);
          return;
        }

        if (response.status === 429) {
          setError({ code: "RATE_LIMITED", message: "Too many requests — try again shortly" });
          setLoading(false);
          return;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          setError({
            code: "API_ERROR",
            message: errData.error?.message || errData.error || "AI service error: " + response.status,
          });
          setLoading(false);
          return;
        }

        // Stream SSE response
        const reader = response.body.getReader();
        let accumulated = "";

        for await (const chunk of parseSSEStream(reader)) {
          accumulated += chunk;
          setAnswer(accumulated);
        }
      } catch (err) {
        setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
      } finally {
        setLoading(false);
      }
    }, []);

    return { ask, answer, loading, error };
  }

  // Also expose the non-streaming callAI for backward compat
  function useAICompat() {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const callAI = React.useCallback(async (options) => {
      const config = window.__VIBES_CONFIG__ || {};
      const proxyUrl = config.aiProxyUrl;
      if (!proxyUrl) throw new Error("AI proxy not configured");

      const token = window.__VIBES_OIDC_TOKEN__;
      setLoading(true);
      setError(null);

      try {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = "Bearer " + token;

        const response = await fetch(proxyUrl + "/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: options.model || "anthropic/claude-sonnet-4.6",
            messages: options.messages,
            ...options,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const err = { code: "API_ERROR", message: errData.error?.message || "API error: " + response.status };
          setError(err);
          throw err;
        }

        return await response.json();
      } catch (err) {
        if (!error) setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
        throw err;
      } finally {
        setLoading(false);
      }
    }, []);

    return { callAI, loading, error, clearError: function () { setError(null); } };
  }

  window.useAI = useAI;
  window.useAICompat = useAICompat;
})();
