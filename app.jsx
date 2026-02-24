window.__VIBES_THEMES__ = [{ id: "rift", name: "Rift Portal" }, { id: "palate", name: "Palate Notes" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "palate");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const { useFireproofClerk } = window;

/* ── SVG ICON COMPONENTS ────────────────────────────────── */

function StarIcon({ size = 24, color = "oklch(0.93 0.006 265)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.4 7.2H22l-6 4.8 2.4 7.2L12 16.4l-6.4 4.8 2.4-7.2-6-4.8h7.6z"
        fill={color} opacity="0.9">
        <animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function PlanetIcon({ size = 24, color = "oklch(0.82 0.006 265)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="7" fill={color} opacity="0.85" />
      <ellipse cx="12" cy="12" rx="11" ry="3" stroke={color} strokeWidth="1.2" fill="none"
        transform="rotate(-20 12 12)" opacity="0.6" />
      <circle cx="9" cy="10" r="1.5" fill="rgba(0,0,0,0.25)" />
      <circle cx="14" cy="14" r="1" fill="rgba(0,0,0,0.15)" />
    </svg>
  );
}

function NebulaIcon({ size = 24, color = "oklch(0.71 0.02 261)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <radialGradient id="nebIc">
          <stop offset="0%" stopColor={color} stopOpacity="0.8" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#nebIc)">
        <animate attributeName="r" values="9;11;9" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="8" cy="10" r="4" fill={color} opacity="0.3" />
      <circle cx="15" cy="14" r="3" fill={color} opacity="0.25" />
    </svg>
  );
}

function GalaxyIcon({ size = 24, color = "oklch(0.87 0.006 265)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="9" ry="4" fill={color} opacity="0.3" transform="rotate(-30 12 12)">
        <animateTransform attributeName="transform" type="rotate" from="-30 12 12" to="330 12 12"
          dur="20s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="12" cy="12" rx="7" ry="3" fill={color} opacity="0.4" transform="rotate(15 12 12)">
        <animateTransform attributeName="transform" type="rotate" from="15 12 12" to="375 12 12"
          dur="15s" repeatCount="indefinite" />
      </ellipse>
      <circle cx="12" cy="12" r="2" fill={color} opacity="0.9" />
    </svg>
  );
}

function TelescopeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="22" x2="12" y2="13" /><line x1="18" y1="22" x2="12" y2="13" />
      <path d="M3 8l4 2 5-6 8 4-5 6 4 2" /><circle cx="12" cy="4" r="1" fill="currentColor" />
    </svg>
  );
}

function SatelliteIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)" />
      <line x1="4" y1="4" x2="8.5" y2="8.5" /><line x1="15.5" y1="15.5" x2="20" y2="20" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/* ── CONSTELLATION EMPTY STATE ──────────────────────────── */

function ConstellationEmpty({ label = "NO OBJECTS DETECTED" }) {
  return (
    <svg width="220" height="170" viewBox="0 0 220 170" fill="none" style={{ opacity: 0.6 }}>
      <circle cx="30" cy="40" r="3" fill="oklch(0.93 0.006 265)"><animate attributeName="opacity" values="0.4;1;0.4" dur="2.5s" repeatCount="indefinite" /></circle>
      <circle cx="90" cy="20" r="2" fill="oklch(0.93 0.006 265)"><animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" begin="0.5s" /></circle>
      <circle cx="130" cy="65" r="3" fill="oklch(0.71 0.02 261)"><animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" begin="1s" /></circle>
      <circle cx="180" cy="30" r="2" fill="oklch(0.87 0.006 265)"><animate attributeName="opacity" values="0.4;1;0.4" dur="3.5s" repeatCount="indefinite" begin="0.3s" /></circle>
      <circle cx="60" cy="100" r="2.5" fill="oklch(0.82 0.006 265)"><animate attributeName="opacity" values="0.5;1;0.5" dur="2.8s" repeatCount="indefinite" begin="0.8s" /></circle>
      <circle cx="160" cy="105" r="2" fill="oklch(0.93 0.006 265)"><animate attributeName="opacity" values="0.6;1;0.6" dur="2.2s" repeatCount="indefinite" begin="1.2s" /></circle>
      <circle cx="200" cy="75" r="1.5" fill="oklch(0.71 0.02 261)"><animate attributeName="opacity" values="0.3;0.9;0.3" dur="3.2s" repeatCount="indefinite" begin="0.6s" /></circle>
      <line x1="30" y1="40" x2="90" y2="20" stroke="oklch(0.93 0.006 265)" strokeWidth="0.5" opacity="0.3" />
      <line x1="90" y1="20" x2="130" y2="65" stroke="oklch(0.93 0.006 265)" strokeWidth="0.5" opacity="0.3" />
      <line x1="130" y1="65" x2="180" y2="30" stroke="oklch(0.71 0.02 261)" strokeWidth="0.5" opacity="0.25" />
      <line x1="130" y1="65" x2="160" y2="105" stroke="oklch(0.71 0.02 261)" strokeWidth="0.5" opacity="0.25" />
      <line x1="30" y1="40" x2="60" y2="100" stroke="oklch(0.82 0.006 265)" strokeWidth="0.5" opacity="0.25" />
      <text x="110" y="150" textAnchor="middle" fill="oklch(0.71 0.02 261)" fontFamily="'Cormorant Garamond', serif" fontSize="13" letterSpacing="0.1em">{label}</text>
    </svg>
  );
}

/* ── CARD ILLUSTRATION BACKGROUNDS ──────────────────────── */

function StarFieldBg() {
  const stars = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      cx: Math.random() * 200, cy: Math.random() * 120,
      r: 0.5 + Math.random() * 1.5, delay: Math.random() * 3
    })), []);
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      <rect width="200" height="120" fill="oklch(0.14 0.000 0)" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="oklch(0.93 0.006 265)">
          <animate attributeName="opacity" values="0.05;0.25;0.05" dur={`${2 + s.delay}s`} repeatCount="indefinite" begin={`${s.delay}s`} />
        </circle>
      ))}
      <circle cx="160" cy="35" r="12" fill="oklch(0.93 0.006 265)" opacity="0.03" />
    </svg>
  );
}

function NebulaBg() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      <rect width="200" height="120" fill="oklch(0.14 0.000 0)" />
      <defs>
        <radialGradient id="nbg1" cx="30%" cy="40%"><stop offset="0%" stopColor="oklch(0.71 0.02 261)" stopOpacity="0.15" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        <radialGradient id="nbg2" cx="75%" cy="55%"><stop offset="0%" stopColor="oklch(0.93 0.006 265)" stopOpacity="0.08" /><stop offset="100%" stopColor="transparent" /></radialGradient>
      </defs>
      <rect width="200" height="120" fill="url(#nbg1)" /><rect width="200" height="120" fill="url(#nbg2)" />
      <circle cx="55" cy="55" r="4" fill="oklch(0.71 0.02 261)" opacity="0.1"><animate attributeName="r" values="3;5;3" dur="5s" repeatCount="indefinite" /></circle>
    </svg>
  );
}

function PlanetBg() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      <rect width="200" height="120" fill="oklch(0.14 0.000 0)" />
      <circle cx="135" cy="75" r="40" fill="oklch(0.82 0.006 265)" opacity="0.04" />
      <circle cx="135" cy="75" r="28" fill="oklch(0.22 0.000 0)" />
      <ellipse cx="135" cy="75" rx="45" ry="7" fill="none" stroke="oklch(0.82 0.006 265)" strokeWidth="1" opacity="0.12" />
      <circle cx="30" cy="25" r="1" fill="oklch(0.93 0.006 265)" opacity="0.15" /><circle cx="170" cy="15" r="1.5" fill="oklch(0.93 0.006 265)" opacity="0.1" />
    </svg>
  );
}

function GalaxyBg() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      <rect width="200" height="120" fill="oklch(0.14 0.000 0)" />
      <defs>
        <radialGradient id="gbg"><stop offset="0%" stopColor="oklch(0.87 0.006 265)" stopOpacity="0.15" /><stop offset="60%" stopColor="oklch(0.87 0.006 265)" stopOpacity="0.03" /><stop offset="100%" stopColor="transparent" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="60" rx="60" ry="22" fill="url(#gbg)" transform="rotate(-15 100 60)">
        <animateTransform attributeName="transform" type="rotate" from="-15 100 60" to="345 100 60" dur="25s" repeatCount="indefinite" />
      </ellipse>
      <circle cx="100" cy="60" r="3" fill="oklch(0.87 0.006 265)" opacity="0.2" />
    </svg>
  );
}

/* ── CATEGORY CONFIG ────────────────────────────────────── */

const CATEGORIES = {
  star:   { label: "STAR",   accent: "cyan",   Icon: StarIcon,   Bg: StarFieldBg },
  planet: { label: "PLANET", accent: "green",  Icon: PlanetIcon, Bg: PlanetBg },
  nebula: { label: "NEBULA", accent: "pink",   Icon: NebulaIcon, Bg: NebulaBg },
  galaxy: { label: "GALAXY", accent: "yellow", Icon: GalaxyIcon, Bg: GalaxyBg },
};

const ACCENTS = {
  cyan:   "oklch(0.93 0.006 265)",
  green:  "oklch(0.82 0.006 265)",
  pink:   "oklch(0.71 0.02 261)",
  yellow: "oklch(0.87 0.006 265)",
};

const GLOWS = {
  cyan:   "none",
  green:  "none",
  pink:   "none",
  yellow: "none",
};

/* ── MAIN APP ───────────────────────────────────────────── */

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("cosmos-atlas-db");

  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewDetail, setViewDetail] = useState(null);

  const queryOpts = filter === "all" ? {} : { key: filter };
  const { docs } = useLiveQuery("category", queryOpts);
  const items = useMemo(() => docs.filter(d => d.type === "celestial"), [docs]);

  const blank = { name: "", category: "star", description: "", distance: "", magnitude: "", type: "celestial" };
  const { doc, merge, submit, reset } = useDocument(editingId ? { _id: editingId } : blank);

  const counts = useMemo(() => {
    const c = { star: 0, planet: 0, nebula: 0, galaxy: 0 };
    items.forEach(d => { if (c[d.category] !== undefined) c[d.category]++; });
    return c;
  }, [items]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!doc.name.trim()) return;
    await submit({ type: "celestial" });
    reset();
    setShowForm(false);
    setEditingId(null);
  }, [doc.name, submit, reset]);

  const handleEdit = useCallback((item) => {
    setEditingId(item._id);
    setShowForm(true);
    setViewDetail(null);
  }, []);

  const handleDelete = useCallback(async (id) => {
    await database.del(id);
    if (viewDetail && viewDetail._id === id) setViewDetail(null);
  }, [database, viewDetail]);

  const handleNew = useCallback(() => {
    setEditingId(null);
    reset();
    setShowForm(true);
  }, [reset]);

  const handleCancel = useCallback(() => {
    reset();
    setShowForm(false);
    setEditingId(null);
  }, [reset]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", padding: 32, boxSizing: "border-box" }}>
      <style>{CSS_TEXT}</style>

      {/* STARS */}
      <div className="star-field">
        {Array.from({ length: 50 }, (_, i) => (
          <div key={i} className="bg-star" style={{
            width: 2 + (i % 4) * 1.2, height: 2 + (i % 4) * 1.2,
            top: `${(i * 17 + 5) % 100}%`, left: `${(i * 23 + 3) % 100}%`,
            animationDelay: `${(i * 0.4) % 5}s`, animationDuration: `${2 + (i % 4)}s`,
          }} />
        ))}
      </div>

      {/* HEADER */}
      <header style={{ position: "relative", zIndex: 20, padding: "20px 0 4px", textAlign: "center" }}>
        <h1 className="hero-title">Cosmos Atlas</h1>
        <div style={{ marginTop: 4 }}>
          <div className="subtitle-pill">
            <span className="subtitle-text">DEEP SPACE CATALOG</span>
          </div>
        </div>
      </header>

      <div className="neon-div-pink" />

      {/* MACHINE FRAME */}
      <main style={{ flex: 1, position: "relative", zIndex: 10, maxWidth: 800, width: "100%", margin: "0 auto" }}>
        <div className="machine-frame">

          {/* STATUS BAR */}
          <div className="status-bar">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="status-rings">
                <div className="ring-outer" /><div className="ring-inner" /><div className="ring-center" />
              </div>
              <div>
                <div className="sys-label">SYSTEM STATUS</div>
                <div className="sys-value">{items.length} OBJECT{items.length !== 1 ? "S" : ""} CATALOGED</div>
              </div>
            </div>
            <div className="stat-grid">
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <div key={key} className="stat-cell">
                  <cat.Icon size={14} color={ACCENTS[cat.accent]} />
                  <span className="stat-cell-label">{cat.label}</span>
                  <span className="stat-cell-val" style={{ color: ACCENTS[cat.accent] }}>{counts[key]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* NAV */}
          <nav className="hex-nav">
            {[{ key: "all", label: "ALL", accent: "cyan" }, ...Object.entries(CATEGORIES).map(([k, c]) => ({ key: k, label: c.label + "S", accent: c.accent }))].map(item => (
              <button key={item.key} className={`hex-btn ${filter === item.key ? "hex-on" : ""}`}
                onClick={() => setFilter(item.key)}
                style={filter === item.key
                  ? { background: "oklch(0.93 0.006 265)", color: "oklch(0.17 0.000 0)", borderColor: "oklch(0.93 0.006 265)" }
                  : { borderColor: "oklch(0.37 0.03 260)", color: "oklch(0.93 0.006 265)", boxShadow: GLOWS[item.accent] }}>
                {item.label}
              </button>
            ))}
            <button className="hex-btn hex-log-btn" onClick={handleNew}
              style={showForm ? { background: "oklch(0.93 0.006 265)", color: "oklch(0.17 0.000 0)" } : {}}>
              + LOG
            </button>
          </nav>

          {/* FORM */}
          {showForm && (
            <div className="form-wrap">
              <div className="form-card">
                <div className="form-header">
                  <span className="form-title">{editingId ? "EDIT OBJECT" : "LOG NEW OBJECT"}</span>
                  <button onClick={handleCancel} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="form-body">
                  <div className="field-row">
                    <div style={{ flex: 2 }}>
                      <label className="field-label">DESIGNATION</label>
                      <input className="field-input" placeholder="e.g. Andromeda, Betelgeuse..."
                        value={doc.name || ""} onChange={e => merge({ name: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">CATEGORY</label>
                      <select className="field-input" value={doc.category || "star"}
                        onChange={e => merge({ category: e.target.value })}>
                        {Object.entries(CATEGORIES).map(([k, c]) => (
                          <option key={k} value={k}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="field-label">OBSERVATION NOTES</label>
                    <textarea className="field-input field-textarea" placeholder="Describe what you observed..."
                      value={doc.description || ""} onChange={e => merge({ description: e.target.value })} />
                  </div>
                  <div className="field-row">
                    <div style={{ flex: 1 }}>
                      <label className="field-label">DISTANCE (LY)</label>
                      <input className="field-input" placeholder="e.g. 4.24"
                        value={doc.distance || ""} onChange={e => merge({ distance: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">MAGNITUDE</label>
                      <input className="field-input" placeholder="e.g. -1.46"
                        value={doc.magnitude || ""} onChange={e => merge({ magnitude: e.target.value })} />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="button" onClick={handleCancel} className="cancel-btn">Cancel</button>
                    <button type="submit" className="hex-btn submit-btn">{editingId ? "Update \u2192" : "Catalog \u2192"}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* CARDS */}
          {items.length === 0 ? (
            <div className="empty-state">
              <ConstellationEmpty label={filter === "all" ? "BEGIN CATALOGING THE COSMOS" : `NO ${CATEGORIES[filter]?.label || ""}S FOUND`} />
            </div>
          ) : (
            <div className="card-grid">
              {items.map((item, idx) => {
                const cat = CATEGORIES[item.category] || CATEGORIES.star;
                return (
                  <div key={item._id} className="portal-card" style={{ borderColor: ACCENTS[cat.accent], animationDelay: `${idx * 0.06}s` }}>
                    <div className="card-tail" style={{ borderTopColor: ACCENTS[cat.accent] }} />
                    <div className="card-tail-inner" />

                    <div className="card-image">
                      <cat.Bg />
                      <div className="card-overlay" />
                      <span className="card-badge" style={{ background: "none", color: ACCENTS[cat.accent], border: "1px solid oklch(0.37 0.03 260)" }}>
                        {cat.label}
                      </span>
                    </div>

                    <div className="card-body">
                      <h3 className="card-title" style={{ color: ACCENTS[cat.accent] }}>{item.name || "Unnamed"}</h3>
                      <p className="card-desc">{item.description || "No observations recorded."}</p>

                      {(item.distance || item.magnitude) && (
                        <div className="card-tags">
                          {item.distance && <span className="tag-pill" style={{ borderColor: "oklch(0.37 0.03 260)" }}>{item.distance} LY</span>}
                          {item.magnitude && <span className="tag-pill" style={{ borderColor: "oklch(0.37 0.03 260)" }}>MAG {item.magnitude}</span>}
                        </div>
                      )}

                      <div className="card-actions">
                        <button className="card-cta" style={{ color: ACCENTS[cat.accent] }} onClick={() => setViewDetail(item)}>View</button>
                        <button className="card-cta" style={{ color: ACCENTS[cat.accent] }} onClick={() => handleEdit(item)}>Edit</button>
                        <button className="card-cta cta-del" onClick={() => handleDelete(item._id)}>Del</button>
                      </div>

                      <div className="card-progress"><div className="card-progress-fill" style={{ background: `linear-gradient(to right, ${ACCENTS[cat.accent]}, transparent)` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* DETAIL OVERLAY */}
      {viewDetail && (() => {
        const cat = CATEGORIES[viewDetail.category] || CATEGORIES.star;
        return (
          <div className="detail-overlay" onClick={e => { if (e.target === e.currentTarget) setViewDetail(null); }}>
            <div className="detail-panel" style={{ borderColor: "oklch(0.37 0.03 260)" }}>
              <div className="detail-header" style={{ borderBottomColor: "oklch(0.37 0.03 260)" }}>
                <cat.Icon size={28} color={ACCENTS[cat.accent]} />
                <div style={{ flex: 1 }}>
                  <h2 className="detail-name" style={{ color: "oklch(0.93 0.006 265)" }}>{viewDetail.name || "Unnamed"}</h2>
                  <span className="detail-cat-badge" style={{ background: "none", color: ACCENTS[cat.accent], border: "1px solid oklch(0.37 0.03 260)" }}>
                    {cat.label}
                  </span>
                </div>
                <button onClick={() => setViewDetail(null)} className="close-btn">&times;</button>
              </div>
              <div className="detail-body">
                {viewDetail.description && <p className="detail-desc">{viewDetail.description}</p>}
                <div className="detail-stats">
                  {viewDetail.distance && (
                    <div className="detail-stat-item">
                      <span className="detail-stat-label">DISTANCE</span>
                      <span className="detail-stat-val" style={{ color: "oklch(0.93 0.006 265)" }}>{viewDetail.distance} LY</span>
                    </div>
                  )}
                  {viewDetail.magnitude && (
                    <div className="detail-stat-item">
                      <span className="detail-stat-label">MAGNITUDE</span>
                      <span className="detail-stat-val" style={{ color: "oklch(0.93 0.006 265)" }}>{viewDetail.magnitude}</span>
                    </div>
                  )}
                </div>
                <div className="detail-visual">
                  <cat.Bg />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <cat.Icon size={64} color={ACCENTS[cat.accent]} />
                  </div>
                </div>
              </div>
              <div className="detail-footer">
                <button className="hex-btn" style={{ fontSize: 14, padding: "8px 24px", borderColor: "oklch(0.37 0.03 260)", color: "oklch(0.93 0.006 265)", boxShadow: "none" }}
                  onClick={() => handleEdit(viewDetail)}>Edit</button>
                <button className="hex-btn" style={{ fontSize: 14, padding: "8px 24px", borderColor: "oklch(0.37 0.03 260)", color: "oklch(0.71 0.02 261)", boxShadow: "none" }}
                  onClick={() => { handleDelete(viewDetail._id); setViewDetail(null); }}>Delete</button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="neon-div" />

      {/* FOOTER */}
      <footer style={{ textAlign: "center", padding: "24px 0 12px", position: "relative", zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="float-anim"><PlanetIcon size={28} color="oklch(0.82 0.006 265)" /></span>
          <span className="footer-text">Explore the Void</span>
          <span className="float-anim" style={{ animationDelay: "2s" }}><StarIcon size={28} color="oklch(0.87 0.006 265)" /></span>
        </div>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: "oklch(0.71 0.02 261)", marginTop: 16, letterSpacing: "0.1em" }}>
          COSMOS ATLAS v1.0 — DATA SYNCED ACROSS THE GALAXY
        </p>
      </footer>
    </div>
  );
}

/* ── CSS ────────────────────────────────────────────────── */

const CSS_TEXT = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&display=swap');

:root {
  --bg: oklch(0.17 0.000 0);
  --surface: oklch(0.19 0.000 0);
  --card: oklch(0.17 0.000 0);
  --card-inner: oklch(0.22 0.000 0);
  --border: oklch(0.37 0.03 260);
  --border-frame: oklch(0.37 0.03 260);
  --fg: oklch(0.93 0.006 265);
  --fg-muted: oklch(0.71 0.02 261);
  --fg-dim: oklch(0.50 0.01 260);
  --dot: oklch(0.93 0.006 265);

  --comp-bg: oklch(0.17 0.000 0);
  --comp-text: oklch(0.93 0.006 265);
  --comp-border: oklch(0.37 0.03 260);
  --comp-accent: oklch(0.93 0.006 265);
  --comp-accent-text: oklch(0.17 0.000 0);
  --comp-muted: oklch(0.71 0.02 261);
  --color-background: oklch(0.17 0.000 0);
  --color-text: oklch(0.93 0.006 265);
  --grid-color: rgba(200, 200, 200, 0.02);
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  background: var(--bg);
  font-family: 'Cormorant Garamond', serif;
  color: var(--fg);
  overflow-x: hidden;
}
body::before, body::after { display: none !important; }

/* ── Star field (hidden for palate) ── */
.star-field { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0; }
@keyframes twinkle {
  0%, 100% { opacity: 0; }
  50% { opacity: 0.1; }
}
.bg-star {
  position: absolute; background: oklch(0.93 0.006 265); border-radius: 50%;
  animation: twinkle 5s infinite ease-in-out;
}

/* ── Hero ── */
.hero-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: clamp(32px, 7vw, 56px);
  font-weight: 400;
  color: var(--fg);
  letter-spacing: 0.025em; line-height: 1; margin: 0;
}
.subtitle-pill {
  display: inline-block;
  background: none;
  border: none;
  padding: 4px 0; border-radius: 0;
  transform: none;
}
.subtitle-text {
  font-family: 'Cormorant Garamond', serif; font-weight: 400;
  font-size: 14px;
  color: var(--fg-muted); letter-spacing: 0.1em;
  text-transform: uppercase;
  display: inline-block; transform: none;
}

/* ── Dividers ── */
.neon-div { width: 100%; height: 1px; margin: 24px 0; background: var(--border); opacity: 0.5; }
.neon-div-pink { width: 100%; height: 1px; margin: 16px 0 24px; background: var(--border); opacity: 0.5; }

/* ── Machine frame ── */
.machine-frame {
  background: none;
  border-top: 1px solid var(--border); border-bottom: none;
  border-radius: 0; padding: 32px 0; position: relative;
}
@media (max-width: 640px) { .machine-frame { border-radius: 0; padding: 16px 0; } }

/* ── Status bar ── */
.status-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 32px; padding: 0; }
.status-rings { position: relative; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0.25; }
.ring-outer { position: absolute; inset: 0; border: 1px solid var(--border); border-radius: 50%; border-top-color: transparent; animation: spin 10s linear infinite; }
.ring-inner { position: absolute; inset: 8px; border: 1px solid var(--border); border-radius: 50%; border-bottom-color: transparent; animation: spin 10s linear infinite reverse; }
.ring-center { width: 4px; height: 4px; background: var(--dot); border-radius: 50%; }
@keyframes spin { to { transform: rotate(360deg); } }
.sys-label { font-family: 'Cormorant Garamond', serif; font-size: 14px; color: var(--fg-muted); letter-spacing: 0.1em; text-transform: uppercase; }
.sys-value { font-family: 'Cormorant Garamond', serif; font-size: 16px; color: var(--fg); margin-top: 2px; }
.stat-grid { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-cell { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: none; border: 1px solid var(--border); border-radius: 9999px; }
.stat-cell-label { font-family: 'Cormorant Garamond', serif; font-size: 14px; color: var(--fg-muted); letter-spacing: 0.1em; text-transform: uppercase; }
.stat-cell-val { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 400; }

/* ── Nav (pill buttons) ── */
.hex-nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-bottom: 32px; }
.hex-btn {
  clip-path: none;
  padding: 8px 20px; background: none;
  border: 1px solid var(--border);
  font-family: 'Cormorant Garamond', serif; font-weight: 400; font-size: 14px;
  letter-spacing: 0.05em; color: var(--fg); cursor: pointer;
  border-radius: 9999px; transition: all 0.2s;
}
.hex-btn:hover { color: var(--fg-muted); }
.hex-log-btn { border-color: var(--border); color: var(--fg); }
.hex-log-btn:hover { color: var(--fg-muted); }
.submit-btn { font-size: 14px; padding: 8px 24px; }

/* ── Form ── */
.form-wrap { margin-bottom: 32px; padding: 0; animation: formSlide 0.3s ease; overflow: hidden; }
@keyframes formSlide { from { opacity: 0; } to { opacity: 1; } }
.form-card { background: none; border: none; border-top: 1px solid var(--border); border-radius: 0; overflow: hidden; }
.form-header { padding: 16px 0; border-bottom: none; display: flex; justify-content: space-between; align-items: center; }
.form-title { font-family: 'Cormorant Garamond', serif; font-size: 14px; color: var(--fg-muted); letter-spacing: 0.1em; text-transform: uppercase; }
.form-body { padding: 0; padding-top: 16px; display: flex; flex-direction: column; gap: 24px; }
.form-actions { display: flex; gap: 16px; justify-content: flex-end; margin-top: 8px; }
.field-row { display: flex; gap: 24px; flex-wrap: wrap; }
.field-row > div { min-width: 0; }
.field-label { display: block; font-family: 'Cormorant Garamond', serif; font-size: 12px; color: var(--fg-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.field-input {
  width: 100%; box-sizing: border-box; padding: 8px 0;
  background: transparent; border: none; border-bottom: 1px solid var(--border);
  color: var(--fg); font-family: 'Cormorant Garamond', serif; font-size: 18px; outline: none; transition: border-color 0.2s;
}
.field-input:focus { border-bottom-color: var(--fg); }
.field-input::placeholder { color: var(--fg-dim); }
.field-textarea { min-height: 60px; resize: vertical; }
select.field-input { appearance: none; cursor: pointer; }
.close-btn { background: none; border: none; color: var(--fg); font-size: 18px; cursor: pointer; padding: 2px 8px; transition: color 0.2s; line-height: 1; font-weight: 300; }
.close-btn:hover { color: var(--fg-muted); }
.cancel-btn {
  padding: 8px 0; background: transparent; border: none;
  color: var(--fg-muted); font-family: 'Cormorant Garamond', serif; font-size: 14px;
  border-radius: 0; cursor: pointer; letter-spacing: 0.05em; transition: color 0.2s;
}
.cancel-btn:hover { color: var(--fg); }

/* ── Cards ── */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 32px; padding: 0 0 32px; }
@keyframes cardEnter { from { opacity: 0; } to { opacity: 1; } }
.portal-card {
  position: relative; background: none; border: none;
  border-top: 1px solid var(--border);
  border-radius: 0; overflow: visible; display: flex; flex-direction: column;
  transition: opacity 0.3s ease;
  animation: cardEnter 0.3s ease-out both;
  padding-top: 16px;
}
.portal-card:hover { transform: none; box-shadow: none; }
.card-tail { display: none; }
.card-tail-inner { display: none; }
.card-image { height: 48px; overflow: hidden; position: relative; border-radius: 0; opacity: 0.35; }
.card-overlay { position: absolute; inset: 0; background: linear-gradient(to top, var(--bg), transparent 70%); }
.card-badge {
  position: absolute; top: 8px; right: 0; padding: 4px 12px;
  font-family: 'Cormorant Garamond', serif; font-size: 11px; border-radius: 9999px;
  transform: none; letter-spacing: 0.1em; z-index: 5; text-transform: uppercase;
}
.card-body { padding: 12px 0 0; flex: 1; display: flex; flex-direction: column; }
.card-title {
  font-family: 'Cormorant Garamond', serif; font-size: 20px; font-weight: 400; letter-spacing: 0.02em;
  margin: 0 0 8px; line-height: 1.2; word-break: break-word; transition: color 0.2s;
}
.portal-card:hover .card-title { text-shadow: none; color: var(--fg-muted); }
.card-desc {
  font-family: 'Cormorant Garamond', serif; font-size: 14px; color: var(--fg-muted);
  line-height: 1.625; margin: 0 0 12px; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 3; -webkit-box-orient: vertical;
}
.card-tags { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tag-pill {
  font-family: 'Cormorant Garamond', serif; font-size: 13px; color: var(--fg);
  padding: 6px 14px; border: 1px solid var(--border); border-radius: 9999px; letter-spacing: 0.05em;
}
.card-actions { display: flex; gap: 16px; margin-top: auto; }
.card-cta {
  flex: none; padding: 4px 0; background: none; border: none;
  font-family: 'Cormorant Garamond', serif; font-size: 14px; font-weight: 400;
  letter-spacing: 0.05em; border-radius: 0; cursor: pointer; transition: color 0.2s;
  color: var(--fg);
}
.card-cta:hover { background: none; color: var(--fg-muted); }
.cta-del { color: var(--fg-muted) !important; }
.cta-del:hover { background: none !important; color: var(--fg-dim) !important; }
.card-progress { width: 100%; height: 1px; background: var(--border); border-radius: 0; margin-top: 16px; overflow: hidden; position: relative; }
.card-progress-fill { width: 0; height: 100%; background: var(--fg) !important; transition: width 0.7s ease-out; }
.portal-card:hover .card-progress-fill { width: 100%; }

/* ── Empty state ── */
.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 0; }

/* ── Detail overlay ── */
.detail-overlay {
  position: fixed; inset: 0; background: oklch(0.10 0.000 0 / 0.9);
  z-index: 50; display: flex; align-items: center; justify-content: center;
  padding: 32px; animation: fadeIn 0.3s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.detail-panel {
  background: var(--bg); border: 1px solid var(--border); border-radius: 0;
  width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto;
  animation: cardEnter 0.3s ease-out;
}
.detail-header { display: flex; align-items: center; gap: 16px; padding: 24px; border-bottom: 1px solid var(--border); }
.detail-name { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 400; margin: 0; letter-spacing: 0.02em; line-height: 1.2; word-break: break-word; }
.detail-cat-badge { display: inline-block; padding: 4px 12px; font-family: 'Cormorant Garamond', serif; font-size: 12px; border-radius: 9999px; margin-top: 4px; letter-spacing: 0.1em; text-transform: uppercase; }
.detail-body { padding: 24px; }
.detail-desc { font-family: 'Cormorant Garamond', serif; font-size: 16px; color: var(--fg-muted); line-height: 1.625; margin: 0 0 24px; word-break: break-word; }
.detail-stats { display: flex; gap: 32px; margin-bottom: 24px; flex-wrap: wrap; }
.detail-stat-item { display: flex; flex-direction: column; gap: 4px; }
.detail-stat-label { font-family: 'Cormorant Garamond', serif; font-size: 12px; color: var(--fg-muted); letter-spacing: 0.1em; text-transform: uppercase; }
.detail-stat-val { font-family: 'Cormorant Garamond', serif; font-size: 20px; font-weight: 400; }
.detail-visual { position: relative; height: 80px; border-radius: 0; overflow: hidden; border: none; border-top: 1px solid var(--border); opacity: 0.35; }
.detail-footer { display: flex; gap: 16px; justify-content: center; padding: 24px; border-top: 1px solid var(--border); }

/* ── Footer ── */
.footer-text { font-family: 'Cormorant Garamond', serif; font-size: clamp(20px, 4vw, 32px); font-weight: 400; color: var(--fg); letter-spacing: 0.025em; }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.float-anim { display: inline-block; animation: float 6s ease-in-out infinite; opacity: 0.35; }
`;

export default App;
