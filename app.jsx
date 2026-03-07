window.__VIBES_THEMES__ = [{ id: "sensor", name: "Sensor Dashboard" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "sensor");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

const { useFireproofClerk } = window;

/* ─── SVG ICONS ─── */
function FlameIcon({ size = 24, glow = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={glow ? "flame-glow" : ""}>
      <path d="M12 2C12 2 5 10 5 15a7 7 0 0014 0c0-5-7-13-7-13z" fill="var(--accent)" opacity="0.85"/>
      <path d="M12 8c0 0-3 4-3 7a3 3 0 006 0c0-3-3-7-3-7z" fill="var(--accent-weak)" opacity="0.6"/>
      <animateTransform attributeName="transform" type="scale" values="1;1.04;1" dur="1.5s" repeatCount="indefinite" additive="sum" origin="center"/>
    </svg>
  );
}

function CheckSensorIcon({ checked, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={checked ? "var(--accent)" : "var(--stroke)"} strokeWidth="2" fill={checked ? "var(--accent)" : "transparent"} opacity={checked ? 1 : 0.5}/>
      {checked && <path d="M7 12.5l3 3 7-7" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
      {checked && <circle cx="12" cy="12" r="10" stroke="var(--accent)" strokeWidth="1" opacity="0.3">
        <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite"/>
      </circle>}
    </svg>
  );
}

function TargetIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="var(--accent)" stroke="var(--accent)"/>
    </svg>
  );
}

function ChartIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round">
      <polyline points="4,18 8,12 12,15 16,8 20,11"/>
    </svg>
  );
}

/* ─── SPARKLINE ─── */
function Sparkline({ data, width = 120, height = 32 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="sparkline-svg">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#spark-grad)"/>
      <polyline points={points} fill="none" stroke="var(--accent-weak)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {data.length > 0 && (() => {
        const lastX = width;
        const lastY = height - (data[data.length - 1] / max) * (height - 4) - 2;
        return <circle cx={lastX} cy={lastY} r="2.5" fill="var(--accent)"/>;
      })()}
    </svg>
  );
}

/* ─── SEGMENTED PROGRESS BAR ─── */
function SegmentedProgress({ value, total, label }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const segments = 12;
  const filledSegments = Math.round((pct / 100) * segments);
  return (
    <div className="progress-container">
      <div className="progress-header">
        <span className="label-text">{label}</span>
        <span className="accent-num" style={{ fontSize: "1.1rem" }}>{pct}%</span>
      </div>
      <div className="segmented-bar">
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} className={`segment ${i < filledSegments ? "segment-filled" : ""}`}/>
        ))}
      </div>
      <div className="knob-track">
        <div className="knob" style={{ left: `${pct}%` }}/>
      </div>
    </div>
  );
}

/* ─── CONFETTI CANVAS ─── */
function useConfetti() {
  const canvasRef = React.useRef(null);
  const particlesRef = React.useRef([]);
  const animRef = React.useRef(null);
  const activeRef = React.useRef(false);

  const burst = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = [
      "oklch(0.53 0.22 25)", "oklch(0.45 0.19 25)",
      "oklch(0.93 0.005 264)", "oklch(0.63 0.008 264)",
      "oklch(0.60 0.22 25)"
    ];

    const particles = [];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 14 - 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 2,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 1
      });
    }
    particlesRef.current = particles;
    activeRef.current = true;

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.vx *= 0.99;
        p.rotation += p.rotSpeed;
        p.life -= 0.012;
        if (p.life <= 0) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (alive > 0) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        activeRef.current = false;
      }
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animate();
  }, []);

  React.useEffect(() => {
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  return { canvasRef, burst };
}

/* ─── DOT GRID BACKGROUND ─── */
function DotGridBG() {
  return (
    <div className="dot-grid-bg" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      <div className="dot-grid-pattern"/>
      <div className="dot-grid-fade"/>
    </div>
  );
}

/* ─── HELPERS ─── */
function getDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getToday() { return getDayKey(new Date()); }

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(getDayKey(d));
  }
  return days;
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en", { weekday: "short" }).toUpperCase();
}

function calcStreak(completions, habitId) {
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = getDayKey(d);
    if (completions[`${habitId}::${key}`]) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/* ─── MAIN APP ─── */
function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("habit-sensor-db");
  const { canvasRef, burst } = useConfetti();
  const [view, setView] = React.useState("tracker");
  const today = getToday();
  const last7 = getLast7Days();

  // Query habits and completions
  const habitsResult = useLiveQuery("type", { key: "habit" });
  const completionsResult = useLiveQuery("type", { key: "completion" });

  const habits = habitsResult?.rows?.map(r => r.doc) || [];
  const completions = React.useMemo(() => {
    const map = {};
    (completionsResult?.rows || []).forEach(r => {
      const doc = r.doc;
      map[`${doc.habitId}::${doc.day}`] = true;
    });
    return map;
  }, [completionsResult]);

  // New habit form
  const [newHabitName, setNewHabitName] = React.useState("");

  const addHabit = React.useCallback(async () => {
    const name = newHabitName.trim();
    if (!name) return;
    await database.put({ type: "habit", name, createdAt: Date.now() });
    setNewHabitName("");
  }, [newHabitName, database]);

  const toggleCompletion = React.useCallback(async (habitId, day) => {
    const key = `${habitId}::${day}`;
    if (completions[key]) {
      // Find and delete the completion doc
      const rows = completionsResult?.rows || [];
      const match = rows.find(r => r.doc.habitId === habitId && r.doc.day === day);
      if (match) await database.del(match.doc);
    } else {
      await database.put({ type: "completion", habitId, day, completedAt: Date.now() });
      // Check if all habits completed today
      const todayCompletions = habits.filter(h => completions[`${h._id}::${day}`] || h._id === habitId);
      if (todayCompletions.length >= habits.length && habits.length > 0) {
        burst();
      }
    }
  }, [completions, completionsResult, habits, database, burst]);

  const deleteHabit = React.useCallback(async (habit) => {
    // Delete all completions for this habit
    const rows = completionsResult?.rows || [];
    for (const r of rows) {
      if (r.doc.habitId === habit._id) await database.del(r.doc);
    }
    await database.del(habit);
  }, [completionsResult, database]);

  // Stats
  const todayCompleted = habits.filter(h => completions[`${h._id}::${today}`]).length;
  const totalHabits = habits.length;

  // Weekly data per habit
  const getWeeklyData = React.useCallback((habitId) => {
    return last7.map(day => completions[`${habitId}::${day}`] ? 1 : 0);
  }, [last7, completions]);

  // Overall weekly completion rate
  const weeklyOverall = React.useMemo(() => {
    if (habits.length === 0) return last7.map(() => 0);
    return last7.map(day => {
      const done = habits.filter(h => completions[`${h._id}::${day}`]).length;
      return Math.round((done / habits.length) * 100);
    });
  }, [habits, last7, completions]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="sensor-app grid-background" style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <style>{`
        /* @theme:typography */
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        /* @theme:typography:end */

        /* @theme:tokens */
        :root {
          --bg:          oklch(0.10 0.003 264);
          --panel:       oklch(0.16 0.003 264);
          --panel-hi:    oklch(0.19 0.003 264);
          --stroke:      oklch(0.24 0.003 264);
          --bar-bg:      oklch(0.20 0.005 264);
          --muted:       oklch(0.63 0.008 264);
          --text:        oklch(0.93 0.005 264);
          --accent:      oklch(0.53 0.22 25);
          --accent-weak: oklch(0.45 0.19 25);
          --glow:        0 0 0.6rem oklch(0.53 0.22 25 / 0.35);
          --knob-glow:   0 0 0 2px oklch(0.53 0.22 25 / 0.45), 0 0 18px oklch(0.53 0.22 25 / 0.35);

          --comp-bg: var(--bg);
          --comp-text: var(--text);
          --comp-accent: var(--accent);
          --comp-accent-text: oklch(1.00 0 0);
          --comp-muted: var(--muted);
          --comp-border: var(--stroke);
          --color-background: var(--bg);
          --grid-color: transparent;
        }
        /* @theme:tokens:end */

        /* @theme:surfaces */
        .sensor-app {
          font-family: 'Rajdhani', sans-serif;
          color: var(--text);
          background: var(--bg);
        }

        .dot-grid-pattern {
          position: absolute; inset: 0;
          background-image: radial-gradient(circle, oklch(0.25 0.003 264) 1px, transparent 1px);
          background-size: 24px 24px;
          opacity: 0.4;
        }
        .dot-grid-fade {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 30%, var(--bg) 80%);
        }

        .header-bar {
          background: var(--panel);
          box-shadow: inset 0 0 0 1px var(--stroke);
          border-radius: 0 0 14px 14px;
        }
        .model-id {
          font-family: 'IBM Plex Mono', monospace;
          color: var(--accent);
          font-size: 0.75rem;
          text-shadow: var(--glow);
        }
        .header-title {
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--text);
          font-size: 1.1rem;
        }

        .tile {
          background: var(--panel);
          border-radius: 14px;
          box-shadow: inset 0 0 0 1px var(--stroke);
          transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }
        .tile:hover {
          background: var(--panel-hi);
          transform: translateY(-2px);
          box-shadow: inset 0 0 0 1px var(--stroke), 0 4px 20px oklch(0 0 0 / 0.3);
        }

        .label-text {
          font-family: 'Rajdhani', sans-serif;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--muted);
          font-size: 0.7rem;
        }

        .accent-num {
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 500;
          color: var(--accent);
          text-shadow: var(--glow);
        }

        .data-text {
          font-family: 'IBM Plex Mono', monospace;
          color: var(--text);
        }

        .habit-name {
          font-family: 'Rajdhani', sans-serif;
          font-weight: 600;
          color: var(--text);
          font-size: 1rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .segmented-bar {
          background: var(--bar-bg);
          border-radius: 6px;
          overflow: hidden;
        }
        .segment {
          background: var(--bar-bg);
          border-right: 1px solid oklch(0.14 0.003 264);
          transition: background 0.3s ease;
        }
        .segment:last-child { border-right: none; }
        .segment-filled {
          background: var(--accent);
          box-shadow: 0 0 8px oklch(0.53 0.22 25 / 0.3);
        }
        .knob-track {
          height: 4px;
        }
        .knob {
          width: 10px; height: 10px;
          background: var(--accent);
          border-radius: 50%;
          box-shadow: var(--knob-glow);
          transition: left 0.3s ease;
          transform: translate(-50%, -50%);
        }

        .check-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0;
          transition: transform 0.15s ease;
        }
        .check-btn:hover { transform: scale(1.15); }
        .check-btn:active { transform: scale(0.9); }

        .add-input {
          background: transparent;
          border: 1px solid var(--stroke);
          border-radius: 8px;
          color: var(--text);
          font-family: 'Rajdhani', sans-serif;
          font-size: 0.95rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          outline: none;
          transition: border-color 0.2s ease;
        }
        .add-input:focus {
          border-color: var(--accent);
        }
        .add-input::placeholder {
          color: var(--muted);
          opacity: 0.6;
        }

        .add-btn {
          background: transparent;
          border: 1px solid var(--accent);
          border-radius: 8px;
          color: var(--accent);
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .add-btn:hover {
          background: var(--accent);
          color: var(--bg);
        }

        .delete-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 1rem;
          opacity: 0;
          transition: opacity 0.2s ease, color 0.2s ease;
        }
        .tile:hover .delete-btn { opacity: 1; }
        .delete-btn:hover { color: var(--accent); }

        .nav-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          font-family: 'Rajdhani', sans-serif;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 0.75rem;
          cursor: pointer;
          transition: color 0.2s ease;
        }
        .nav-btn.active { color: var(--accent); text-shadow: var(--glow); }
        .nav-btn:hover { color: var(--text); }

        .footer-bar {
          background: var(--panel);
          box-shadow: inset 0 0 0 1px var(--stroke);
          border-radius: 14px 14px 0 0;
        }
        .footer-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.65rem;
          color: var(--muted);
        }
        .footer-val {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.7rem;
          color: var(--accent);
          text-shadow: var(--glow);
        }

        .sparkline-svg { opacity: 0.8; }

        .weekly-bar {
          background: var(--bar-bg);
          border-radius: 3px;
          overflow: hidden;
          transition: height 0.3s ease;
        }
        .weekly-bar-fill {
          background: var(--accent);
          border-radius: 3px;
          transition: height 0.4s ease;
          box-shadow: 0 0 6px oklch(0.53 0.22 25 / 0.3);
        }
        .weekly-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.6rem;
          color: var(--muted);
        }
        .weekly-pct {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.55rem;
          color: var(--accent);
        }

        .empty-state-text {
          font-family: 'Rajdhani', sans-serif;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .streak-badge {
          background: oklch(0.53 0.22 25 / 0.12);
          border: 1px solid oklch(0.53 0.22 25 / 0.25);
          border-radius: 6px;
          color: var(--accent);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.7rem;
          font-weight: 500;
        }

        .section-label {
          font-family: 'IBM Plex Mono', monospace;
          color: var(--accent);
          font-size: 0.65rem;
          text-shadow: var(--glow);
          text-transform: uppercase;
          letter-spacing: 0.15em;
        }

        .confetti-canvas {
          pointer-events: none;
        }
        /* @theme:surfaces:end */

        /* @theme:motion */
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes tile-enter {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scan-line {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }

        .tile { animation: tile-enter 0.4s ease both; }
        .tile:nth-child(1) { animation-delay: 0.05s; }
        .tile:nth-child(2) { animation-delay: 0.1s; }
        .tile:nth-child(3) { animation-delay: 0.15s; }
        .tile:nth-child(4) { animation-delay: 0.2s; }
        .tile:nth-child(5) { animation-delay: 0.25s; }
        .tile:nth-child(6) { animation-delay: 0.3s; }

        .scan-line-el {
          background: linear-gradient(to bottom, transparent, oklch(0.53 0.22 25 / 0.04), transparent);
          animation: scan-line 8s linear infinite;
          pointer-events: none;
        }
        /* @theme:motion:end */

        /* Layout-only */
        .sensor-app { position: relative; }
        .app-content { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 0 1rem 5rem; }
        .header-bar { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.25rem; position: sticky; top: 0; z-index: 10; }
        .progress-container { padding: 0.75rem 1rem; }
        .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
        .segmented-bar { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; height: 8px; }
        .knob-track { position: relative; margin-top: 2px; }
        .knob { position: absolute; top: 0; }
        .tile { padding: 1rem; margin-bottom: 0.75rem; }
        .habit-row { display: flex; align-items: center; gap: 0.75rem; }
        .habit-info { flex: 1; min-width: 0; }
        .habit-meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.35rem; }
        .sparkline-row { margin-top: 0.5rem; display: flex; align-items: center; justify-content: space-between; }
        .add-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .add-input { flex: 1; padding: 0.6rem 0.8rem; }
        .add-btn { padding: 0.6rem 1rem; white-space: nowrap; }
        .section-header { display: flex; align-items: center; gap: 0.5rem; margin: 1.25rem 0 0.75rem; }
        .footer-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1.25rem; }
        .footer-group { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
        .nav-group { display: flex; gap: 1.5rem; }
        .weekly-chart { display: flex; align-items: flex-end; gap: 0.5rem; justify-content: space-between; }
        .weekly-col { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; flex: 1; }
        .weekly-bar { width: 100%; }
        .confetti-canvas { position: fixed; inset: 0; z-index: 100; }
        .scan-line-el { position: fixed; inset: 0; z-index: 1; height: 100%; }
        .streak-badge { padding: 0.15rem 0.4rem; display: inline-flex; align-items: center; gap: 0.25rem; }
        .delete-btn { padding: 0.25rem; display: flex; align-items: center; }
        .empty-state { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; }
        .habit-tiles { display: grid; grid-template-columns: 1fr; gap: 0; }
        @media (min-width: 520px) {
          .habit-tiles { grid-template-columns: 1fr 1fr; gap: 0.75rem; }
          .habit-tiles .tile { margin-bottom: 0; }
        }
      `}</style>

      {/* @theme:decoration */}
      <DotGridBG/>
      <div className="scan-line-el"/>
      {/* @theme:decoration:end */}

      <canvas ref={canvasRef} className="confetti-canvas"/>

      <div className="app-content">
        {/* Header */}
        <div className="header-bar">
          <span className="model-id">SYS-HBT</span>
          <span className="header-title">Habit Sensor</span>
          <span className="model-id">{timeStr}</span>
        </div>

        {/* Daily progress */}
        {totalHabits > 0 && (
          <div className="tile" style={{ marginTop: "1rem" }}>
            <SegmentedProgress value={todayCompleted} total={totalHabits} label="Today's completion"/>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "center", gap: "2rem", margin: "1rem 0" }}>
          <button className={`nav-btn ${view === "tracker" ? "active" : ""}`} onClick={() => setView("tracker")}>
            <TargetIcon size={14}/> Tracker
          </button>
          <button className={`nav-btn ${view === "weekly" ? "active" : ""}`} onClick={() => setView("weekly")}>
            <ChartIcon size={14}/> Weekly
          </button>
        </div>

        {view === "tracker" && (
          <>
            {/* Add Habit */}
            <div className="section-header">
              <span className="section-label">H-01 Add Sensor</span>
            </div>
            <form className="add-form" onSubmit={(e) => { e.preventDefault(); addHabit(); }}>
              <input
                className="add-input"
                type="text"
                placeholder="New habit name..."
                value={newHabitName}
                onChange={(e) => setNewHabitName(e.target.value)}
              />
              <button type="submit" className="add-btn">+ Add</button>
            </form>

            {/* Habits List */}
            <div className="section-header">
              <span className="section-label">H-02 Active Sensors</span>
              <span className="label-text" style={{ marginLeft: "auto" }}>{totalHabits} registered</span>
            </div>

            {habits.length === 0 ? (
              <div className="tile">
                <div className="empty-state">
                  <TargetIcon size={48}/>
                  <span className="empty-state-text">Zero sensors registered</span>
                  <span className="label-text">Add a habit above to begin tracking</span>
                </div>
              </div>
            ) : (
              <div className="habit-tiles">
                {habits.sort((a, b) => a.createdAt - b.createdAt).map((habit, idx) => {
                  const isCompleted = completions[`${habit._id}::${today}`];
                  const streak = calcStreak(completions, habit._id);
                  const weekData = getWeeklyData(habit._id);
                  const weekDone = weekData.filter(v => v > 0).length;

                  return (
                    <div key={habit._id} className="tile">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span className="label-text">H-{String(idx + 1).padStart(2, "0")}</span>
                        <button className="delete-btn" onClick={() => deleteHabit(habit)} title="Remove">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                      <div className="habit-row" style={{ marginTop: "0.35rem" }}>
                        <button className="check-btn" onClick={() => toggleCompletion(habit._id, today)}>
                          <CheckSensorIcon checked={isCompleted} size={28}/>
                        </button>
                        <div className="habit-info">
                          <div className="habit-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{habit.name}</div>
                          <div className="habit-meta">
                            {streak > 0 && (
                              <span className="streak-badge">
                                <FlameIcon size={12} glow/> {streak}d
                              </span>
                            )}
                            <span className="label-text">{weekDone}/7 this week</span>
                          </div>
                        </div>
                        <span className="accent-num" style={{ fontSize: "1.5rem" }}>{streak}</span>
                      </div>
                      <div className="sparkline-row">
                        <Sparkline data={weekData} width={100} height={24}/>
                        <span className="label-text">7d trend</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === "weekly" && (
          <>
            <div className="section-header">
              <span className="section-label">H-03 Weekly Analysis</span>
            </div>

            {/* Overall weekly chart */}
            <div className="tile">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <span className="label-text">Completion Rate</span>
                <span className="label-text">Last 7 Days</span>
              </div>
              <div className="weekly-chart" style={{ height: "120px" }}>
                {last7.map((day, i) => {
                  const pct = weeklyOverall[i];
                  return (
                    <div key={day} className="weekly-col">
                      <span className="weekly-pct">{pct}%</span>
                      <div className="weekly-bar" style={{ height: "80px" }}>
                        <div className="weekly-bar-fill" style={{ height: `${pct}%`, marginTop: "auto", position: "relative", top: `${100 - pct}%` }}/>
                      </div>
                      <span className="weekly-label">{getDayLabel(day)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="sparkline-row" style={{ marginTop: "0.75rem" }}>
                <Sparkline data={weeklyOverall} width={200} height={28}/>
                <span className="label-text">Trend</span>
              </div>
            </div>

            {/* Per-habit weekly */}
            {habits.length === 0 ? (
              <div className="tile" style={{ marginTop: "0.75rem" }}>
                <div className="empty-state">
                  <ChartIcon size={48}/>
                  <span className="empty-state-text">No data yet</span>
                  <span className="label-text">Add habits and check them off to see trends</span>
                </div>
              </div>
            ) : (
              <div className="habit-tiles" style={{ marginTop: "0.75rem" }}>
                {habits.sort((a, b) => a.createdAt - b.createdAt).map((habit, idx) => {
                  const weekData = getWeeklyData(habit._id);
                  const streak = calcStreak(completions, habit._id);
                  const weekDone = weekData.filter(v => v > 0).length;
                  const weekPct = Math.round((weekDone / 7) * 100);

                  return (
                    <div key={habit._id} className="tile">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="label-text">H-{String(idx + 1).padStart(2, "0")}</span>
                        <span className="accent-num" style={{ fontSize: "1.2rem" }}>{weekPct}%</span>
                      </div>
                      <div className="habit-name" style={{ margin: "0.35rem 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{habit.name}</div>
                      <div className="weekly-chart" style={{ height: "60px", marginBottom: "0.35rem" }}>
                        {last7.map((day, i) => {
                          const done = weekData[i];
                          return (
                            <div key={day} className="weekly-col">
                              <div className="weekly-bar" style={{ height: "40px" }}>
                                <div className="weekly-bar-fill" style={{ height: done ? "100%" : "0%", position: "relative", top: done ? "0" : "100%" }}/>
                              </div>
                              <span className="weekly-label">{getDayLabel(day).charAt(0)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="streak-badge">
                          <FlameIcon size={12}/> {streak}d streak
                        </span>
                        <span className="label-text">{weekDone}/7</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="footer-bar">
        <div className="footer-group">
          <span className="footer-label">SYNC</span>
          <span className="footer-val">{timeStr}</span>
        </div>
        <div className="nav-group">
          <button className={`nav-btn ${view === "tracker" ? "active" : ""}`} onClick={() => setView("tracker")}>Track</button>
          <button className={`nav-btn ${view === "weekly" ? "active" : ""}`} onClick={() => setView("weekly")}>Analyze</button>
        </div>
        <div className="footer-group">
          <span className="footer-label">PERIOD</span>
          <span className="footer-val">7D</span>
        </div>
      </div>
    </div>
  );
}

export default App;
