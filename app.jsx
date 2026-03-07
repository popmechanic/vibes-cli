window.__VIBES_THEMES__ = [{ id: "default", name: "Neo-Brutalist" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "default");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

const style = document.createElement("style");
style.textContent = `
/* @theme:tokens */
:root {
  --comp-bg: oklch(0.16 0.03 55);
  --comp-text: oklch(0.92 0.02 80);
  --comp-border: oklch(0.45 0.08 65);
  --comp-accent: oklch(0.75 0.16 75);
  --comp-accent-text: oklch(0.15 0.03 55);
  --comp-muted: oklch(0.55 0.04 65);
  --comp-surface: oklch(0.21 0.035 58);
  --comp-glow: oklch(0.75 0.16 75 / 0.15);
  --comp-danger: oklch(0.65 0.2 25);
}
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&display=swap');
/* @theme:typography:end */

/* @theme:surfaces */
.help-app {
  font-family: 'Inter', sans-serif;
  background: var(--comp-bg);
  color: var(--comp-text);
}

.help-app h1, .help-app h2, .help-app h3 {
  font-family: 'Space Grotesk', sans-serif;
  color: var(--comp-text);
}

.help-header {
  background: linear-gradient(135deg, var(--comp-surface) 0%, oklch(0.22 0.05 70) 100%);
  border-bottom: 3px solid var(--comp-border);
  box-shadow: 0 4px 20px oklch(0 0 0 / 0.3);
}

.help-header h1 {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--comp-accent);
  text-shadow: 0 0 30px var(--comp-glow);
}

.help-subtitle {
  color: var(--comp-muted);
  font-size: 0.95rem;
}

.search-wrapper {
  background: var(--comp-surface);
  border: 2px solid var(--comp-border);
  border-radius: 12px;
  box-shadow: 0 2px 12px oklch(0 0 0 / 0.2);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.search-wrapper:focus-within {
  border-color: var(--comp-accent);
  box-shadow: 0 2px 20px var(--comp-glow);
}

.search-input {
  background: transparent;
  color: var(--comp-text);
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
}

.search-input::placeholder {
  color: var(--comp-muted);
}

.search-icon {
  color: var(--comp-muted);
  transition: color 0.2s ease;
}

.search-wrapper:focus-within .search-icon {
  color: var(--comp-accent);
}

.category-btn {
  background: var(--comp-surface);
  border: 2px solid var(--comp-border);
  border-radius: 10px;
  color: var(--comp-text);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: all 0.2s ease;
  box-shadow: 3px 3px 0 oklch(0 0 0 / 0.3);
}

.category-btn:hover {
  background: oklch(0.25 0.04 60);
  border-color: var(--comp-accent);
  box-shadow: 4px 4px 0 oklch(0 0 0 / 0.4);
  transform: translateY(-1px);
}

.category-btn.active {
  background: var(--comp-accent);
  color: var(--comp-accent-text);
  border-color: var(--comp-accent);
  box-shadow: 2px 2px 0 oklch(0 0 0 / 0.4);
}

.faq-card {
  background: var(--comp-surface);
  border: 2px solid var(--comp-border);
  border-radius: 12px;
  box-shadow: 4px 4px 0 oklch(0 0 0 / 0.25);
  transition: all 0.25s ease;
}

.faq-card:hover {
  transform: translateY(-2px);
  box-shadow: 6px 6px 0 oklch(0 0 0 / 0.3);
  border-color: var(--comp-accent);
}

.faq-question {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--comp-text);
  transition: color 0.2s ease;
}

.faq-card:hover .faq-question {
  color: var(--comp-accent);
}

.faq-answer {
  color: var(--comp-muted);
  font-size: 0.92rem;
  line-height: 1.7;
  border-top: 1px solid oklch(0.3 0.03 60);
}

.faq-toggle {
  color: var(--comp-accent);
  font-size: 1.4rem;
  font-weight: 700;
  transition: transform 0.3s ease;
}

.faq-toggle.open {
  transform: rotate(45deg);
}

.topic-count {
  background: oklch(0.28 0.04 65);
  color: var(--comp-muted);
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 6px;
}

.empty-text {
  color: var(--comp-muted);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.1rem;
}

.empty-subtext {
  color: oklch(0.45 0.03 60);
  font-size: 0.9rem;
}

.add-btn {
  background: var(--comp-accent);
  color: var(--comp-accent-text);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 2px solid var(--comp-accent);
  border-radius: 10px;
  box-shadow: 3px 3px 0 oklch(0 0 0 / 0.3);
  transition: all 0.15s ease;
}

.add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 4px 4px 0 oklch(0 0 0 / 0.4);
}

.add-btn:active {
  transform: translateY(1px);
  box-shadow: 1px 1px 0 oklch(0 0 0 / 0.3);
}

.form-card {
  background: var(--comp-surface);
  border: 2px solid var(--comp-accent);
  border-radius: 14px;
  box-shadow: 6px 6px 0 oklch(0 0 0 / 0.3);
}

.form-label {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--comp-accent);
}

.form-input {
  background: oklch(0.14 0.02 55);
  border: 2px solid var(--comp-border);
  border-radius: 8px;
  color: var(--comp-text);
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--comp-accent);
  box-shadow: 0 0 12px var(--comp-glow);
}

.form-input::placeholder {
  color: oklch(0.4 0.02 55);
}

.form-select {
  background: oklch(0.14 0.02 55);
  border: 2px solid var(--comp-border);
  border-radius: 8px;
  color: var(--comp-text);
  font-family: 'Inter', sans-serif;
  transition: border-color 0.2s ease;
}

.form-select:focus {
  outline: none;
  border-color: var(--comp-accent);
}

.cancel-btn {
  background: transparent;
  color: var(--comp-muted);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  border: 2px solid var(--comp-border);
  border-radius: 8px;
  transition: all 0.15s ease;
}

.cancel-btn:hover {
  border-color: var(--comp-danger);
  color: var(--comp-danger);
}

.delete-btn {
  color: oklch(0.4 0.03 55);
  font-size: 0.8rem;
  transition: color 0.15s ease;
}

.delete-btn:hover {
  color: var(--comp-danger);
}

.star-field circle {
  fill: oklch(0.85 0.05 80 / 0.3);
}

.lighthouse-beam {
  fill: var(--comp-accent);
  opacity: 0.08;
}

.lighthouse-body {
  fill: var(--comp-border);
}

.lighthouse-light {
  fill: var(--comp-accent);
}

.lighthouse-stripe {
  fill: var(--comp-danger);
}

.wave-path {
  fill: none;
  stroke: var(--comp-border);
  stroke-width: 1.5;
  opacity: 0.4;
}

.compass-ring {
  fill: none;
  stroke: var(--comp-border);
  stroke-width: 2;
}

.compass-needle {
  fill: var(--comp-accent);
}

.compass-needle-south {
  fill: var(--comp-muted);
}

.stats-value {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.8rem;
  color: var(--comp-accent);
}

.stats-label {
  color: var(--comp-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.stats-card {
  background: var(--comp-surface);
  border: 2px solid var(--comp-border);
  border-radius: 10px;
  box-shadow: 3px 3px 0 oklch(0 0 0 / 0.2);
}
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes beaconSweep {
  0%, 100% { opacity: 0.04; transform: rotate(-25deg); }
  50% { opacity: 0.12; transform: rotate(25deg); }
}

@keyframes gentlePulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}

@keyframes twinkle {
  0%, 100% { opacity: 0.2; r: 1; }
  50% { opacity: 0.8; r: 1.5; }
}

@keyframes compassSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes waveFlow {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50px); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
/* @theme:motion:end */

.help-app { min-height: 100vh; }
.help-content { max-width: 720px; margin: 0 auto; padding: 0 1rem 3rem; }
.help-header { padding: 2rem 1rem 1.5rem; margin-bottom: 1.5rem; }
.header-inner { max-width: 720px; margin: 0 auto; display: flex; align-items: center; gap: 1rem; }
.search-wrapper { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; margin-top: 1rem; }
.search-input { flex: 1; border: none; outline: none; padding: 0; }
.categories { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
.category-btn { padding: 0.5rem 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
.topic-count { padding: 0.15rem 0.45rem; }
.faq-list { display: flex; flex-direction: column; gap: 0.75rem; }
.faq-card { padding: 1rem 1.25rem; cursor: pointer; }
.faq-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.faq-question { flex: 1; }
.faq-answer { margin-top: 0.75rem; padding-top: 0.75rem; }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; text-align: center; }
.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.form-card { padding: 1.5rem; margin-bottom: 1.5rem; }
.form-group { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }
.form-input { padding: 0.65rem 0.85rem; width: 100%; box-sizing: border-box; }
.form-select { padding: 0.65rem 0.85rem; width: 100%; box-sizing: border-box; }
.form-actions { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 0.5rem; }
.form-actions button { padding: 0.55rem 1.25rem; cursor: pointer; }
.faq-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; }
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
.stats-card { padding: 1rem; text-align: center; display: flex; flex-direction: column; gap: 0.25rem; }
.add-btn { padding: 0.55rem 1.25rem; cursor: pointer; }
.cancel-btn { padding: 0.55rem 1.25rem; cursor: pointer; }
.delete-btn { cursor: pointer; background: none; border: none; padding: 0.25rem 0.5rem; }
`;
document.head.appendChild(style);

const CATEGORIES = ["All", "Getting Started", "Features", "Troubleshooting", "Tips & Tricks"];

// --- SVG Components ---

function LighthouseSVG({ size = 80 }) {
  return (
    /* @theme:decoration */
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
      <g style={{ animation: "beaconSweep 4s ease-in-out infinite", transformOrigin: "40px 28px" }}>
        <polygon className="lighthouse-beam" points="40,28 10,0 70,0" />
      </g>
      <rect className="lighthouse-body" x="32" y="28" width="16" height="35" rx="2" />
      <rect className="lighthouse-stripe" x="32" y="38" width="16" height="6" />
      <rect className="lighthouse-stripe" x="32" y="50" width="16" height="6" />
      <circle className="lighthouse-light" cx="40" cy="28" r="6" style={{ animation: "gentlePulse 2s ease-in-out infinite" }} />
      <rect className="lighthouse-body" x="28" y="63" width="24" height="6" rx="1" />
      <path className="wave-path" d="M5,74 Q15,70 25,74 T45,74 T65,74 T80,74" style={{ animation: "waveFlow 3s linear infinite" }} />
      <path className="wave-path" d="M0,78 Q12,74 24,78 T48,78 T72,78" style={{ animation: "waveFlow 4s linear infinite", opacity: 0.25 }} />
    </svg>
    /* @theme:decoration:end */
  );
}

function CompassSVG({ size = 120 }) {
  return (
    /* @theme:decoration */
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ animation: "float 4s ease-in-out infinite" }}>
      <circle className="compass-ring" cx="60" cy="60" r="50" />
      <circle className="compass-ring" cx="60" cy="60" r="42" strokeDasharray="4 6" />
      <g style={{ animation: "compassSpin 8s linear infinite", transformOrigin: "60px 60px" }}>
        <polygon className="compass-needle" points="60,20 55,58 60,55 65,58" />
        <polygon className="compass-needle-south" points="60,100 55,62 60,65 65,62" />
      </g>
      <circle cx="60" cy="60" r="4" fill="var(--comp-accent)" />
      {["N", "E", "S", "W"].map((d, i) => (
        <text
          key={d}
          x={60 + [0, 38, 0, -38][i]}
          y={60 + [-38, 4, 42, 4][i]}
          textAnchor="middle"
          fill="var(--comp-muted)"
          fontSize="10"
          fontFamily="Space Grotesk"
          fontWeight="700"
        >{d}</text>
      ))}
    </svg>
    /* @theme:decoration:end */
  );
}

function StarField() {
  const stars = React.useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      cx: Math.random() * 100,
      cy: Math.random() * 100,
      delay: Math.random() * 5,
      dur: 2 + Math.random() * 3,
    })), []);

  return (
    /* @theme:decoration */
    <svg className="star-field" style={{
      position: "fixed", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", zIndex: 0,
    }} preserveAspectRatio="none" viewBox="0 0 100 100">
      {stars.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r="0.6" style={{
          animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
        }} />
      ))}
    </svg>
    /* @theme:decoration:end */
  );
}

function BookIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function SearchIcon({ size = 18 }) {
  return (
    <svg className="search-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// --- Main App ---

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("help-center-db");

  const [search, setSearch] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState("All");
  const [openId, setOpenId] = React.useState(null);
  const [showForm, setShowForm] = React.useState(false);

  // Form state
  const [formQ, setFormQ] = React.useState("");
  const [formA, setFormA] = React.useState("");
  const [formCat, setFormCat] = React.useState("Getting Started");

  const { docs: allItems } = useLiveQuery("type", { key: "help-item" });

  const filtered = React.useMemo(() => {
    let items = allItems || [];
    if (activeCategory !== "All") {
      items = items.filter(d => d.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(d =>
        d.question?.toLowerCase().includes(q) ||
        d.answer?.toLowerCase().includes(q)
      );
    }
    return items.sort((a, b) => (b.created || 0) - (a.created || 0));
  }, [allItems, activeCategory, search]);

  const categoryCounts = React.useMemo(() => {
    const counts = {};
    CATEGORIES.forEach(c => { counts[c] = 0; });
    (allItems || []).forEach(d => {
      if (d.category && counts[d.category] !== undefined) counts[d.category]++;
      counts["All"]++;
    });
    return counts;
  }, [allItems]);

  const handleSubmit = async () => {
    if (!formQ.trim() || !formA.trim()) return;
    await database.put({
      type: "help-item",
      question: formQ.trim(),
      answer: formA.trim(),
      category: formCat,
      created: Date.now(),
    });
    setFormQ("");
    setFormA("");
    setFormCat("Getting Started");
    setShowForm(false);
  };

  const handleDelete = async (doc) => {
    await database.del(doc._id);
    setOpenId(null);
  };

  const totalItems = allItems?.length || 0;
  const catCount = new Set((allItems || []).map(d => d.category)).size;

  return (
    <div className="help-app" style={{ position: "relative", minHeight: "100vh" }}>
      <StarField />

      <div style={{ position: "relative", zIndex: 1 }}>
        <header className="help-header">
          <div className="header-inner">
            <LighthouseSVG size={64} />
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: 0 }}>Help Center</h1>
              <p className="help-subtitle" style={{ margin: "0.25rem 0 0" }}>
                Your knowledge base — find answers, add guides
              </p>
            </div>
          </div>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div className="search-wrapper">
              <SearchIcon />
              <input
                className="search-input"
                type="text"
                placeholder="Search topics..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    background: "none", border: "none", color: "var(--comp-muted)",
                    cursor: "pointer", fontSize: "1.1rem", padding: "0 0.25rem",
                  }}
                >×</button>
              )}
            </div>
          </div>
        </header>

        <div className="help-content">
          {/* Stats */}
          {totalItems > 0 && (
            <div className="stats-row" style={{ animation: "fadeInUp 0.4s ease" }}>
              <div className="stats-card">
                <span className="stats-value">{totalItems}</span>
                <span className="stats-label">Articles</span>
              </div>
              <div className="stats-card">
                <span className="stats-value">{catCount}</span>
                <span className="stats-label">Categories</span>
              </div>
              <div className="stats-card">
                <span className="stats-value">{filtered.length}</span>
                <span className="stats-label">Showing</span>
              </div>
            </div>
          )}

          {/* Categories */}
          <div className="categories">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`category-btn${activeCategory === cat ? " active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
                <span className="topic-count">{categoryCounts[cat] || 0}</span>
              </button>
            ))}
          </div>

          {/* Add Form */}
          <div className="action-bar">
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
              {activeCategory === "All" ? "All Topics" : activeCategory}
            </h2>
            {!showForm && (
              <button className="add-btn" onClick={() => setShowForm(true)}>
                + New Article
              </button>
            )}
          </div>

          {showForm && (
            <div className="form-card" style={{ animation: "fadeInUp 0.3s ease" }}>
              <div className="form-group">
                <label className="form-label">Question</label>
                <input
                  className="form-input"
                  placeholder="What question does this answer?"
                  value={formQ}
                  onChange={e => setFormQ(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Answer</label>
                <textarea
                  className="form-input"
                  placeholder="Write a helpful answer..."
                  rows={4}
                  value={formA}
                  onChange={e => setFormA(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={formCat}
                  onChange={e => setFormCat(e.target.value)}
                >
                  {CATEGORIES.filter(c => c !== "All").map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button className="cancel-btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button className="add-btn" onClick={handleSubmit}>
                  Save Article
                </button>
              </div>
            </div>
          )}

          {/* FAQ List */}
          <div className="faq-list">
            {filtered.map((item, i) => (
              <div
                key={item._id}
                className="faq-card"
                onClick={() => setOpenId(openId === item._id ? null : item._id)}
                style={{ animation: `fadeInUp 0.35s ease ${i * 0.05}s both` }}
              >
                <div className="faq-header">
                  <span className="faq-question">{item.question}</span>
                  <span className={`faq-toggle${openId === item._id ? " open" : ""}`}>+</span>
                </div>
                {openId === item._id && (
                  <div className="faq-answer" style={{ animation: "fadeInUp 0.2s ease" }}>
                    <p style={{ margin: "0 0 0.5rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {item.answer}
                    </p>
                    <div className="faq-meta">
                      <span className="badge" style={{ fontSize: "0.75rem" }}>{item.category}</span>
                      <button
                        className="delete-btn"
                        onClick={e => { e.stopPropagation(); handleDelete(item); }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Empty State */}
          {filtered.length === 0 && (
            <div className="empty-state" style={{ animation: "fadeInUp 0.5s ease" }}>
              <CompassSVG size={100} />
              <p className="empty-text">
                {search ? "No matching articles found" : "No articles yet"}
              </p>
              <p className="empty-subtext">
                {search
                  ? "Try a different search term or browse categories"
                  : "Click \"+ New Article\" to add your first help topic"
                }
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
