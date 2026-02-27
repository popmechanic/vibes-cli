window.__VIBES_THEMES__ = [{ id: "console", name: "Console Rack" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "console");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

/* ── helpers ── */
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
const pct = (n, d) => d === 0 ? "0.0" : ((n / d) * 100).toFixed(1);

/* ── SVG Icons ── */
function IconPerson({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
    </svg>
  );
}
function IconBuilding({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </svg>
  );
}
function IconHandshake({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11l-2-2-5 5-2-2-5 5" />
      <path d="M4 14l5-5 2 2 5-5 2 2" />
      <path d="M2 16l4-4M18 8l4-4" />
    </svg>
  );
}
function IconChart({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l6.36 3.64" />
    </svg>
  );
}

/* ── Canvas Oscilloscope ── */
function ScreenWave({ count }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let frame, t = 0;
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = "rgba(17,17,17,0.18)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(0,255,136,0.06)";
      ctx.lineWidth = 0.5;
      for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let i = 0; i < 3; i++) {
        const amp = 12 + count * 4 + i * 10;
        const freq = 0.012 + i * 0.007;
        const phase = t * (0.6 + i * 0.4);
        ctx.strokeStyle = `rgba(0,255,136,${0.35 - i * 0.08})`;
        ctx.lineWidth = 1.5 - i * 0.3;
        ctx.shadowColor = "#00ff88";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * freq + phase) * amp + Math.cos(x * 0.018 - phase * 0.6) * amp * 0.3;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      t += 0.025;
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [count]);
  return <canvas ref={ref} width={500} height={240} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />;
}

/* ── SVG Donut Chart ── */
const SEGMENT_COLORS = ["#4466aa", "#00cc66", "#00aa88", "#00ddaa", "#33eebb", "#66ccaa", "#00ff88"];

function DonutChart({ segments }) {
  const r = 55, cx = 100, cy = 100;
  const circ = 2 * Math.PI * r;
  let rotation = -90;
  return (
    <svg viewBox="0 0 200 200" style={{ width: "160px", height: "160px" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#222" strokeWidth="26" />
      {segments.map((seg, i) => {
        const arc = (seg.percent / 100) * circ;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth="24"
            strokeDasharray={`${arc} ${circ}`} transform={`rotate(${rotation} ${cx} ${cy})`}
            style={{ transition: "all 0.6s ease" }} />
        );
        rotation += (seg.percent / 100) * 360;
        return el;
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#00ff88" fontSize="10" fontFamily="Courier New" fontWeight="bold">CAP TABLE</text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill="#008844" fontSize="9" fontFamily="Courier New">BREAKDOWN</text>
    </svg>
  );
}

/* ── LED Indicator ── */
function Led({ active, color = "green", label }) {
  const colors = { green: "#00ff44", blue: "#4488ff", orange: "#ff8800", gray: "#999" };
  const c = colors[color] || colors.green;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{
        width: "7px", height: "7px", borderRadius: "50%",
        background: active ? c : "#333",
        boxShadow: active ? `0 0 8px 2px ${c}66` : "none",
        transition: "all 0.4s ease",
      }} />
      {label && <span style={{ fontFamily: "'Courier New', monospace", fontSize: "9px", textTransform: "uppercase", letterSpacing: "1px", color: "var(--comp-muted)" }}>{label}</span>}
    </div>
  );
}

/* ── Empty State SVG ── */
function EmptySignal() {
  return (
    <svg viewBox="0 0 200 80" style={{ width: "180px", opacity: 0.4 }}>
      <line x1="10" y1="40" x2="190" y2="40" stroke="#00ff88" strokeWidth="0.5" strokeDasharray="4 4">
        <animate attributeName="stroke-dashoffset" from="0" to="8" dur="1s" repeatCount="indefinite" />
      </line>
      <circle cx="100" cy="40" r="3" fill="#00ff88">
        <animate attributeName="r" values="2;5;2" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="100" y="65" textAnchor="middle" fill="#008844" fontSize="9" fontFamily="Courier New">AWAITING SIGNAL</text>
    </svg>
  );
}

/* ── Main App ── */
const VIEWS = [
  { id: "sys", label: "SYS", color: "white", title: "SYSTEM OVERVIEW" },
  { id: "vol", label: "VOL", color: "blue", title: "VOLUNTEER REGISTRY" },
  { id: "org", label: "ORG", color: "gray", title: "ORGANIZATIONS" },
  { id: "mix", label: "MIX", color: "orange", title: "MATCHMAKER" },
  { id: "cap", label: "CAP", color: "green", title: "CAP TABLE" },
];

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("equity-match-demo");

  const volQuery = useLiveQuery("type", { key: "volunteer" });
  const orgQuery = useLiveQuery("type", { key: "org" });
  const matchQuery = useLiveQuery("type", { key: "match" });
  const volunteers = volQuery?.docs ?? [];
  const orgs = orgQuery?.docs ?? [];
  const matchDocs = matchQuery?.docs ?? [];

  const [view, setView] = React.useState("sys");
  const [volName, setVolName] = React.useState("");
  const [volSkills, setVolSkills] = React.useState("");
  const [volHours, setVolHours] = React.useState(20);
  const [orgName, setOrgName] = React.useState("");
  const [orgShares, setOrgShares] = React.useState(1000000);
  const [orgPool, setOrgPool] = React.useState(15);
  const [orgVest, setOrgVest] = React.useState(48);
  const [orgCliff, setOrgCliff] = React.useState(12);
  const [selVol, setSelVol] = React.useState("");
  const [selOrg, setSelOrg] = React.useState("");
  const [mShares, setMShares] = React.useState(10000);
  const [capOrgId, setCapOrgId] = React.useState("");
  const [flash, setFlash] = React.useState("");

  const doFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(""), 2000); };

  /* ── Handlers ── */
  const addVolunteer = async () => {
    if (!volName.trim()) return;
    await database.put({ type: "volunteer", name: volName.trim(), skills: volSkills.trim() || "General", hoursWeek: volHours, created: Date.now() });
    setVolName(""); setVolSkills(""); setVolHours(20);
    doFlash("VOLUNTEER ADDED");
  };
  const addOrg = async () => {
    if (!orgName.trim()) return;
    await database.put({ type: "org", name: orgName.trim(), totalShares: orgShares, poolPercent: orgPool, vestingMonths: orgVest, cliffMonths: orgCliff, created: Date.now() });
    setOrgName(""); setOrgShares(1000000); setOrgPool(15); setOrgVest(48); setOrgCliff(12);
    doFlash("ORGANIZATION ADDED");
  };
  const createMatch = async () => {
    const vol = volunteers.find(v => v._id === selVol);
    const org = orgs.find(o => o._id === selOrg);
    if (!vol || !org || mShares <= 0) return;
    await database.put({ type: "match", volId: vol._id, volName: vol.name, orgId: org._id, orgName: org.name, shares: mShares, status: "active", created: Date.now() });
    setSelVol(""); setMShares(10000);
    doFlash("MATCH CREATED");
  };
  const deleteDoc = async (id) => { await database.del(id); };
  const seedDemo = async () => {
    if (volunteers.length > 0 || orgs.length > 0) return;
    const v1 = await database.put({ type: "volunteer", name: "Alex Chen", skills: "Full Stack Dev", hoursWeek: 20, created: Date.now() });
    const v2 = await database.put({ type: "volunteer", name: "Maya Patel", skills: "UX Design", hoursWeek: 15, created: Date.now() + 1 });
    const v3 = await database.put({ type: "volunteer", name: "Jordan Lee", skills: "Data Science", hoursWeek: 10, created: Date.now() + 2 });
    await database.put({ type: "volunteer", name: "Sam Rodriguez", skills: "Marketing", hoursWeek: 25, created: Date.now() + 3 });
    const o1 = await database.put({ type: "org", name: "NovaTech", totalShares: 10000000, poolPercent: 15, vestingMonths: 48, cliffMonths: 12, created: Date.now() });
    const o2 = await database.put({ type: "org", name: "GreenLoop", totalShares: 5000000, poolPercent: 20, vestingMonths: 36, cliffMonths: 6, created: Date.now() + 1 });
    await database.put({ type: "org", name: "DataForge", totalShares: 8000000, poolPercent: 12, vestingMonths: 48, cliffMonths: 12, created: Date.now() + 2 });
    await database.put({ type: "match", volId: v1.id, volName: "Alex Chen", orgId: o1.id, orgName: "NovaTech", shares: 50000, status: "active", created: Date.now() });
    await database.put({ type: "match", volId: v2.id, volName: "Maya Patel", orgId: o2.id, orgName: "GreenLoop", shares: 40000, status: "active", created: Date.now() + 1 });
    await database.put({ type: "match", volId: v3.id, volName: "Jordan Lee", orgId: o1.id, orgName: "NovaTech", shares: 30000, status: "active", created: Date.now() + 2 });
    doFlash("DEMO DATA LOADED");
  };

  /* ── Cap Table Calc ── */
  const getCapTable = React.useCallback((orgDoc) => {
    if (!orgDoc) return null;
    const poolShares = orgDoc.totalShares * orgDoc.poolPercent / 100;
    const founderShares = orgDoc.totalShares - poolShares;
    const orgMatches = matchDocs.filter(m => m.orgId === orgDoc._id);
    const allocated = orgMatches.reduce((s, m) => s + (m.shares || 0), 0);
    const remaining = poolShares - allocated;
    return {
      total: orgDoc.totalShares, founderShares, founderPct: pct(founderShares, orgDoc.totalShares),
      poolShares, allocated, allocPct: pct(allocated, orgDoc.totalShares),
      remaining, remainPct: pct(remaining, orgDoc.totalShares),
      vols: orgMatches.map(m => ({ name: m.volName, shares: m.shares, pct: pct(m.shares, orgDoc.totalShares), id: m._id })),
    };
  }, [matchDocs]);

  const selOrgDoc = orgs.find(o => o._id === selOrg);
  const selOrgMatches = matchDocs.filter(m => m.orgId === selOrg);
  const selOrgAllocated = selOrgMatches.reduce((s, m) => s + (m.shares || 0), 0);
  const selOrgPool = selOrgDoc ? selOrgDoc.totalShares * selOrgDoc.poolPercent / 100 : 0;
  const selOrgRemaining = selOrgPool - selOrgAllocated;
  const maxShares = Math.max(1000, selOrgRemaining);

  const capOrg = orgs.find(o => o._id === capOrgId);
  const capTable = getCapTable(capOrg);
  const capSegments = React.useMemo(() => {
    if (!capTable) return [];
    const segs = [{ percent: parseFloat(capTable.founderPct), color: SEGMENT_COLORS[0], label: "Founders" }];
    capTable.vols.forEach((v, i) => segs.push({ percent: parseFloat(v.pct), color: SEGMENT_COLORS[(i + 1) % SEGMENT_COLORS.length], label: v.name }));
    if (capTable.remaining > 0) segs.push({ percent: parseFloat(capTable.remainPct), color: "#333", label: "Unallocated" });
    return segs;
  }, [capTable]);

  /* ── Screen Renderers ── */
  const renderScreen = () => {
    switch (view) {
      case "sys": return (
        <div className="screen-sys">
          <ScreenWave count={matchDocs.length + volunteers.length} />
          <div className="screen-overlay">
            <div className="sys-title">EQUITY MATCH MK-II</div>
            <div className="sys-sub">VOLUNTEER ←→ EQUITY PLATFORM v2.0</div>
            <div className="sys-stats">
              <span>VOL:{String(volunteers.length).padStart(3, " ")}</span>
              <span>ORG:{String(orgs.length).padStart(3, " ")}</span>
              <span>MTH:{String(matchDocs.length).padStart(3, " ")}</span>
            </div>
            <div className="sys-divider" />
            {matchDocs.length > 0 ? (
              <div className="sys-activity">
                <div className="sys-label">RECENT MATCHES</div>
                {matchDocs.slice(-4).reverse().map(m => (
                  <div key={m._id} className="activity-line">
                    → {m.volName} → {m.orgName} [{fmtNum(m.shares)} SHR]
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginTop: "16px" }}>
                <EmptySignal />
                <button className="hw-btn-sm" onClick={seedDemo}>LOAD DEMO DATA</button>
              </div>
            )}
          </div>
        </div>
      );
      case "vol": return (
        <div className="screen-list">
          <div className="list-hdr"><span>ID</span><span>NAME</span><span>SKILLS</span><span>HR</span><span></span></div>
          {volunteers.length === 0 && <div className="empty-msg">NO VOLUNTEERS — USE CONTROLS TO ADD →</div>}
          {volunteers.map((v, i) => (
            <div key={v._id} className="list-row">
              <span className="row-id">{String(i + 1).padStart(2, "0")}</span>
              <span className="row-name">{v.name}</span>
              <span className="row-dim">{v.skills}</span>
              <span className="row-val">{v.hoursWeek}H</span>
              <button className="row-del" onClick={() => deleteDoc(v._id)}>×</button>
            </div>
          ))}
        </div>
      );
      case "org": return (
        <div className="screen-list">
          <div className="list-hdr list-hdr-org"><span>ID</span><span>NAME</span><span>SHARES</span><span>POOL</span><span>VEST</span><span></span></div>
          {orgs.length === 0 && <div className="empty-msg">NO ORGANIZATIONS — USE CONTROLS TO ADD →</div>}
          {orgs.map((o, i) => (
            <div key={o._id} className="list-row list-row-org">
              <span className="row-id">{String(i + 1).padStart(2, "0")}</span>
              <span className="row-name">{o.name}</span>
              <span className="row-val">{fmtNum(o.totalShares)}</span>
              <span className="row-val">{o.poolPercent}%</span>
              <span className="row-dim">{o.vestingMonths}MO/{o.cliffMonths}CL</span>
              <button className="row-del" onClick={() => deleteDoc(o._id)}>×</button>
            </div>
          ))}
        </div>
      );
      case "mix": return (
        <div className="screen-mix">
          <div className="mix-panel">
            <div className="mix-icon"><IconPerson size={20} color="#4488ff" /></div>
            <div className="mix-label">VOLUNTEER</div>
            <div className="mix-value">{volunteers.find(v => v._id === selVol)?.name || "───"}</div>
            <div className="mix-sub">{volunteers.find(v => v._id === selVol)?.skills || "SELECT BELOW"}</div>
          </div>
          <div className="mix-arrow">
            <svg viewBox="0 0 60 24" style={{ width: "60px" }}>
              <line x1="5" y1="12" x2="55" y2="12" stroke="#00ff88" strokeWidth="2" strokeDasharray="4 4">
                <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.8s" repeatCount="indefinite" />
              </line>
              <polygon points="50,6 58,12 50,18" fill="#00ff88" />
            </svg>
          </div>
          <div className="mix-panel">
            <div className="mix-icon"><IconBuilding size={20} color="#999" /></div>
            <div className="mix-label">ORGANIZATION</div>
            <div className="mix-value">{orgs.find(o => o._id === selOrg)?.name || "───"}</div>
            <div className="mix-sub">{selOrgDoc ? `POOL: ${fmtNum(selOrgRemaining)} REMAINING` : "SELECT BELOW"}</div>
          </div>
          {selVol && selOrg && (
            <div className="mix-alloc">
              <div className="mix-label">ALLOCATION</div>
              <div className="mix-shares">{fmtNum(mShares)} SHARES</div>
              <div className="mix-pct">({pct(mShares, selOrgDoc?.totalShares || 1)}% OWNERSHIP)</div>
            </div>
          )}
        </div>
      );
      case "cap": return (
        <div className="screen-cap">
          {capTable ? (
            <>
              <div className="cap-chart"><DonutChart segments={capSegments} /></div>
              <div className="cap-breakdown">
                <div className="cap-row"><span className="cap-dot" style={{ background: SEGMENT_COLORS[0] }} /><span>FOUNDERS</span><span>{capTable.founderPct}%</span><span>{fmtNum(capTable.founderShares)}</span></div>
                {capTable.vols.map((v, i) => (
                  <div key={v.id} className="cap-row">
                    <span className="cap-dot" style={{ background: SEGMENT_COLORS[(i + 1) % SEGMENT_COLORS.length] }} />
                    <span>{v.name.toUpperCase()}</span><span>{v.pct}%</span><span>{fmtNum(v.shares)}</span>
                    <button className="row-del" onClick={() => deleteDoc(v.id)}>×</button>
                  </div>
                ))}
                {capTable.remaining > 0 && (
                  <div className="cap-row"><span className="cap-dot" style={{ background: "#333" }} /><span>UNALLOCATED</span><span>{capTable.remainPct}%</span><span>{fmtNum(capTable.remaining)}</span></div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-msg">SELECT AN ORGANIZATION →</div>
          )}
        </div>
      );
      default: return null;
    }
  };

  /* ── Control Renderers ── */
  const renderControls = () => {
    switch (view) {
      case "sys": return (
        <div className="ctrl-sys">
          <div className="ctrl-stat"><Led active={volunteers.length > 0} color="blue" /><span>VOLUNTEERS: {volunteers.length}</span></div>
          <div className="ctrl-stat"><Led active={orgs.length > 0} color="gray" /><span>ORGANIZATIONS: {orgs.length}</span></div>
          <div className="ctrl-stat"><Led active={matchDocs.length > 0} color="orange" /><span>MATCHES: {matchDocs.length}</span></div>
          <div className="ctrl-divider" />
          <div className="ctrl-info"><span>PLATFORM v2.0</span><span>STATUS: NOMINAL</span></div>
          {(volunteers.length > 0 || orgs.length > 0) && (
            <button className="hw-btn-sm" style={{ marginTop: "12px" }} onClick={seedDemo}>LOAD DEMO</button>
          )}
        </div>
      );
      case "vol": return (
        <div className="ctrl-form">
          <label className="ctrl-label">NAME</label>
          <input className="hw-input" value={volName} onChange={e => setVolName(e.target.value)} placeholder="VOLUNTEER NAME" onKeyDown={e => e.key === "Enter" && addVolunteer()} />
          <label className="ctrl-label">SKILLS</label>
          <input className="hw-input" value={volSkills} onChange={e => setVolSkills(e.target.value)} placeholder="SKILL SET" onKeyDown={e => e.key === "Enter" && addVolunteer()} />
          <label className="ctrl-label">HOURS/WK: {volHours}</label>
          <input type="range" className="hw-fader" min="1" max="40" value={volHours} onChange={e => setVolHours(parseInt(e.target.value))} />
          <div className="fader-marks"><span>1</span><span>10</span><span>20</span><span>30</span><span>40</span></div>
          <button className="hw-btn blue" onClick={addVolunteer}><IconPerson size={14} color="#fff" /> ADD VOLUNTEER</button>
        </div>
      );
      case "org": return (
        <div className="ctrl-form">
          <label className="ctrl-label">NAME</label>
          <input className="hw-input" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="ORGANIZATION" onKeyDown={e => e.key === "Enter" && addOrg()} />
          <label className="ctrl-label">TOTAL SHARES: {fmtNum(orgShares)}</label>
          <input type="range" className="hw-fader" min="100000" max="50000000" step="100000" value={orgShares} onChange={e => setOrgShares(parseInt(e.target.value))} />
          <label className="ctrl-label">VOLUNTEER POOL: {orgPool}%</label>
          <input type="range" className="hw-fader accent" min="1" max="50" value={orgPool} onChange={e => setOrgPool(parseInt(e.target.value))} />
          <div className="ctrl-row">
            <div className="ctrl-half">
              <label className="ctrl-label">VEST: {orgVest}MO</label>
              <input type="range" className="hw-fader" min="12" max="60" step="6" value={orgVest} onChange={e => setOrgVest(parseInt(e.target.value))} />
            </div>
            <div className="ctrl-half">
              <label className="ctrl-label">CLIFF: {orgCliff}MO</label>
              <input type="range" className="hw-fader" min="0" max="24" step="3" value={orgCliff} onChange={e => setOrgCliff(parseInt(e.target.value))} />
            </div>
          </div>
          <button className="hw-btn gray" onClick={addOrg}><IconBuilding size={14} color="#fff" /> ADD ORGANIZATION</button>
        </div>
      );
      case "mix": return (
        <div className="ctrl-form">
          {volunteers.length === 0 || orgs.length === 0 ? (
            <div className="ctrl-info" style={{ textAlign: "center", padding: "20px 0" }}>
              <span>REGISTER VOLUNTEERS</span><span>AND ORGANIZATIONS FIRST</span>
            </div>
          ) : (
            <>
              <label className="ctrl-label">SELECT VOLUNTEER</label>
              <div className="btn-grid">
                {volunteers.map(v => (
                  <button key={v._id} className={`hw-btn-sel ${selVol === v._id ? "selected" : ""}`} onClick={() => setSelVol(v._id)}>{v.name}</button>
                ))}
              </div>
              <label className="ctrl-label">SELECT ORGANIZATION</label>
              <div className="btn-grid">
                {orgs.map(o => (
                  <button key={o._id} className={`hw-btn-sel ${selOrg === o._id ? "selected" : ""}`} onClick={() => { setSelOrg(o._id); setMShares(10000); }}>{o.name}</button>
                ))}
              </div>
              {selVol && selOrg && (
                <>
                  <label className="ctrl-label">SHARES: {fmtNum(mShares)}</label>
                  <input type="range" className="hw-fader accent" min="1000" max={maxShares} step="1000" value={Math.min(mShares, maxShares)} onChange={e => setMShares(parseInt(e.target.value))} />
                  <div className="fader-marks"><span>{fmtNum(1000)}</span><span>{fmtNum(Math.round(maxShares / 2))}</span><span>{fmtNum(maxShares)}</span></div>
                  <button className="hw-btn accent" onClick={createMatch}><IconHandshake size={14} color="#fff" /> CREATE MATCH</button>
                </>
              )}
            </>
          )}
        </div>
      );
      case "cap": return (
        <div className="ctrl-form">
          <label className="ctrl-label">SELECT ORGANIZATION</label>
          <div className="btn-grid">
            {orgs.map(o => (
              <button key={o._id} className={`hw-btn-sel ${capOrgId === o._id ? "selected" : ""}`} onClick={() => setCapOrgId(o._id)}>{o.name}</button>
            ))}
          </div>
          {capTable && (
            <div className="cap-stats">
              <div className="stat-row"><span>TOTAL SHARES</span><span>{fmtNum(capTable.total)}</span></div>
              <div className="stat-row"><span>POOL SIZE</span><span>{fmtNum(capTable.poolShares)}</span></div>
              <div className="stat-row"><span>ALLOCATED</span><span>{fmtNum(capTable.allocated)}</span></div>
              <div className="stat-row"><span>REMAINING</span><span>{fmtNum(capTable.remaining)}</span></div>
              <div className="stat-row"><span>VESTING</span><span>{capOrg.vestingMonths}MO</span></div>
              <div className="stat-row"><span>CLIFF</span><span>{capOrg.cliffMonths}MO</span></div>
            </div>
          )}
        </div>
      );
      default: return null;
    }
  };

  const css = `
    /* @theme:tokens */
    :root {
      --comp-bg: oklch(0.93 0.003 265);
      --comp-text: oklch(0.28 0 0);
      --comp-border: oklch(0.82 0.005 265);
      --comp-accent: oklch(0.58 0.20 35);
      --comp-accent-text: oklch(1.00 0 0);
      --comp-muted: oklch(0.55 0 0);
      --color-background: oklch(0.98 0 0);
      --grid-color: transparent;
    }
    /* @theme:tokens:end */

    /* @theme:typography */
    /* Courier New system font — no import needed */
    /* @theme:typography:end */

    /* @theme:surfaces */
    .rack-surface {
      min-height: 100vh;
      background: var(--color-background);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    .device-case {
      width: 100%;
      max-width: 1080px;
      background: linear-gradient(180deg, oklch(0.935 0.004 265) 0%, oklch(0.89 0.006 265) 100%);
      border-radius: 14px;
      border: 2px solid oklch(0.78 0.008 265);
      box-shadow:
        0 1px 0 oklch(0.96 0.002 265),
        0 40px 80px -15px rgba(0,0,0,0.35),
        0 15px 30px -8px rgba(0,0,0,0.18),
        inset 0 1px 0 rgba(255,255,255,0.6);
      overflow: hidden;
    }
    .device-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 20px;
      background: linear-gradient(180deg, oklch(0.91 0.004 265), oklch(0.885 0.005 265));
      border-bottom: 1px solid oklch(0.80 0.006 265);
    }
    .header-left { display: flex; align-items: center; gap: 10px; }
    .power-led {
      display: inline-block;
      width: 8px; height: 8px; border-radius: 50%;
      background: #00ff44;
      box-shadow: 0 0 8px 2px rgba(0,255,68,0.5);
    }
    .model-name {
      font-family: "Courier New", monospace; font-size: 13px; font-weight: bold;
      letter-spacing: 2px; text-transform: uppercase; color: var(--comp-text);
    }
    .model-sub {
      font-family: "Courier New", monospace; font-size: 9px;
      letter-spacing: 1.5px; text-transform: uppercase; color: var(--comp-muted);
    }
    .nav-strip {
      display: flex; gap: 4px; padding: 14px 20px; flex-wrap: wrap;
      background: linear-gradient(180deg, oklch(0.90 0.004 265), oklch(0.92 0.004 265));
      border-bottom: 1px solid oklch(0.82 0.006 265);
    }
    .nav-btn-group { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .nav-label {
      font-family: "Courier New", monospace; font-size: 8px;
      letter-spacing: 1px; text-transform: uppercase; color: var(--comp-muted);
    }
    .btn-nav {
      width: 42px; height: 42px; border-radius: 50%;
      border: 2px solid rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-family: "Courier New", monospace; font-size: 9px; font-weight: bold;
      letter-spacing: 0.5px; color: rgba(0,0,0,0.6); position: relative;
      transition: all 0.1s ease;
      box-shadow: 0 3px 0 rgba(0,0,0,0.2), 0 5px 8px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.4);
    }
    .btn-nav:active {
      transform: translateY(3px);
      box-shadow: 0 0 0 rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.4);
    }
    .btn-nav.active::before {
      content: ""; position: absolute; top: -7px; left: 50%; transform: translateX(-50%);
      width: 5px; height: 5px; border-radius: 50%;
      background: #00ff44; box-shadow: 0 0 6px 2px rgba(0,255,68,0.6);
    }
    .btn-nav.white { background: linear-gradient(180deg, #eee, #ccc); }
    .btn-nav.blue { background: linear-gradient(180deg, #5599dd, #3377bb); color: rgba(255,255,255,0.9); }
    .btn-nav.gray { background: linear-gradient(180deg, #aaa, #888); color: rgba(255,255,255,0.8); }
    .btn-nav.orange { background: linear-gradient(180deg, #ff9933, #cc7722); color: rgba(255,255,255,0.9); }
    .btn-nav.green { background: linear-gradient(180deg, #44cc66, #33aa55); color: rgba(255,255,255,0.9); }

    .device-main { display: grid; grid-template-columns: 1fr 1px minmax(260px, 340px); min-height: 360px; }
    .screen-section { padding: 16px; }
    .divider-line { background: oklch(0.78 0.006 265); box-shadow: 1px 0 0 rgba(255,255,255,0.3); }
    .control-section { padding: 16px; overflow-y: auto; max-height: 450px; }
    .section-label {
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 2px;
      text-transform: uppercase; color: var(--comp-muted);
      margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid oklch(0.84 0.005 265);
    }
    .screen {
      background: #111; border: 4px solid #0a0a0a; border-radius: 8px;
      box-shadow: inset 0 0 30px rgba(0,255,136,0.02), inset 0 2px 8px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.15);
      min-height: 320px; display: flex; flex-direction: column; position: relative; overflow: hidden;
    }
    .screen-bar {
      padding: 6px 12px; background: rgba(0,0,0,0.4);
      font-family: "Courier New", monospace; font-size: 10px;
      letter-spacing: 2px; text-transform: uppercase; color: #00ff88;
    }
    .screen-body {
      flex: 1; padding: 12px;
      font-family: "Courier New", monospace; font-size: 11px; color: #00ff88;
      position: relative; overflow-y: auto;
    }
    .scanlines {
      position: absolute; inset: 0; pointer-events: none;
      background: repeating-linear-gradient(transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
    }
    /* @theme:surfaces:end */

    /* @theme:motion */
    @keyframes flashIn {
      0% { opacity: 0; transform: translateX(-50%) translateY(-4px); }
      20% { opacity: 1; transform: translateX(-50%) translateY(0); }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .flash-msg {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: #111; color: #00ff88;
      font-family: "Courier New", monospace; font-size: 12px; letter-spacing: 2px;
      padding: 8px 20px; border: 2px solid #00ff88; border-radius: 4px;
      box-shadow: 0 0 20px rgba(0,255,136,0.3);
      z-index: 1000; animation: flashIn 2s ease forwards; pointer-events: none;
    }
    /* @theme:motion:end */

    /* Screen content */
    .screen-sys { position: relative; height: 100%; min-height: 260px; }
    .screen-overlay {
      position: relative; z-index: 1; display: flex; flex-direction: column;
      align-items: center; padding-top: 20px; text-align: center;
    }
    .sys-title { font-size: 16px; font-weight: bold; letter-spacing: 4px; color: #00ff88; text-shadow: 0 0 10px rgba(0,255,136,0.4); }
    .sys-sub { font-size: 9px; letter-spacing: 2px; color: #008844; margin-top: 4px; }
    .sys-stats { display: flex; gap: 16px; margin-top: 16px; font-size: 12px; letter-spacing: 1px; color: #00ddaa; }
    .sys-divider { width: 80%; height: 1px; background: rgba(0,255,136,0.15); margin: 12px 0; }
    .sys-label { font-size: 9px; letter-spacing: 2px; color: #008844; margin-bottom: 6px; }
    .sys-activity { width: 100%; max-width: 360px; }
    .activity-line { font-size: 11px; color: #00cc88; padding: 3px 0; animation: fadeIn 0.4s ease; }

    .screen-list { display: flex; flex-direction: column; }
    .list-hdr {
      display: grid; grid-template-columns: 28px 1fr 90px 45px 24px; gap: 6px;
      padding: 4px 0; font-size: 9px; letter-spacing: 1px; color: #008844;
      border-bottom: 1px solid rgba(0,255,136,0.15);
    }
    .list-hdr-org { grid-template-columns: 28px 1fr 60px 45px 70px 24px; }
    .list-row {
      display: grid; grid-template-columns: 28px 1fr 90px 45px 24px; gap: 6px;
      padding: 5px 0; border-bottom: 1px solid rgba(0,255,136,0.06);
      align-items: center; font-size: 11px; animation: fadeIn 0.3s ease;
    }
    .list-row-org { grid-template-columns: 28px 1fr 60px 45px 70px 24px; }
    .row-id { color: #006644; font-size: 10px; }
    .row-name { color: #00ff88; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-dim { color: #008855; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-val { color: #00ddaa; text-align: right; }
    .row-del {
      background: none; border: 1px solid rgba(255,80,80,0.3); color: #ff5050;
      font-size: 12px; cursor: pointer; border-radius: 3px; padding: 0;
      width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s ease;
    }
    .row-del:hover { background: rgba(255,80,80,0.15); border-color: #ff5050; }
    .empty-msg { color: #006644; text-align: center; padding: 40px 0; font-size: 11px; letter-spacing: 1px; }

    .screen-mix {
      display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
      gap: 16px; padding: 16px 0;
    }
    .mix-panel { text-align: center; padding: 12px 20px; border: 1px solid rgba(0,255,136,0.15); border-radius: 6px; min-width: 140px; }
    .mix-icon { margin-bottom: 6px; }
    .mix-label { font-size: 9px; letter-spacing: 2px; color: #008844; margin-bottom: 4px; }
    .mix-value { font-size: 14px; font-weight: bold; color: #00ff88; letter-spacing: 1px; }
    .mix-sub { font-size: 10px; color: #008855; margin-top: 4px; }
    .mix-arrow { color: #00ff88; }
    .mix-alloc { width: 100%; text-align: center; padding-top: 12px; border-top: 1px solid rgba(0,255,136,0.1); }
    .mix-shares { font-size: 18px; font-weight: bold; color: #00ff88; }
    .mix-pct { font-size: 10px; color: #00aa66; }

    .screen-cap { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px 0; }
    .cap-breakdown { width: 100%; }
    .cap-row {
      display: grid; grid-template-columns: 10px 1fr 45px 60px auto; gap: 8px;
      padding: 4px 0; font-size: 10px; align-items: center;
      border-bottom: 1px solid rgba(0,255,136,0.06); animation: fadeIn 0.3s ease;
    }
    .cap-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

    /* Controls */
    .ctrl-form { display: flex; flex-direction: column; gap: 8px; }
    .ctrl-label {
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 1.5px;
      text-transform: uppercase; color: var(--comp-text); margin-top: 4px;
    }
    .hw-input {
      background: #1a1a1a; color: #00ff88; border: 2px solid #333;
      font-family: "Courier New", monospace; font-size: 12px; padding: 8px 10px;
      border-radius: 4px; box-shadow: inset 0 2px 5px rgba(0,0,0,0.5);
      outline: none; width: 100%; box-sizing: border-box; text-transform: uppercase;
      transition: all 0.2s ease;
    }
    .hw-input::placeholder { color: #335544; }
    .hw-input:focus { border-color: #00ff88; box-shadow: inset 0 2px 5px rgba(0,0,0,0.5), 0 0 8px rgba(0,255,136,0.15); }
    .hw-fader {
      -webkit-appearance: none; appearance: none;
      background: #2a2a2a; height: 8px; border-radius: 4px;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); outline: none; width: 100%; cursor: pointer;
    }
    .hw-fader::-webkit-slider-thumb {
      -webkit-appearance: none; width: 18px; height: 26px;
      background: linear-gradient(180deg, #ddd, #aaa); border-radius: 3px; border: 1px solid #888;
      box-shadow: 0 2px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4); cursor: grab;
    }
    .hw-fader::-moz-range-thumb {
      width: 18px; height: 26px;
      background: linear-gradient(180deg, #ddd, #aaa); border-radius: 3px; border: 1px solid #888;
      box-shadow: 0 2px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4); cursor: grab;
    }
    .hw-fader.accent::-webkit-slider-thumb { background: linear-gradient(180deg, #ffaa44, #cc7722); border-color: #aa6611; }
    .hw-fader.accent::-moz-range-thumb { background: linear-gradient(180deg, #ffaa44, #cc7722); border-color: #aa6611; }
    .fader-marks {
      display: flex; justify-content: space-between;
      font-family: "Courier New", monospace; font-size: 8px; color: var(--comp-muted); padding: 0 2px; margin-top: -2px;
    }
    .hw-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px 16px; border: 2px solid rgba(0,0,0,0.15); border-radius: 8px;
      font-family: "Courier New", monospace; font-size: 11px; font-weight: bold;
      letter-spacing: 1.5px; cursor: pointer; transition: all 0.1s ease; margin-top: 8px;
      box-shadow: 0 3px 0 rgba(0,0,0,0.2), 0 5px 8px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.3);
    }
    .hw-btn:active {
      transform: translateY(3px);
      box-shadow: 0 0 0 rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.3);
    }
    .hw-btn.blue { background: linear-gradient(180deg, #5599dd, #3377bb); color: #fff; }
    .hw-btn.gray { background: linear-gradient(180deg, #999, #777); color: #fff; }
    .hw-btn.accent { background: linear-gradient(180deg, #ff9933, #cc7722); color: #fff; }
    .hw-btn.green { background: linear-gradient(180deg, #44cc66, #33aa55); color: #fff; }
    .hw-btn-sm {
      background: #222; color: #00ff88; border: 1px solid #00ff8840;
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 1px;
      padding: 6px 14px; border-radius: 4px; cursor: pointer; transition: all 0.15s ease;
    }
    .hw-btn-sm:hover { border-color: #00ff88; box-shadow: 0 0 8px rgba(0,255,136,0.2); }
    .hw-btn-sel {
      background: #2a2a2a; color: #00cc88; border: 1px solid #444;
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 0.5px;
      padding: 6px 10px; border-radius: 4px; cursor: pointer; transition: all 0.15s ease;
      text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hw-btn-sel:hover { border-color: #00ff88; }
    .hw-btn-sel.selected {
      background: #00ff8820; border-color: #00ff88; color: #00ff88;
      box-shadow: 0 0 8px rgba(0,255,136,0.15);
    }
    .btn-grid { display: flex; flex-wrap: wrap; gap: 6px; }

    .ctrl-sys { display: flex; flex-direction: column; gap: 10px; }
    .ctrl-stat {
      display: flex; align-items: center; gap: 10px;
      font-family: "Courier New", monospace; font-size: 11px; color: var(--comp-text); letter-spacing: 1px;
    }
    .ctrl-divider { height: 1px; background: oklch(0.84 0.005 265); margin: 4px 0; }
    .ctrl-info {
      display: flex; flex-direction: column; gap: 4px;
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 1px; color: var(--comp-muted);
    }
    .ctrl-row { display: flex; gap: 12px; }
    .ctrl-half { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .cap-stats { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .stat-row {
      display: flex; justify-content: space-between;
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 1px;
      color: var(--comp-text); padding: 3px 0; border-bottom: 1px dashed oklch(0.86 0.004 265);
    }
    .stat-row span:last-child { font-weight: bold; color: var(--comp-accent); }

    .device-footer {
      display: flex; justify-content: space-between; align-items: center; padding: 10px 20px;
      background: linear-gradient(180deg, oklch(0.89 0.005 265), oklch(0.875 0.006 265));
      border-top: 1px solid oklch(0.80 0.006 265);
    }
    .led-strip { display: flex; gap: 16px; }
    .footer-text {
      font-family: "Courier New", monospace; font-size: 10px; letter-spacing: 2px; color: var(--comp-muted);
    }

    @media (max-width: 768px) {
      .rack-surface { padding: 12px 8px; }
      .device-main { grid-template-columns: 1fr; }
      .divider-line { height: 1px; box-shadow: 0 1px 0 rgba(255,255,255,0.3); }
      .control-section { max-height: none; }
      .nav-strip { gap: 6px; justify-content: center; }
      .screen { min-height: 260px; }
      .mix-panel { min-width: 110px; padding: 10px 14px; }
    }
  `;

  return (
    <>
      <style>{css}</style>
      <div className="rack-surface">
        {flash && <div className="flash-msg">{flash}</div>}
        <div className="device-case">
          <div className="device-header">
            <div className="header-left">
              <span className="power-led" />
              <span className="model-name">EQUITY MATCH MK-II</span>
            </div>
            <span className="model-sub">VOLUNTEER ←→ EQUITY</span>
          </div>

          <div className="nav-strip">
            {VIEWS.map(v => (
              <div key={v.id} className="nav-btn-group">
                <button className={`btn-nav ${v.color} ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
                  {v.label}
                </button>
                <span className="nav-label">{v.title.split(" ")[0]}</span>
              </div>
            ))}
          </div>

          <div className="device-main">
            <div className="screen-section">
              <div className="screen">
                <div className="screen-bar">{VIEWS.find(v => v.id === view)?.title}</div>
                <div className="screen-body">{renderScreen()}</div>
                <div className="scanlines" />
              </div>
            </div>
            <div className="divider-line" />
            <div className="control-section">
              <div className="section-label">CONTROLS</div>
              {renderControls()}
            </div>
          </div>

          <div className="device-footer">
            <div className="led-strip">
              <Led active={volunteers.length > 0} color="blue" label="VOL" />
              <Led active={orgs.length > 0} color="gray" label="ORG" />
              <Led active={matchDocs.length > 0} color="orange" label="MTH" />
              <Led active color="green" label="SYN" />
            </div>
            <span className="footer-text">
              STATUS: {volunteers.length + orgs.length + matchDocs.length > 0 ? "NOMINAL" : "AWAITING INPUT"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
