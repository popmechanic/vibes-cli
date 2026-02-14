const { useState, useEffect, useRef } = React;

// ── Status dot colors (OKLCH for perceptual uniformity) ──
const STATUS_COLORS = {
  idle:          "oklch(0.65 0.12 250)",   // blue-slate
  connecting:    "oklch(0.75 0.16 85)",    // amber
  synced:        "oklch(0.72 0.19 145)",   // vivid green
  reconnecting:  "oklch(0.75 0.16 85)",    // amber
  error:         "oklch(0.62 0.22 25)",    // red
};

const STATUS_LABELS = {
  idle:          "Idle",
  connecting:    "Connecting…",
  synced:        "Synced",
  reconnecting:  "Reconnecting…",
  error:         "Error",
};

// ── AI Proxy status ──
const AI_STATUS_COLORS = {
  unconfigured:  "oklch(0.55 0.0 0)",      // gray — can't reach server
  checking:      "oklch(0.75 0.16 85)",    // amber — probing
  not_deployed:  "oklch(0.75 0.16 85)",    // amber — endpoint exists but not configured
  available:     "oklch(0.72 0.19 145)",   // green
  error:         "oklch(0.62 0.22 25)",    // red — deployed but broken
};

const AI_STATUS_LABELS = {
  unconfigured:  "Not Configured",
  checking:      "Checking…",
  not_deployed:  "Not Deployed",
  available:     "Available",
  error:         "Error",
};

// ── Neobrute keyframes (injected once) ──
const KEYFRAMES = `
@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.35); opacity: 0.7; }
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

// ── Graph-paper background (Neobrute Blueprint) ──
const GRAPH_BG = {
  backgroundColor: "#f1f5f9",
  backgroundImage: [
    "repeating-linear-gradient(0deg, transparent, transparent 23px, #cbd5e1 23px, #cbd5e1 24px)",
    "repeating-linear-gradient(90deg, transparent, transparent 23px, #cbd5e1 23px, #cbd5e1 24px)",
  ].join(", "),
  backgroundSize: "24px 24px",
};

// ── Panel shell ──
function Panel({ title, children, style }) {
  return (
    <div style={{
      background: "#ffffff",
      border: "4px solid #0f172a",
      boxShadow: "6px 6px 0 #0f172a",
      animation: "slide-up 0.4s ease-out both",
      ...style,
    }}>
      <div style={{
        background: "#0f172a",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        <span style={{
          color: "#ffffff",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}>{title}</span>
      </div>
      <div style={{ padding: "20px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Badge ──
function Badge({ label, value, color }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      background: color || "#f1f5f9",
      border: "2px solid #0f172a",
      borderRadius: "9999px",
      padding: "2px 12px",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "12px",
      fontWeight: 600,
      color: "#0f172a",
    }}>
      {label && <span style={{ color: "#64748b" }}>{label}</span>}
      {value}
    </span>
  );
}

// ── Diagnostic check row ──
function Check({ label, ok }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "6px 0",
    }}>
      <span style={{
        width: 20,
        height: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: ok ? "oklch(0.72 0.19 145)" : "oklch(0.62 0.22 25)",
        border: "2px solid #0f172a",
        borderRadius: "9999px",
        fontSize: "11px",
        fontWeight: 700,
        color: "#0f172a",
      }}>{ok ? "✓" : "✗"}</span>
      <span style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "13px",
        color: "#0f172a",
      }}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Main App — adaptive: useTenant() in sell template, fallback in vibes
// ═══════════════════════════════════════════════
export default function App() {
  const _tenant = typeof useTenant === "function"
    ? useTenant()
    : { dbName: "diagnostics-db", subdomain: null };
  const { dbName, subdomain } = _tenant;
  const {
    database, useLiveQuery, useDocument,
    syncStatus, isSyncing, lastSyncError,
  } = useFireproofClerk(dbName);
  const { user } = useUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress || null;
  const [text, setText] = useState("");
  const [ledgerId, setLedgerId] = useState(window.__VIBES_SHARED_LEDGER__ || null);
  const { docs } = useLiveQuery("type", { key: "note" });

  // Poll for ledger ID (set async by UnifiedAccessGate after /resolve)
  useEffect(() => {
    const id = setInterval(() => {
      if (window.__VIBES_SHARED_LEDGER__ && window.__VIBES_SHARED_LEDGER__ !== ledgerId) {
        setLedgerId(window.__VIBES_SHARED_LEDGER__);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [ledgerId]);

  // Uptime timer
  const [uptime, setUptime] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setUptime(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  // ── AI Proxy state ──
  const [aiStatus, setAiStatus] = useState("checking");
  const [aiError, setAiError] = useState(null);
  const [vibeResult, setVibeResult] = useState(null);
  const [vibeLoading, setVibeLoading] = useState(false);

  // Probe AI proxy on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        });
        if (cancelled) return;
        if (res.ok) {
          setAiStatus("available");
        } else if (res.status === 501) {
          setAiStatus("not_deployed");
        } else {
          setAiStatus("error");
          setAiError(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (cancelled) return;
        setAiStatus("unconfigured");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Normalize (hook always returns a string, but guard against undefined)
  const status = syncStatus || "idle";
  const syncing = isSyncing ?? false;
  const syncError = lastSyncError ?? null;
  const connectUrl = window.__VIBES_CONFIG__?.cloudBackendUrl || null;

  // Diagnostics
  const reactOk = typeof React.useState === "function";
  const queryOk = Array.isArray(docs);
  const integrityOk = docs.every((d) => typeof d.ts === "number" && d.ts > 0);
  const syncOk = Object.keys(STATUS_COLORS).includes(status);
  const aiOk = aiStatus === "available";

  // Vibe Check function
  const checkVibes = async () => {
    setVibeLoading(true);
    setVibeResult(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [{
            role: "user",
            content: `You are a terse systems analyst. Analyze the diagnostics below. Format in exactly 3 lines:
- Line 1: A short status heading (e.g., "NOMINAL", "DEGRADED", "CRITICAL")
- Line 2: A 1-2 sentence observation about the system state. Reference specific diagnostics.
- Line 3: A recommendation.

Diagnostics:${subdomain ? `\n- Tenant: ${subdomain}` : ""}
- Database: ${dbName}
- Sync: ${status}
- Documents stored: ${docs.length}
- Uptime: ${fmtTime(uptime)}
- Errors: ${syncError ? String(syncError) : "none"}`
          }],
          max_tokens: 150,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.message?.content || "";
      const lines = content.trim().split("\n").filter(Boolean);
      setVibeResult({
        vibe: (lines[0] || "NOMINAL").replace(/[*"]/g, ""),
        reading: (lines[1] || "System is operating within expected parameters.").replace(/[*"]/g, ""),
        fortune: (lines[2] || "Continue monitoring.").replace(/[*"]/g, ""),
      });
    } catch (err) {
      setVibeResult({
        vibe: "ERROR",
        reading: err.message,
        fortune: "Check AI proxy deployment.",
      });
    } finally {
      setVibeLoading(false);
    }
  };

  const isPulsing = status === "connecting" || status === "reconnecting";

  const syncColor = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const syncLabel = {
    idle: '', connecting: 'connecting', synced: 'synced',
    reconnecting: 'reconnecting', error: 'offline',
  }[status] || '';
  const showBar = status !== 'idle';

  return (
    <>
      <style>{KEYFRAMES}{`
        /* Hide the base template SyncStatusDot — this fixture renders its own */
        [title^="Sync:"] { display: none !important; }
      `}</style>

      <div style={{
        ...GRAPH_BG,
        minHeight: "100vh",
        fontFamily: "'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace",
        color: "#0f172a",
      }}>
        {/* ── Header ── */}
        <header style={{
          background: "#0f172a",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          borderBottom: "4px solid #0f172a",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}>VIBES CHECK</span>
            <span style={{
              color: "#94a3b8",
              fontSize: "12px",
              fontWeight: 400,
            }}>{subdomain ? `${subdomain} \u00b7 ${dbName}` : dbName}</span>
          </div>

          {/* ── Status pill (inside sticky header) ── */}
          {showBar && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              background: "rgba(255, 255, 255, 0.12)",
              borderRadius: 100,
              border: "1px solid rgba(255,255,255,0.1)",
              fontFamily: "'IBM Plex Mono', 'SF Mono', monospace",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "0.01em",
              userSelect: "none",
            }}>
              {/* docs */}
              <span style={{ padding: "6px 12px", color: "#94a3b8", display: "flex", gap: 4 }}>
                <span>docs</span>
                <span style={{ color: "#ffffff" }}>{docs.length}</span>
              </span>
              <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
              {/* uptime */}
              <span style={{ padding: "6px 12px", color: "#94a3b8", display: "flex", gap: 4 }}>
                <span>up</span>
                <span style={{ color: "#ffffff" }}>{fmtTime(uptime)}</span>
              </span>
              <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
              {/* sync */}
              <span style={{ padding: "6px 12px 6px 10px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ position: "relative", width: 8, height: 8 }}>
                  {status === "synced" && (
                    <span style={{
                      position: "absolute", top: "50%", left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "100%", height: "100%", borderRadius: "50%",
                      background: syncColor,
                      animation: "vibes-sync-pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1)",
                    }} />
                  )}
                  <span style={{
                    position: "relative", display: "block",
                    width: 8, height: 8, borderRadius: "50%",
                    background: syncColor,
                    transition: "background-color 0.4s ease",
                  }} />
                </span>
                {syncLabel && <span style={{ color: "#ffffff" }}>{syncLabel}</span>}
              </span>
            </div>
          )}
        </header>

        {/* ── Main grid ── */}
        <main style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "24px",
          padding: "24px",
          maxWidth: "960px",
          margin: "0 auto",
        }}>
          {/* ── Sync Status Panel ── */}
          <Panel title="SYNC STATUS" style={{ animationDelay: "0.05s" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Status dot + label */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "9999px",
                  background: STATUS_COLORS[status] || STATUS_COLORS.idle,
                  border: "3px solid #0f172a",
                  animation: isPulsing ? "pulse-dot 1.4s ease-in-out infinite" : "none",
                  flexShrink: 0,
                }} />
                <div>
                  <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.1 }}>
                    {STATUS_LABELS[status] || status}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    syncStatus: "{status}"
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "6px 16px",
                fontSize: "13px",
              }}>
                <span style={{ color: "#64748b" }}>user</span>
                <span style={{ fontWeight: 600 }}>{userEmail || "not signed in"}</span>
                <span style={{ color: "#64748b" }}>database</span>
                <span style={{ fontWeight: 600 }}>{dbName}</span>
                <span style={{ color: "#64748b" }}>ledger</span>
                <span style={{ fontWeight: 600, fontSize: "12px", wordBreak: "break-all" }}>
                  {ledgerId || "default (no shared ledger)"}
                </span>
                <span style={{ color: "#64748b" }}>isSyncing</span>
                <span style={{ fontWeight: 600 }}>{String(syncing)}</span>
                <span style={{ color: "#64748b" }}>lastSyncError</span>
                <span style={{
                  fontWeight: 600,
                  color: syncError ? "oklch(0.62 0.22 25)" : "#0f172a",
                  wordBreak: "break-all",
                }}>
                  {syncError ? String(syncError) : "none"}
                </span>
                <span style={{ color: "#64748b" }}>connectUrl</span>
                <span style={{
                  fontWeight: 600,
                  wordBreak: "break-all",
                  fontSize: "12px",
                }}>
                  {connectUrl || "not configured"}
                </span>
              </div>

              {/* Legend */}
              <div style={{
                borderTop: "2px solid #e2e8f0",
                paddingTop: "14px",
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
              }}>
                {Object.entries(STATUS_COLORS).map(([key, color]) => (
                  <div key={key} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "11px",
                    opacity: status === key ? 1 : 0.5,
                  }}>
                    <span style={{
                      width: 10,
                      height: 10,
                      borderRadius: "9999px",
                      background: color,
                      border: "1.5px solid #0f172a",
                      display: "inline-block",
                    }} />
                    {key}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {/* ── CRUD Test Panel ── */}
          <Panel title="TEST CHAT" style={{ animationDelay: "0.1s" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Input form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  const username = userEmail ? userEmail.split("@")[0] : "anonymous";
                  database.put({ text, type: "note", ts: Date.now(), author: username });
                  setText("");
                }}
                style={{ display: "flex", gap: "8px" }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type something…"
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    border: "3px solid #0f172a",
                    background: "#ffffff",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    outline: "none",
                  }}
                />
                <button type="submit" style={{
                  padding: "10px 20px",
                  background: "#0f172a",
                  color: "#ffffff",
                  border: "3px solid #0f172a",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}>Save</button>
              </form>

              {/* Doc list */}
              <div style={{
                maxHeight: "260px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}>
                {docs.length === 0 && (
                  <div style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: "13px",
                    border: "2px dashed #cbd5e1",
                  }}>
                    No documents yet. Save one above.
                  </div>
                )}
                {[...docs].sort((a, b) => (b.ts || 0) - (a.ts || 0)).map((d) => (
                  <div key={d._id} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "#f8fafc",
                    border: "2px solid #e2e8f0",
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                      <span style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>{d.text || "(empty)"}</span>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                        {d.author && <span style={{ fontWeight: 600, color: "#64748b" }}>{d.author}</span>}
                        {d.author && " · "}
                        {d.ts ? new Date(d.ts).toLocaleTimeString() : "—"}
                      </span>
                    </div>
                    <button
                      onClick={() => database.del(d._id)}
                      style={{
                        width: 28,
                        height: 28,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: "2px solid #e2e8f0",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "#94a3b8",
                        flexShrink: 0,
                      }}
                      aria-label={`Delete ${d.text}`}
                    >✕</button>
                  </div>
                ))}
              </div>

              <div style={{ textAlign: "right" }}>
                <Badge label="total" value={docs.length} />
              </div>
            </div>
          </Panel>

          {/* ── AI Proxy Panel ── */}
          <Panel title="AI PROXY" style={{ animationDelay: "0.15s", gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Status dot + label */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "9999px",
                  background: AI_STATUS_COLORS[aiStatus],
                  border: "3px solid #0f172a",
                  animation: aiStatus === "checking" ? "pulse-dot 1.4s ease-in-out infinite" : "none",
                  flexShrink: 0,
                }} />
                <div>
                  <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.1 }}>
                    {AI_STATUS_LABELS[aiStatus]}
                  </div>
                  {aiStatus === "not_deployed" && (
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px", lineHeight: 1.4 }}>
                      The AI proxy hasn't been set up for this app yet.
                      Deploy with <code style={{ background: "#f1f5f9", padding: "1px 4px", fontSize: "11px" }}>--ai-key</code> to enable it, then hit "Check Vibes" to test.
                    </div>
                  )}
                  {aiStatus === "error" && aiError && (
                    <div style={{ fontSize: "12px", color: "oklch(0.62 0.22 25)", marginTop: "2px" }}>
                      {aiError}
                    </div>
                  )}
                  {aiStatus === "unconfigured" && (
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      Couldn't reach the server.
                    </div>
                  )}
                </div>
              </div>

              {/* Vibe Check button */}
              <button
                onClick={checkVibes}
                disabled={aiStatus !== "available" || vibeLoading}
                style={{
                  padding: "12px 24px",
                  background: aiStatus === "available" ? "#0f172a" : "#94a3b8",
                  color: "#ffffff",
                  border: "3px solid #0f172a",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  cursor: aiStatus === "available" && !vibeLoading ? "pointer" : "not-allowed",
                  textTransform: "uppercase",
                  alignSelf: "flex-start",
                  opacity: vibeLoading ? 0.7 : 1,
                }}
              >
                {vibeLoading ? "Analyzing…" : "Check Vibes"}
              </button>

              {/* Vibe result card */}
              {vibeResult && (
                <div style={{
                  background: "#f8fafc",
                  border: "3px solid #0f172a",
                  padding: "20px",
                  animation: "slide-up 0.3s ease-out both",
                }}>
                  <div style={{
                    fontSize: "28px",
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    marginBottom: "8px",
                    color: vibeResult.vibe === "ERROR" ? "oklch(0.62 0.22 25)" : "#0f172a",
                  }}>
                    {vibeResult.vibe}
                  </div>
                  <div style={{
                    fontSize: "14px",
                    fontStyle: "italic",
                    color: "#475569",
                    marginBottom: "12px",
                    lineHeight: 1.5,
                  }}>
                    {vibeResult.reading}
                  </div>
                  <div style={{
                    background: "#ffffff",
                    border: "2px solid #cbd5e1",
                    padding: "10px 14px",
                    fontSize: "13px",
                    color: "#64748b",
                    lineHeight: 1.4,
                  }}>
                    {vibeResult.fortune}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </main>

        {/* ── Diagnostics Footer ── */}
        <footer style={{
          maxWidth: "960px",
          margin: "0 auto",
          padding: "0 24px 32px",
          animation: "slide-up 0.4s ease-out 0.15s both",
        }}>
          <Panel title="SYSTEM CHECKS">
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "4px 24px",
            }}>
              <Check label="React Singleton" ok={reactOk} />
              <Check label="useLiveQuery" ok={queryOk} />
              <Check label="Data Integrity" ok={integrityOk} />
              <Check label="Sync Status" ok={syncOk} />
              {/* AI Proxy: gray circle if unconfigured, green check if available, red X if error */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 0",
              }}>
                <span style={{
                  width: 20,
                  height: 20,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: aiOk ? "oklch(0.72 0.19 145)" : aiStatus === "error" ? "oklch(0.62 0.22 25)" : (aiStatus === "not_deployed" || aiStatus === "checking") ? "oklch(0.75 0.16 85)" : "oklch(0.55 0.0 0)",
                  border: "2px solid #0f172a",
                  borderRadius: "9999px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: aiOk ? "#0f172a" : aiStatus === "error" ? "#ffffff" : "#0f172a",
                }}>{aiOk ? "✓" : aiStatus === "error" ? "✗" : "○"}</span>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "13px",
                  color: "#0f172a",
                }}>AI Proxy</span>
              </div>
            </div>
          </Panel>
        </footer>
      </div>
    </>
  );
}
