window.__VIBES_THEMES__ = [{ id: "orbit", name: "Orbit Dashboard" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "orbit");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

/* ─── SVG Doodle Icons ─── */

function HeartDoodle({ size = 28, color = "var(--scrap-red)", style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "inline-block", ...style }}>
      <path
        d="M50 88C50 88 10 60 10 35C10 18 25 8 38 15C44 18 48 24 50 28C52 24 56 18 62 15C75 8 90 18 90 35C90 60 50 88 50 88Z"
        fill={color} stroke="var(--comp-border)" strokeWidth="3" strokeLinejoin="round"
      />
    </svg>
  );
}

function CartDoodle({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "inline-block" }}>
      <path d="M15 20 L25 20 L38 70 L80 70 L90 30 L30 30" fill="none" stroke="var(--comp-border)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="45" cy="82" r="7" fill="var(--scrap-red)" stroke="var(--comp-border)" strokeWidth="2.5" />
      <circle cx="72" cy="82" r="7" fill="var(--scrap-red)" stroke="var(--comp-border)" strokeWidth="2.5" />
      <path d="M42 45 L75 45" stroke="var(--comp-border)" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M40 55 L78 55" stroke="var(--comp-border)" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

function AppleDoodle({ size = 32, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "inline-block", ...style }}>
      <path d="M50 25C50 25 55 8 65 10" fill="none" stroke="oklch(0.4 0.12 145)" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="50" cy="60" rx="30" ry="32" fill="var(--scrap-red)" stroke="var(--comp-border)" strokeWidth="2.5" />
      <path d="M50 28C40 28 25 35 25 60" fill="none" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.3" />
    </svg>
  );
}

function CarrotDoodle({ size = 30, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "inline-block", ...style }}>
      <path d="M50 95L30 40C30 40 50 25 70 40Z" fill="oklch(0.72 0.15 55)" stroke="var(--comp-border)" strokeWidth="2.5" />
      <path d="M40 30C42 15 48 5 50 5C52 5 55 10 53 25" fill="oklch(0.55 0.15 145)" stroke="var(--comp-border)" strokeWidth="2" />
      <path d="M55 32C58 18 62 10 60 8" fill="none" stroke="oklch(0.55 0.15 145)" strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="55" x2="62" y2="55" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.3" />
      <line x1="40" y1="70" x2="58" y2="70" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.3" />
    </svg>
  );
}

function StarDoodle({ size = 22, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "inline-block", ...style }}>
      <path d="M50 5L61 38L95 38L68 60L78 95L50 73L22 95L32 60L5 38L39 38Z" fill="var(--comp-accent)" stroke="var(--comp-border)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyBagDoodle() {
  return (
    <svg width="120" height="140" viewBox="0 0 120 140" className="empty-bag-float">
      <rect x="20" y="50" width="80" height="80" rx="5" fill="oklch(0.97 0.01 90)" stroke="var(--comp-border)" strokeWidth="3" />
      <path d="M40 50C40 50 40 25 60 25C80 25 80 50 80 50" fill="none" stroke="var(--comp-border)" strokeWidth="3" strokeLinecap="round" />
      <text x="60" y="98" textAnchor="middle" fontFamily="'Caveat', cursive" fontSize="18" fill="var(--comp-muted)">empty!</text>
      <circle cx="45" cy="80" r="3" fill="var(--scrap-red)" opacity="0.5">
        <animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="75" cy="85" r="2.5" fill="var(--comp-accent)" opacity="0.5">
        <animate attributeName="r" values="2.5;3.5;2.5" dur="2.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

/* ─── Family Members ─── */
const FAMILY_MEMBERS = [
  { name: "Mom", color: "oklch(0.65 0.2 350)" },
  { name: "Dad", color: "oklch(0.5 0.15 250)" },
  { name: "Kid 1", color: "oklch(0.6 0.18 145)" },
  { name: "Kid 2", color: "oklch(0.7 0.15 55)" },
];

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("family-grocery");

  const [newItem, setNewItem] = React.useState("");
  const [currentMember, setCurrentMember] = React.useState("Mom");
  const [category, setCategory] = React.useState("general");
  const listRef = React.useRef(null);

  const groceries = useLiveQuery("type", { key: "grocery" });
  const items = groceries?.rows?.map(r => r.doc) || [];

  const uncheckedItems = items.filter(i => !i.checked).sort((a, b) => (b.created || 0) - (a.created || 0));
  const checkedItems = items.filter(i => i.checked).sort((a, b) => (b.created || 0) - (a.created || 0));

  const categories = [
    { id: "produce", label: "Produce", icon: "🥬" },
    { id: "dairy", label: "Dairy", icon: "🥛" },
    { id: "meat", label: "Meat", icon: "🍗" },
    { id: "bakery", label: "Bakery", icon: "🍞" },
    { id: "frozen", label: "Frozen", icon: "🧊" },
    { id: "general", label: "Other", icon: "📦" },
  ];

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    await database.put({
      type: "grocery",
      text: newItem.trim(),
      addedBy: currentMember,
      category,
      checked: false,
      created: Date.now(),
    });
    setNewItem("");
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = 0;
    }, 100);
  };

  const toggleItem = async (doc) => {
    await database.put({ ...doc, checked: !doc.checked });
  };

  const deleteItem = async (doc) => {
    await database.del(doc);
  };

  const clearChecked = async () => {
    for (const item of checkedItems) {
      await database.del(item);
    }
  };

  const getMemberColor = (name) => {
    const m = FAMILY_MEMBERS.find(f => f.name === name);
    return m ? m.color : "var(--comp-muted)";
  };

  const getCategoryIcon = (catId) => {
    const c = categories.find(ct => ct.id === catId);
    return c ? c.icon : "📦";
  };

  return (
    <div className="desk-surface">
      {/* @theme:decoration */}
      <div className="desk-texture" />
      <svg style={{ position: "fixed", top: "10%", left: "8%", opacity: 0.08, pointerEvents: "none" }} width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="none" stroke="var(--accent-green)" strokeWidth="1.5" />
        <circle cx="40" cy="40" r="24" fill="none" stroke="var(--accent-blue)" strokeWidth="1" />
        <circle cx="40" cy="40" r="12" fill="none" stroke="var(--accent-yellow)" strokeWidth="0.8" />
        <circle cx="40" cy="8" r="3" fill="var(--accent-green)" />
        <circle cx="68" cy="40" r="3" fill="var(--accent-blue)" />
        <circle cx="40" cy="64" r="2.5" fill="var(--accent-orange)" />
      </svg>
      <svg style={{ position: "fixed", bottom: "15%", right: "5%", opacity: 0.06, pointerEvents: "none" }} width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="var(--accent-blue)" strokeWidth="1" />
        <circle cx="30" cy="30" r="14" fill="none" stroke="var(--accent-orange)" strokeWidth="0.8" />
        <circle cx="30" cy="6" r="2.5" fill="var(--accent-yellow)" />
        <circle cx="54" cy="30" r="2.5" fill="var(--accent-green)" />
      </svg>
      <svg style={{ position: "fixed", top: "50%", left: "3%", opacity: 0.05, pointerEvents: "none" }} width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent-orange)" strokeWidth="1" />
        <circle cx="20" cy="6" r="2" fill="var(--accent-blue)" />
      </svg>
      {/* @theme:decoration:end */}

      <div className="app-frame">
        {/* Header / Awning */}
        <header className="awning">
          <div className="heart-decor heart-left">
            <HeartDoodle size={26} />
          </div>
          <div className="heart-decor heart-right">
            <HeartDoodle size={26} />
          </div>
          <div className="awning-cart"><CartDoodle size={42} /></div>
          <h1 className="awning-title">
            the family <span className="highlight">pantry</span>
          </h1>
          <p className="awning-sub">what do we need today?</p>
        </header>

        {/* Member Selector */}
        <div className="member-bar">
          <span className="member-label">shopping as:</span>
          <div className="member-chips">
            {FAMILY_MEMBERS.map(m => (
              <button
                key={m.name}
                className={`member-chip ${currentMember === m.name ? "active" : ""}`}
                onClick={() => setCurrentMember(m.name)}
                style={{ "--chip-color": m.color }}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable List */}
        <main className="window-display" ref={listRef}>
          {items.length === 0 && (
            <div className="empty-state">
              <EmptyBagDoodle />
              <p className="empty-text">the list is empty!</p>
              <p className="empty-hint">add something below</p>
            </div>
          )}

          {uncheckedItems.map((item, i) => (
            <label
              key={item._id}
              className="list-item"
              style={{ animationDelay: `${i * 0.04}s`, "--tilt": `${(i % 3 - 1) * 0.6}deg` }}
            >
              <input
                type="checkbox"
                className="scrap-checkbox"
                checked={false}
                onChange={() => toggleItem(item)}
              />
              <div className="item-content">
                <span className="item-text">{getCategoryIcon(item.category)} {item.text}</span>
                <span className="item-meta" style={{ color: getMemberColor(item.addedBy) }}>
                  added by {item.addedBy}
                </span>
              </div>
              <button className="delete-btn" onClick={(e) => { e.preventDefault(); deleteItem(item); }}>×</button>
            </label>
          ))}

          {checkedItems.length > 0 && (
            <>
              <div className="checked-divider">
                <svg width="100%" height="16" viewBox="0 0 400 16" preserveAspectRatio="none">
                  <path d="M0 8C50 4 100 12 150 8C200 4 250 12 300 8C350 4 400 12 400 8" fill="none" stroke="var(--comp-border)" strokeWidth="2" strokeDasharray="6 4" opacity="0.3" />
                </svg>
                <span className="checked-label">got it!</span>
                <button className="clear-btn" onClick={clearChecked}>clear all</button>
              </div>
              {checkedItems.map((item, i) => (
                <label
                  key={item._id}
                  className="list-item checked"
                  style={{ "--tilt": `${(i % 3 - 1) * 0.4}deg` }}
                >
                  <input
                    type="checkbox"
                    className="scrap-checkbox"
                    checked={true}
                    onChange={() => toggleItem(item)}
                  />
                  <div className="item-content">
                    <span className="item-text struck">{getCategoryIcon(item.category)} {item.text}</span>
                    <span className="item-meta" style={{ color: getMemberColor(item.addedBy), opacity: 0.5 }}>
                      added by {item.addedBy}
                    </span>
                  </div>
                  <button className="delete-btn" onClick={(e) => { e.preventDefault(); deleteItem(item); }}>×</button>
                </label>
              ))}
            </>
          )}
        </main>

        {/* Input Footer */}
        <footer className="input-area">
          <div className="category-row">
            {categories.map(c => (
              <button
                key={c.id}
                className={`cat-chip ${category === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
                title={c.label}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <form className="input-wrapper" onSubmit={handleAdd}>
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              placeholder="we need..."
              className="scrap-input"
            />
            <button type="submit" className="add-btn">add</button>
          </form>
        </footer>
      </div>
    </div>
  );
}

/* ─── Styles ─── */
const styleTag = document.createElement("style");
styleTag.textContent = `

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap');
/* @theme:typography:end */

/* @theme:tokens */
:root {
  --bg-gradient-from: oklch(0.56 0.29 302)   /* purple-600 body gradient start */;
  --bg-gradient-to:   oklch(0.44 0.22 304)   /* purple-800 body gradient end */;
  --surface:     oklch(0.00 0.000 0)          /* main container black */;
  --card:        oklch(0.18 0.000 0 / 0.8)    /* stat card glass rgba(30,30,30,0.8) */;
  --card-solid:  oklch(0.28 0.03 257)         /* match items gray-800 */;
  --border:      oklch(0.37 0.03 260)         /* concentric rings gray-700 */;
  --fg:          oklch(1.00 0.000 0)          /* primary text white */;
  --fg-muted:    oklch(0.71 0.02 261)         /* labels gray-400 */;
  --fg-dim:      oklch(0.55 0.03 264)         /* inactive nav gray-500 */;
  --accent-green:  oklch(0.79 0.21 152)       /* green-400 */;
  --accent-blue:   oklch(0.71 0.17 255)       /* blue-400 */;
  --accent-yellow: oklch(0.85 0.20 92)        /* yellow-400 */;
  --accent-orange: oklch(0.75 0.18 56)        /* orange-400 */;

  /* comp-* token bridge */
  --comp-bg: var(--surface);
  --comp-text: var(--fg);
  --comp-accent: var(--accent-green);
  --comp-accent-text: oklch(1.00 0 0);
  --comp-muted: var(--fg-muted);
  --comp-border: var(--border);
  --color-background: var(--surface);
  --grid-color: transparent;
}
/* @theme:tokens:end */

/* @theme:motion */
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes gentleFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes checkPop {
  0% { transform: scale(0); }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes progressFill {
  from { width: 0; }
}
/* @theme:motion:end */

/* @theme:surfaces */
.desk-surface {
  min-height: 100vh;
  background-color: var(--color-background);
  font-family: 'Patrick Hand', cursive;
  color: var(--comp-text);
}

.desk-texture {
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(circle at 20% 30%, oklch(0.91 0.04 135 / 0.5) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, oklch(0.91 0.05 100 / 0.3) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.app-frame {
  background-color: var(--scrap-paper);
  border: 3.5px solid var(--comp-border);
  box-shadow: 6px 6px 0 var(--scrap-shadow);
  position: relative;
  overflow: hidden;
  transform: rotate(-0.3deg);
}

.awning {
  background-color: var(--scrap-paper);
  border-bottom: 3.5px solid var(--comp-border);
  text-align: center;
  position: relative;
  z-index: 10;
  background-image:
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 28px,
      oklch(0.8 0.03 220 / 0.12) 28px,
      oklch(0.8 0.03 220 / 0.12) 29px
    );
}

.awning-title {
  font-family: 'Caveat', cursive;
  font-size: clamp(2rem, 6vw, 2.8rem);
  font-weight: 700;
  line-height: 1.1;
  color: var(--comp-text);
  text-transform: lowercase;
  letter-spacing: -0.5px;
}

.highlight {
  background: linear-gradient(170deg, transparent 40%, var(--comp-accent) 40%, var(--comp-accent) 85%, transparent 85%);
  padding: 0 0.3rem;
}

.awning-sub {
  font-family: 'Architects Daughter', cursive;
  font-size: 1rem;
  color: var(--comp-muted);
}

.awning-cart {
  opacity: 0.15;
  position: absolute;
  top: 8px;
  right: 12px;
}

.heart-decor {
  position: absolute;
  z-index: 20;
  pointer-events: none;
}
.heart-left { top: -4px; left: 10px; transform: rotate(-15deg); }
.heart-right { top: -4px; right: 10px; transform: rotate(15deg); }

.member-bar {
  border-bottom: 2px dashed var(--comp-border);
  background: oklch(0.96 0.02 120 / 0.6);
  font-family: 'Architects Daughter', cursive;
  font-size: 0.9rem;
  color: var(--comp-muted);
}

.member-chip {
  font-family: 'Caveat', cursive;
  font-size: 1rem;
  font-weight: 600;
  background: var(--scrap-paper);
  border: 2px solid var(--comp-border);
  color: var(--comp-text);
  cursor: pointer;
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  transition: transform 0.15s, background-color 0.15s, box-shadow 0.15s;
}
.member-chip:hover {
  transform: translateY(-1px) rotate(-1deg);
  box-shadow: 2px 2px 0 var(--scrap-shadow);
}
.member-chip.active {
  background: var(--chip-color, var(--comp-accent));
  color: var(--scrap-paper);
  box-shadow: 3px 3px 0 var(--scrap-shadow);
  transform: rotate(-1.5deg);
}

.window-display {
  background-color: var(--scrap-paper);
  background-image:
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 38px,
      oklch(0.8 0.03 220 / 0.1) 38px,
      oklch(0.8 0.03 220 / 0.1) 39px
    );
}

.window-display::-webkit-scrollbar { width: 10px; }
.window-display::-webkit-scrollbar-track { background: var(--scrap-paper); border-left: 2px solid var(--comp-border); }
.window-display::-webkit-scrollbar-thumb { background-color: var(--comp-border); border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; }

.list-item {
  background-color: var(--scrap-paper);
  border: 2.5px solid var(--comp-border);
  cursor: pointer;
  transform: rotate(var(--tilt, 0deg));
  box-shadow: 3px 3px 0 oklch(0.12 0.01 0 / 0.15);
  animation: fadeSlideIn 0.3s ease both;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.list-item:hover {
  transform: translateY(-2px) rotate(-1deg);
  box-shadow: 5px 5px 0 oklch(0.12 0.01 0 / 0.2);
}
.list-item.checked {
  opacity: 0.55;
  background: oklch(0.96 0.01 90 / 0.7);
}

.scrap-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 26px;
  height: 26px;
  border: 2.5px solid var(--comp-border);
  border-radius: 50%;
  background-color: var(--scrap-paper);
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  display: grid;
  place-content: center;
}
.scrap-checkbox::before {
  content: "";
  width: 15px;
  height: 15px;
  background-color: var(--scrap-red);
  border-radius: 50%;
  transform: scale(0);
  transition: transform 0.15s ease;
}
.scrap-checkbox:checked::before {
  transform: scale(1);
  animation: checkPop 0.25s ease;
}

.item-text {
  font-family: 'Patrick Hand', cursive;
  font-size: 1.15rem;
  font-weight: 400;
  color: var(--comp-text);
  line-height: 1.2;
  word-break: break-word;
}
.item-text.struck {
  text-decoration: line-through;
  text-decoration-thickness: 2.5px;
  text-decoration-color: var(--scrap-red);
  color: var(--comp-muted);
}
.item-meta {
  font-family: 'Architects Daughter', cursive;
  font-size: 0.78rem;
  display: block;
  margin-top: 0.15rem;
  opacity: 0.7;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--scrap-red);
  font-family: 'Caveat', cursive;
  font-size: 1.6rem;
  cursor: pointer;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.2s, transform 0.15s;
}
.list-item:hover .delete-btn { opacity: 1; }
.delete-btn:hover { transform: scale(1.2) rotate(10deg); }

.checked-divider {
  font-family: 'Caveat', cursive;
  color: var(--comp-muted);
}
.checked-label {
  font-size: 1rem;
  font-style: italic;
}
.clear-btn {
  font-family: 'Caveat', cursive;
  font-size: 0.85rem;
  background: none;
  border: 1.5px dashed var(--scrap-red);
  color: var(--scrap-red);
  cursor: pointer;
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  transition: background 0.15s, color 0.15s;
}
.clear-btn:hover {
  background: var(--scrap-red);
  color: var(--scrap-paper);
}

.empty-state {
  font-family: 'Caveat', cursive;
  color: var(--comp-muted);
  text-align: center;
}
.empty-text { font-size: 1.4rem; font-weight: 600; }
.empty-hint { font-size: 1rem; font-family: 'Architects Daughter', cursive; }
.empty-bag-float { animation: gentleFloat 4s ease-in-out infinite; }

.cat-chip {
  background: var(--scrap-paper);
  border: 2px solid var(--comp-border);
  font-size: 1.1rem;
  cursor: pointer;
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  transition: transform 0.12s, box-shadow 0.12s, background 0.12s;
  line-height: 1;
}
.cat-chip:hover { transform: translateY(-1px); box-shadow: 2px 2px 0 var(--scrap-shadow); }
.cat-chip.active {
  background: var(--comp-accent);
  box-shadow: 2px 2px 0 var(--scrap-shadow);
  transform: scale(1.1) rotate(-2deg);
}

.input-area {
  border-top: 3.5px solid var(--comp-border);
  background: var(--scrap-paper);
  z-index: 10;
  position: relative;
}
.input-wrapper {
  border: 3px solid var(--comp-border);
  background: var(--scrap-paper);
}
.scrap-input {
  flex: 1;
  background: transparent;
  border: none;
  font-family: 'Patrick Hand', cursive;
  font-size: 1.15rem;
  color: var(--comp-text);
  outline: none;
}
.scrap-input::placeholder {
  color: var(--comp-muted);
  font-style: italic;
}
.add-btn {
  background-color: var(--scrap-red);
  color: var(--scrap-paper);
  border: 2.5px solid var(--comp-border);
  font-family: 'Caveat', cursive;
  font-weight: 700;
  font-size: 1.3rem;
  cursor: pointer;
  text-transform: lowercase;
  transition: transform 0.1s, background-color 0.15s;
  box-shadow: 2px 2px 0 var(--scrap-shadow);
}
.add-btn:hover { transform: translateY(-1px); box-shadow: 3px 3px 0 var(--scrap-shadow); }
.add-btn:active { transform: translateY(1px); box-shadow: 1px 1px 0 var(--scrap-shadow); background-color: var(--comp-border); }
/* @theme:surfaces:end */

/* ─── Pure Layout (outside theme markers) ─── */
.desk-surface {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2vmin;
}
.app-frame {
  width: 100%;
  max-width: 580px;
  height: 92vh;
  max-height: 900px;
  display: flex;
  flex-direction: column;
}
.awning {
  padding: 1.25rem 1rem 1.5rem;
  position: relative;
}
.member-bar {
  padding: 0.6rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.member-label { flex-shrink: 0; }
.member-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.member-chip { padding: 0.2rem 0.7rem; }
.window-display {
  flex: 1;
  padding: 1rem 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.list-item {
  display: flex;
  align-items: center;
  padding: 0.75rem 0.85rem;
  gap: 0.7rem;
}
.item-content { flex: 1; min-width: 0; }
.delete-btn { padding: 0 0.4rem; }
.checked-divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
}
.checked-divider svg { flex: 1; }
.clear-btn { padding: 0.15rem 0.6rem; flex-shrink: 0; }
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.category-row {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.cat-chip { padding: 0.25rem 0.5rem; }
.input-area { padding: 0.8rem 1rem 1rem; }
.input-wrapper {
  display: flex;
  gap: 0.6rem;
  padding: 0.4rem;
}
.scrap-input { padding: 0.4rem; }
.add-btn { padding: 0.35rem 1.2rem; }

@media (max-width: 480px) {
  .app-frame { height: 100vh; max-height: none; border: none; box-shadow: none; transform: none; }
  .awning { padding: 1rem 0.75rem 1.1rem; }
  .window-display { padding: 0.75rem 0.75rem; }
  .input-area { padding: 0.6rem 0.75rem 0.8rem; }
}
`;
document.head.appendChild(styleTag);

export default App;
