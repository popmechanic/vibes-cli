const { useState, useEffect, useRef } = React;

const DB_NAME = "diagnostics-db";

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
//  Main App
// ═══════════════════════════════════════════════
export default function App() {
  const {
    database, useLiveQuery, useDocument,
    syncStatus, isSyncing, lastSyncError,
  } = useFireproofClerk(DB_NAME);
  const [text, setText] = useState("");
  const { docs } = useLiveQuery("type", { key: "note" });

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

  const isPulsing = status === "connecting" || status === "reconnecting";

  return (
    <>
      <style>{KEYFRAMES}</style>
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
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}>FIREPROOF DIAGNOSTICS</span>
            <span style={{
              color: "#94a3b8",
              fontSize: "12px",
              fontWeight: 400,
            }}>{DB_NAME}</span>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Badge label="docs" value={docs.length} />
            <Badge label="uptime" value={fmtTime(uptime)} />
          </div>
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
          <Panel title="CRUD TEST" style={{ animationDelay: "0.1s" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Input form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  database.put({ text, type: "note", ts: Date.now() });
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
                {docs.map((d) => (
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
            </div>
          </Panel>
        </footer>
      </div>
    </>
  );
}
