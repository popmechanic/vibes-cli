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

/* ── SVG Icons ── */
function SpartanHelmet({ size = 48, color = "var(--comp-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M32 4C18 4 10 16 10 28c0 6 2 11 5 15l2 3v10c0 2 2 4 4 4h22c2 0 4-2 4-4V46l2-3c3-4 5-9 5-15C54 16 46 4 32 4z" fill={color} opacity="0.15" stroke={color} strokeWidth="2.5"/>
      <path d="M16 30h32" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M18 30c0 0 2-8 14-8s14 8 14 8" stroke={color} strokeWidth="2" fill="none"/>
      <rect x="18" y="30" width="28" height="6" rx="2" fill={color} opacity="0.3"/>
      <path d="M22 33h8" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
      <path d="M34 33h8" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
    </svg>
  );
}

function HaloRingIcon({ size = 24, color = "var(--comp-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="10" ry="4" stroke={color} strokeWidth="2" opacity="0.6"/>
      <circle cx="12" cy="12" r="3" fill={color} opacity="0.3"/>
      <circle cx="12" cy="12" r="1.5" fill={color}/>
    </svg>
  );
}

function EnergySwordIcon({ size = 24, color = "oklch(0.75 0.15 200)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 20L10 14" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M10 14L20 4" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
      <path d="M10 14L8 16" stroke={color} strokeWidth="3" strokeLinecap="round"/>
      <circle cx="20" cy="4" r="1.5" fill={color} opacity="0.5">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

function UNSCEagle({ size = 24, color = "var(--comp-muted)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L8 8h8L12 2z" fill={color} opacity="0.6"/>
      <path d="M6 10l6 12 6-12" stroke={color} strokeWidth="2" fill="none"/>
      <path d="M4 10h16" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="2" fill={color} opacity="0.4"/>
    </svg>
  );
}

function CortanaChip({ size = 24, color = "oklch(0.7 0.15 250)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="6" y="2" width="12" height="20" rx="3" stroke={color} strokeWidth="2" opacity="0.6"/>
      <circle cx="12" cy="10" r="4" stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.15">
        <animate attributeName="fillOpacity" values="0.15;0.35;0.15" dur="3s" repeatCount="indefinite"/>
      </circle>
      <path d="M10 18h4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function StarIcon({ filled, color = "var(--comp-accent)" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ cursor: "pointer", transition: "transform 0.15s ease" }}>
      <path
        d="M10 1.5l2.5 5.5 6 .5-4.5 4 1.5 6L10 14.5 4.5 17.5l1.5-6-4.5-4 6-.5z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Animated Background ── */
function HaloRingBackground() {
  const stars = React.useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      cx: Math.random() * 800, cy: Math.random() * 600,
      r: Math.random() * 1.5 + 0.5,
      d1: `${Math.random() * 0.3 + 0.1}`,
      d2: `${Math.random() * 0.6 + 0.3}`,
      dur: `${Math.random() * 4 + 3}s`
    })), []);
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" style={{ opacity: 0.06 }}>
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="oklch(0.75 0.15 200)" />
            <stop offset="100%" stopColor="oklch(0.72 0.18 70)" />
          </linearGradient>
        </defs>
        <g transform="translate(400,300)">
          <ellipse rx="350" ry="120" fill="none" stroke="url(#ringGrad)" strokeWidth="2">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="60s" repeatCount="indefinite"/>
          </ellipse>
          <ellipse rx="280" ry="95" fill="none" stroke="url(#ringGrad)" strokeWidth="1.5" opacity="0.5">
            <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="45s" repeatCount="indefinite"/>
          </ellipse>
          <ellipse rx="200" ry="70" fill="none" stroke="url(#ringGrad)" strokeWidth="1" opacity="0.3">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="80s" repeatCount="indefinite"/>
          </ellipse>
        </g>
        {stars.map((s, i) => (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="oklch(0.85 0.05 70)">
            <animate attributeName="opacity" values={`${s.d1};${s.d2};${s.d1}`} dur={s.dur} repeatCount="indefinite"/>
          </circle>
        ))}
      </svg>
    </div>
  );
}

/* ── Animated Divider ── */
function EnergySwordDivider() {
  return (
    <svg width="100%" height="20" viewBox="0 0 600 20" preserveAspectRatio="none" style={{ display: "block", margin: "1rem 0" }}>
      <defs>
        <linearGradient id="swordGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="oklch(0.75 0.15 200)" stopOpacity="0"/>
          <stop offset="30%" stopColor="oklch(0.75 0.15 200)" stopOpacity="0.8"/>
          <stop offset="50%" stopColor="oklch(0.85 0.12 200)" stopOpacity="1"/>
          <stop offset="70%" stopColor="oklch(0.75 0.15 200)" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="oklch(0.75 0.15 200)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="10" x2="600" y2="10" stroke="url(#swordGrad)" strokeWidth="2"/>
      <circle cx="300" cy="10" r="3" fill="oklch(0.85 0.12 200)">
        <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

/* ── Stats Ring ── */
function StatsRing({ value, max, label, color = "var(--comp-accent)" }) {
  const pct = max > 0 ? value / max : 0;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div style={{ textAlign: "center" }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--comp-border)" strokeWidth="6" opacity="0.3"/>
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 40 40)" style={{ transition: "stroke-dashoffset 0.6s ease" }}/>
        <text x="40" y="44" textAnchor="middle" fill="var(--comp-text)" fontSize="16" fontWeight="700">{value}</text>
      </svg>
      <div style={{ fontSize: "0.75rem", color: "var(--comp-muted)", marginTop: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

/* ── Halo Games Data ── */
const HALO_GAMES = [
  { id: "ce", title: "Halo: Combat Evolved", year: 2001, platform: "Xbox", description: "Master Chief awakens on the mysterious Halo ring. The one that started it all." },
  { id: "2", title: "Halo 2", year: 2004, platform: "Xbox", description: "The Covenant attacks Earth. Dual-wield weapons and play as the Arbiter." },
  { id: "3", title: "Halo 3", year: 2007, platform: "Xbox 360", description: "Finish the fight. The epic conclusion to the original trilogy." },
  { id: "odst", title: "Halo 3: ODST", year: 2009, platform: "Xbox 360", description: "Drop into New Mombasa as an Orbital Drop Shock Trooper." },
  { id: "reach", title: "Halo: Reach", year: 2010, platform: "Xbox 360", description: "Noble Team's last stand. The fall of Reach before Combat Evolved." },
  { id: "4", title: "Halo 4", year: 2012, platform: "Xbox 360", description: "Chief awakens on Requiem. A new enemy, the Didact, threatens humanity." },
  { id: "5", title: "Halo 5: Guardians", year: 2015, platform: "Xbox One", description: "Locke hunts Master Chief. Cortana returns with a dangerous plan." },
  { id: "wars", title: "Halo Wars", year: 2009, platform: "Xbox 360", description: "Real-time strategy on Harvest. Command the crew of the Spirit of Fire." },
  { id: "wars2", title: "Halo Wars 2", year: 2017, platform: "Xbox One", description: "The Spirit of Fire faces the Banished at the Ark." },
  { id: "infinite", title: "Halo Infinite", year: 2021, platform: "Xbox Series", description: "Chief lands on Zeta Halo. Open-world exploration meets classic combat." },
];

/* ── Game Card ── */
function GameCard({ game, entry, onTogglePlayed, onToggleCompleted, onRate, onEditNote, index }) {
  const [expanded, setExpanded] = React.useState(false);
  const [noteText, setNoteText] = React.useState("");
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (entry?.note !== undefined) setNoteText(entry.note);
  }, [entry?.note]);

  const played = entry?.played || false;
  const completed = entry?.completed || false;
  const rating = entry?.rating || 0;

  return (
    <div className="card" style={{
      animationDelay: `${index * 0.06}s`,
      animation: "fadeSlideIn 0.4s ease both",
      transition: "transform 0.2s ease, box-shadow 0.2s ease",
      position: "relative",
      overflow: "hidden",
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 0 20px oklch(0.75 0.15 200 / 0.15)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = ""; }}
    >
      {completed && (
        <div style={{ position: "absolute", top: "0.5rem", right: "0.5rem", background: "oklch(0.72 0.18 70 / 0.15)", borderRadius: "6px", padding: "0.2rem 0.5rem", fontSize: "0.65rem", fontWeight: 700, color: "var(--comp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", border: "1px solid oklch(0.72 0.18 70 / 0.25)" }}>
          Legendary
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <div style={{
          width: 40, height: 40, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
          background: played ? "oklch(0.72 0.18 70 / 0.12)" : "oklch(0.22 0.02 250 / 0.5)",
          border: `2px solid ${played ? "var(--comp-accent)" : "var(--comp-border)"}`,
          transition: "all 0.2s ease", flexShrink: 0,
        }}>
          <HaloRingIcon size={20} color={played ? "var(--comp-accent)" : "var(--comp-muted)"} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, lineHeight: 1.2, color: "var(--comp-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.title}</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.15rem" }}>
            <span className="badge" style={{ fontSize: "0.65rem" }}>{game.year}</span>
            <span style={{ fontSize: "0.7rem", color: "var(--comp-muted)" }}>{game.platform}</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--comp-muted)", margin: "0.5rem 0", lineHeight: 1.5 }}>{game.description}</p>

      <div onClick={() => setExpanded(!expanded)} style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.7rem", color: "oklch(0.75 0.15 200)", cursor: "pointer", marginBottom: expanded ? "0.75rem" : 0, transition: "margin 0.2s ease" }}>
        <EnergySwordIcon size={14} />
        <span>{expanded ? "Collapse" : "Expand Details"}</span>
      </div>

      {expanded && (
        <div style={{ animation: "fadeSlideIn 0.25s ease both" }}>
          <EnergySwordDivider />

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <button className={`btn${played ? "" : " btn-gray"}`} style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem", transition: "all 0.15s ease" }}
              onClick={e => { e.stopPropagation(); onTogglePlayed(); }}>
              {played ? "\u2713 Played" : "Mark Played"}
            </button>
            <button className={`btn${completed ? "" : " btn-gray"}`} style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem", transition: "all 0.15s ease" }}
              onClick={e => { e.stopPropagation(); onToggleCompleted(); }}>
              {completed ? "\u2713 Completed" : "Mark Completed"}
            </button>
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--comp-muted)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Rating</div>
            <div style={{ display: "flex", gap: "0.15rem" }}>
              {[1,2,3,4,5].map(s => (
                <span key={s} onClick={e => { e.stopPropagation(); onRate(s === rating ? 0 : s); }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"} style={{ transition: "transform 0.12s ease" }}>
                  <StarIcon filled={s <= rating} />
                </span>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--comp-muted)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Personal Notes</div>
            {editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <textarea className="input" rows={3} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Your thoughts on this game..." style={{ resize: "vertical", fontSize: "0.8rem" }} onClick={e => e.stopPropagation()} />
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn" style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem" }} onClick={e => { e.stopPropagation(); onEditNote(noteText); setEditing(false); }}>Save</button>
                  <button className="btn btn-gray" style={{ fontSize: "0.7rem", padding: "0.25rem 0.6rem" }} onClick={e => { e.stopPropagation(); setEditing(false); setNoteText(entry?.note || ""); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={e => { e.stopPropagation(); setEditing(true); }}
                style={{ fontSize: "0.8rem", color: entry?.note ? "var(--comp-text)" : "var(--comp-muted)", padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px dashed var(--comp-border)", cursor: "text", minHeight: "2rem", transition: "border-color 0.15s ease", wordBreak: "break-word" }}>
                {entry?.note || "Click to add notes..."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Empty State ── */
function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ margin: "0 auto 1.5rem", display: "block" }}>
        <ellipse cx="60" cy="60" rx="50" ry="18" fill="none" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.3">
          <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="20s" repeatCount="indefinite"/>
        </ellipse>
        <circle cx="60" cy="60" r="12" fill="var(--comp-accent)" opacity="0.15">
          <animate attributeName="r" values="12;15;12" dur="3s" repeatCount="indefinite"/>
        </circle>
        <circle cx="60" cy="60" r="6" fill="var(--comp-accent)" opacity="0.3"/>
        <circle cx="60" cy="35" r="3" fill="oklch(0.75 0.15 200)" opacity="0.5">
          <animate attributeName="cy" values="35;32;35" dur="2s" repeatCount="indefinite"/>
        </circle>
      </svg>
      <h3 style={{ color: "var(--comp-text)", margin: "0 0 0.5rem", fontSize: "1.1rem" }}>Begin Your Campaign</h3>
      <p style={{ color: "var(--comp-muted)", fontSize: "0.85rem", maxWidth: "300px", margin: "0 auto" }}>
        Mark games as played to start tracking your journey through the Halo universe.
      </p>
    </div>
  );
}

/* ── Main App ── */
function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("halo-tracker-db");
  const { docs: entries } = useLiveQuery("type", { key: "game-entry" });
  const [filter, setFilter] = React.useState("all");

  const entryMap = React.useMemo(() => {
    const map = {};
    entries.forEach(e => { map[e.gameId] = e; });
    return map;
  }, [entries]);

  const playedCount = entries.filter(e => e.played).length;
  const completedCount = entries.filter(e => e.completed).length;
  const ratedEntries = entries.filter(e => e.rating > 0);
  const avgRating = ratedEntries.length > 0
    ? (ratedEntries.reduce((sum, e) => sum + e.rating, 0) / ratedEntries.length).toFixed(1)
    : "\u2014";

  const filteredGames = HALO_GAMES.filter(g => {
    if (filter === "played") return entryMap[g.id]?.played;
    if (filter === "unplayed") return !entryMap[g.id]?.played;
    if (filter === "completed") return entryMap[g.id]?.completed;
    return true;
  });

  async function updateEntry(gameId, updates) {
    const existing = entryMap[gameId];
    if (existing) {
      await database.put({ ...existing, ...updates });
    } else {
      await database.put({ type: "game-entry", gameId, played: false, completed: false, rating: 0, note: "", ...updates });
    }
  }

  return (
    <div className="grid-background" style={{ minHeight: "100vh", position: "relative" }}>
      <style>{`
        :root {
          --comp-bg: oklch(0.14 0.03 250);
          --comp-text: oklch(0.92 0.02 70);
          --comp-border: oklch(0.28 0.03 250);
          --comp-accent: oklch(0.72 0.18 70);
          --comp-accent-text: oklch(0.15 0.03 70);
          --comp-muted: oklch(0.55 0.04 250);
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <HaloRingBackground />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem", animation: "fadeSlideIn 0.4s ease both" }}>
          <SpartanHelmet size={52} />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--comp-text)", lineHeight: 1.1 }}>
              HALO <span style={{ color: "var(--comp-accent)" }}>TRACKER</span>
            </h1>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.8rem", color: "var(--comp-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Campaign Progress Database
            </p>
          </div>
        </div>

        <EnergySwordDivider />

        {/* Stats */}
        <div className="card" style={{ animation: "fadeSlideIn 0.4s ease both", animationDelay: "0.1s", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: "1rem" }}>
            <StatsRing value={playedCount} max={HALO_GAMES.length} label="Played" color="oklch(0.75 0.15 200)" />
            <StatsRing value={completedCount} max={HALO_GAMES.length} label="Completed" color="var(--comp-accent)" />
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--comp-accent)", lineHeight: 1 }}>{avgRating}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--comp-muted)", marginTop: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Rating</div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.25rem", flexWrap: "wrap", animation: "fadeSlideIn 0.4s ease both", animationDelay: "0.15s" }}>
          {[
            { key: "all", label: "All Games", icon: <HaloRingIcon size={14} /> },
            { key: "played", label: "Played", icon: <UNSCEagle size={14} /> },
            { key: "unplayed", label: "Unplayed", icon: <CortanaChip size={14} /> },
            { key: "completed", label: "Completed", icon: <EnergySwordIcon size={14} /> },
          ].map(f => (
            <button key={f.key}
              className={`btn${filter === f.key ? "" : " btn-gray"}`}
              style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem", display: "flex", alignItems: "center", gap: "0.3rem", transition: "all 0.15s ease" }}
              onClick={() => setFilter(f.key)}>
              {f.icon} {f.label}
            </button>
          ))}
        </div>

        {/* Game Grid */}
        {filteredGames.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
            {filteredGames.map((game, i) => (
              <GameCard
                key={game.id}
                game={game}
                entry={entryMap[game.id]}
                index={i}
                onTogglePlayed={() => updateEntry(game.id, { played: !entryMap[game.id]?.played })}
                onToggleCompleted={() => updateEntry(game.id, { completed: !entryMap[game.id]?.completed })}
                onRate={(r) => updateEntry(game.id, { rating: r })}
                onEditNote={(note) => updateEntry(game.id, { note })}
              />
            ))}
          </div>
        )}

        {/* Summary Table */}
        <div className="card" style={{ marginTop: "2rem", animation: "fadeSlideIn 0.4s ease both", animationDelay: "0.25s", overflowX: "auto" }}>
          <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "var(--comp-text)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <UNSCEagle size={18} /> Campaign Log
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--comp-border)" }}>
                {["Title", "Year", "Platform", "Played", "Completed", "Rating"].map(h => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "var(--comp-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.7rem" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HALO_GAMES.map(game => {
                const e = entryMap[game.id];
                return (
                  <tr key={game.id} style={{ borderBottom: "1px solid var(--comp-border)", transition: "background 0.15s ease" }}
                    onMouseEnter={ev => ev.currentTarget.style.background = "oklch(0.18 0.02 250 / 0.5)"}
                    onMouseLeave={ev => ev.currentTarget.style.background = ""}>
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 600, color: "var(--comp-text)" }}>{game.title}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--comp-muted)" }}>{game.year}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--comp-muted)" }}>{game.platform}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <span style={{ color: e?.played ? "oklch(0.75 0.15 150)" : "var(--comp-muted)" }}>{e?.played ? "\u2713" : "\u2014"}</span>
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <span style={{ color: e?.completed ? "var(--comp-accent)" : "var(--comp-muted)" }}>{e?.completed ? "\u2713" : "\u2014"}</span>
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {e?.rating > 0 ? (
                        <span style={{ display: "flex", gap: "0.1rem" }}>
                          {[1,2,3,4,5].map(s => <StarIcon key={s} filled={s <= e.rating} color={s <= e.rating ? "var(--comp-accent)" : "var(--comp-border)"} />)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--comp-muted)" }}>{"\u2014"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "2.5rem", animation: "fadeSlideIn 0.4s ease both", animationDelay: "0.3s" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", color: "var(--comp-muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            <UNSCEagle size={16} /> UNSC Database Terminal <UNSCEagle size={16} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;