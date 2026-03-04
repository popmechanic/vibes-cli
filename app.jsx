window.__VIBES_THEMES__ = [{ id: "snowbound", name: "Snowbound" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "snowbound");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

const STYLE = `
:root {
    --comp-bg: oklch(0.99 0.003 240);
    --comp-text: oklch(0.22 0.025 250);
    --comp-border: oklch(0.88 0.012 235);
    --comp-accent: oklch(0.55 0.19 250);
    --comp-accent-text: oklch(0.99 0 0);
    --comp-muted: oklch(0.55 0.02 250);
    --color-background: oklch(0.95 0.015 230);
    --grid-color: oklch(0.85 0.02 240 / 0.12);
}

@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');

* { box-sizing: border-box; }

html, body {
  font-family: 'Inter', sans-serif;
  background: var(--color-background);
  color: var(--comp-text);
  margin: 0;
}

.pitch-app {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: var(--color-background);
}

.pitch-canvas {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.pitch-content {
  position: relative;
  z-index: 1;
  max-width: 1280px;
  margin: 0 auto;
  padding: 1rem;
}

.pitch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--comp-border);
  margin-bottom: 1.5rem;
}

.pitch-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pitch-title .accent-dot {
  width: 10px;
  height: 10px;
  background: var(--comp-accent);
  display: inline-block;
}

.pitch-live {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Grotesk', monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--comp-accent);
}

.pitch-live-dot {
  width: 8px;
  height: 8px;
  background: var(--comp-accent);
  animation: livePulse 2s ease-in-out infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

.pitch-nav {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  overflow-x: auto;
  padding: 0.25rem;
}

.pitch-nav button {
  font-family: 'Nunito', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.6rem 1.2rem;
  background: var(--comp-bg);
  color: var(--comp-muted);
  border: 1px solid var(--comp-border);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.pitch-nav button:last-child { }

.pitch-nav button.active {
  background: var(--comp-accent);
  color: var(--comp-accent-text);
  border-color: var(--comp-accent);
}

.pitch-nav button:hover {
  background: oklch(0.93 0.01 240);
  color: var(--comp-text);
}

.pitch-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 768px) {
  .pitch-layout {
    grid-template-columns: 1fr 280px;
  }
}

.pitch-main {
  background: var(--color-background);
  padding: 1rem;
}

.pitch-sidebar {
  background: var(--color-background);
  padding: 1rem;
  border-top: 1px solid var(--comp-border);
}

@media (min-width: 768px) {
  .pitch-sidebar { border-top: none; }
}

.pitch-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 640px) {
  .pitch-grid { grid-template-columns: 1fr 1fr; }
}

@media (min-width: 1024px) {
  .pitch-grid { grid-template-columns: 1fr 1fr 1fr; }
}

.metric-card {
  background: var(--comp-bg);
  padding: 1.25rem;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  border: none;
  border-radius: 16px;
  box-shadow: 0 2px 12px oklch(0.22 0.02 250 / 0.07);
  animation: cardFadeIn 0.4s ease both;
}

.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px oklch(0.22 0.02 250 / 0.12);
}

.metric-card.highlight {
  background: var(--comp-accent);
  color: var(--comp-accent-text);
}

.metric-card.highlight .metric-label,
.metric-card.highlight .metric-sublabel {
  color: var(--comp-accent-text);
  opacity: 0.7;
}

.metric-card.highlight .metric-value {
  color: var(--comp-accent-text);
}

@keyframes cardFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.metric-label {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--comp-muted);
  margin-bottom: 0.75rem;
}

.metric-value {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 0.25rem;
  font-variant-numeric: tabular-nums;
}

.metric-sublabel {
  font-size: 0.75rem;
  color: var(--comp-muted);
}

.image-card {
  position: relative;
  min-height: 200px;
  overflow: hidden;
  background: var(--comp-bg);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 1.25rem;
  border-radius: 16px;
  box-shadow: 0 2px 12px oklch(0.22 0.02 250 / 0.07);
  animation: cardFadeIn 0.4s ease both;
}

.image-card .card-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.55;
  border-radius: 16px;
}

.image-card .card-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--comp-bg) 20%, transparent 80%);
}

.image-card .card-content {
  position: relative;
  z-index: 1;
}

.sport-icon-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

.sport-icon {
  width: 32px;
  height: 32px;
  padding: 4px;
  border: 1px solid var(--comp-border);
  color: var(--comp-muted);
  transition: color 0.2s, border-color 0.2s;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sport-icon:hover,
.sport-icon.active {
  color: var(--comp-accent);
  border-color: var(--comp-accent);
}

.feed-section-title {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--comp-muted);
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--comp-border);
}

.feed-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid oklch(0.85 0.01 240 / 0.2);
  font-size: 0.8rem;
  animation: feedSlide 0.3s ease both;
}

@keyframes feedSlide {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

.feed-item:last-child { border-bottom: none; }

.feed-time {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.7rem;
  color: var(--comp-muted);
  white-space: nowrap;
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}

.feed-text {
  flex: 1;
  word-break: break-word;
}

.feed-text strong {
  color: var(--comp-accent);
}

.athlete-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--comp-border);
  background: var(--comp-bg);
  margin-bottom: 1rem;
}

.athlete-form .form-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.athlete-form input,
.athlete-form select {
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-background);
  border: 1px solid var(--comp-border);
  color: var(--comp-text);
  flex: 1;
  min-width: 100px;
  outline: none;
  transition: border-color 0.2s;
}

.athlete-form input:focus,
.athlete-form select:focus {
  border-color: var(--comp-accent);
}

.athlete-form label {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--comp-muted);
}

.btn-accent {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.6rem 1.2rem;
  background: var(--comp-accent);
  color: var(--comp-accent-text);
  border: none;
  cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s, transform 0.1s;
}

.btn-accent:hover { opacity: 0.9; }
.btn-accent:active { transform: scale(0.97); }

.btn-danger {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.3rem 0.6rem;
  background: transparent;
  color: oklch(0.65 0.2 25);
  border: 1px solid oklch(0.65 0.2 25 / 0.3);
  cursor: pointer;
  transition: background 0.2s;
}

.btn-danger:hover {
  background: oklch(0.65 0.2 25 / 0.15);
}

.athlete-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.athlete-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--comp-bg);
  font-size: 0.8rem;
  animation: cardFadeIn 0.3s ease both;
}

@media (max-width: 640px) {
  .athlete-row {
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
  }
  .athlete-index,
  .athlete-sport { display: none; }
}

.athlete-index {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.6rem;
  color: var(--comp-muted);
  letter-spacing: 0.1em;
}

.athlete-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.athlete-sport {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--comp-muted);
  border: 1px solid var(--comp-border);
  padding: 0.15rem 0.5rem;
  white-space: nowrap;
}

.athlete-rating {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--comp-accent);
  white-space: nowrap;
}

.sparkline-container {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--comp-border);
  background: var(--comp-bg);
  overflow: hidden;
}

.sparkline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-label {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--comp-muted);
  margin-bottom: 1rem;
}

.divider-svg {
  width: 100%;
  height: 40px;
  margin: 1.5rem 0;
  display: block;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--comp-muted);
}

.empty-state svg {
  margin: 0 auto 1.5rem;
  display: block;
}

.empty-state p {
  font-size: 0.8rem;
  max-width: 280px;
  margin: 0 auto;
  line-height: 1.5;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1px;
}

@media (min-width: 640px) {
  .stats-row { grid-template-columns: repeat(4, 1fr); }
}

.danger-bar {
  height: 4px;
  background: var(--comp-border);
  margin-top: 0.5rem;
  position: relative;
  overflow: hidden;
}

.danger-bar-fill {
  height: 100%;
  background: var(--comp-accent);
  transition: width 0.6s ease;
}

.pitch-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.pitch-table thead th {
  font-family: 'Space Grotesk', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--comp-muted);
  text-align: left;
  padding: 0.6rem 0.75rem;
  border-bottom: 2px solid var(--comp-border);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}

.pitch-table thead th:hover {
  color: var(--comp-accent);
}

.pitch-table tbody tr {
  border-bottom: 1px solid oklch(0.85 0.01 240 / 0.2);
  animation: cardFadeIn 0.3s ease both;
  transition: background 0.2s;
}

.pitch-table tbody tr:hover {
  background: oklch(0.30 0.055 163);
}

.pitch-table td {
  padding: 0.6rem 0.75rem;
  font-variant-numeric: tabular-nums;
}

.pitch-table .col-rating {
  color: var(--comp-accent);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
}

.pitch-table .col-sport {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--comp-muted);
}

.pitch-table .col-pb {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
}

.sort-arrow {
  display: inline-block;
  margin-left: 0.3rem;
  font-size: 0.55rem;
  color: var(--comp-accent);
}

.sport-anim-wrap {
  display: flex;
  justify-content: center;
  margin-top: 0.75rem;
  height: 44px;
}
`;

const SPORTS = [
  { id: "base", name: "BASE Jumping", unit: "ft", metric: "Altitude" },
  { id: "surf", name: "Big Wave Surf", unit: "ft", metric: "Wave Height" },
  { id: "moto", name: "Freestyle MX", unit: "pts", metric: "Score" },
  { id: "climb", name: "Ice Climbing", unit: "m", metric: "Ascent" },
];

const SPORT_IMAGES = {
  base: "https://images.unsplash.com/photo-1601024445121-e5b839c267ee?w=600&q=75",
  surf: "https://images.unsplash.com/photo-1502680390548-bdbac40e4a9f?w=600&q=75",
  moto: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=75",
  climb: "https://images.unsplash.com/photo-1522163182402-834f871fd851?w=600&q=75",
};

/* ── TYPEWRITER ── */

function Typewriter({ text, speed = 50 }) {
  const [displayed, setDisplayed] = React.useState("");
  const [showCursor, setShowCursor] = React.useState(true);
  const reducedMotion = React.useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  React.useEffect(() => {
    if (reducedMotion.current) { setDisplayed(text); return; }
    let i = 0;
    setDisplayed("");
    const timer = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, i + 1)); i++; }
      else clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  React.useEffect(() => {
    if (reducedMotion.current) { setShowCursor(false); return; }
    const blink = setInterval(() => setShowCursor(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

  return (
    <span>
      {displayed}
      <span style={{ opacity: showCursor ? 1 : 0, transition: "opacity 0.1s", color: "var(--comp-accent)" }}>|</span>
    </span>
  );
}

/* ── SVG ICONS ── */

function ParachuteIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M4 10C4 5.58 7.58 2 12 2s8 3.58 8 8">
        <animate attributeName="d" values="M4 10C4 5.58 7.58 2 12 2s8 3.58 8 8;M4 11C4 6.58 7.58 3 12 3s8 3.58 8 8;M4 10C4 5.58 7.58 2 12 2s8 3.58 8 8" dur="4s" repeatCount="indefinite"/>
      </path>
      <line x1="4" y1="10" x2="12" y2="18"/>
      <line x1="20" y1="10" x2="12" y2="18"/>
      <line x1="12" y1="2" x2="12" y2="18"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
    </svg>
  );
}

function WaveIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0">
        <animate attributeName="d" values="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0;M2 13c2-4 4-4 6 0s4 4 6 0 4-4 6 0;M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" dur="3s" repeatCount="indefinite"/>
      </path>
      <path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" opacity="0.5">
        <animate attributeName="d" values="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0;M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0;M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" dur="3.5s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}

function MotoIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <circle cx="5" cy="17" r="3"/>
      <circle cx="19" cy="17" r="3"/>
      <path d="M5 14l4-7h4l2 3h4"/>
      <path d="M13 7l-3 7"/>
    </svg>
  );
}

function IceAxeIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M6 2l3 3-1 1 5 5"/>
      <path d="M13 11l5 5"/>
      <path d="M18 16l4 4"/>
      <path d="M14 10l-2 2"/>
      <path d="M3 5l2-1 1 2"/>
    </svg>
  );
}

const SPORT_ICONS = { base: ParachuteIcon, surf: WaveIcon, moto: MotoIcon, climb: IceAxeIcon };

/* ── MOUNTAIN DIVIDER ── */

function MountainDivider() {
  return (
    <svg className="divider-svg" viewBox="0 0 800 40" preserveAspectRatio="none">
      <path d="M0 40 L100 15 L200 30 L350 5 L500 25 L600 10 L700 28 L800 20 L800 40Z"
        fill="none" stroke="var(--comp-border)" strokeWidth="1" opacity="0.6">
        <animate attributeName="d"
          values="M0 40 L100 15 L200 30 L350 5 L500 25 L600 10 L700 28 L800 20 L800 40Z;M0 40 L100 18 L200 28 L350 8 L500 22 L600 13 L700 25 L800 18 L800 40Z;M0 40 L100 15 L200 30 L350 5 L500 25 L600 10 L700 28 L800 20 L800 40Z"
          dur="6s" repeatCount="indefinite"/>
      </path>
      <path d="M0 40 L150 22 L300 35 L450 12 L550 30 L700 18 L800 30 L800 40Z"
        fill="var(--comp-border)" opacity="0.15">
        <animate attributeName="d"
          values="M0 40 L150 22 L300 35 L450 12 L550 30 L700 18 L800 30 L800 40Z;M0 40 L150 25 L300 32 L450 15 L550 27 L700 21 L800 27 L800 40Z;M0 40 L150 22 L300 35 L450 12 L550 30 L700 18 L800 30 L800 40Z"
          dur="7s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}

/* ── SPARKLINE ── */

function Sparkline({ data, width = 200, height = 40, color = "var(--comp-accent)" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return { x, y };
  });
  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ");
  const lastPt = pts[pts.length - 1];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={lastPt.x} cy={lastPt.y} r="3" fill={color}>
        <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

/* ── CANVAS BACKGROUND ── */

function PitchCanvas() {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    const particles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: Math.random() * 0.4 + 0.1,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.25 + 0.05,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250, 204, 21, ${p.opacity})`;
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > canvas.height) { p.y = -5; p.x = Math.random() * canvas.width; }
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
      }
      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pitch-canvas"/>;
}

/* ── EMPTY STATE ── */

function EmptyState({ onAdd }) {
  return (
    <div className="empty-state">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" stroke="var(--comp-muted)" strokeWidth="1.5">
        <path d="M10 65 L30 25 L40 40 L55 15 L70 65Z" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.5;0.3" dur="4s" repeatCount="indefinite"/>
        </path>
        <path d="M10 65 L30 25 L40 40 L55 15 L70 65" fill="none" stroke="var(--comp-accent)" strokeWidth="2">
          <animate attributeName="stroke-dashoffset" from="200" to="0" dur="2s" fill="freeze"/>
          <animate attributeName="stroke-dasharray" from="0 200" to="200 0" dur="2s" fill="freeze"/>
        </path>
        <circle cx="60" cy="20" r="5" fill="var(--comp-accent)" opacity="0.6">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite"/>
        </circle>
      </svg>
      <p>No athletes registered yet. Add your first extreme sports athlete to start tracking performance data.</p>
      <button className="btn-accent" style={{ marginTop: "1rem" }} onClick={onAdd}>Register Athlete</button>
    </div>
  );
}

/* ── SPORT ANIMATIONS ── */

function SurfboardAnim() {
  return (
    <div className="sport-anim-wrap">
      <svg width="120" height="44" viewBox="0 0 120 44">
        <path d="M0 28c20-8 40-14 60-8s40 6 60 2" fill="none" stroke="var(--comp-accent)" strokeWidth="1.5" opacity="0.4">
          <animate attributeName="d" values="M0 28c20-8 40-14 60-8s40 6 60 2;M0 32c20-10 40-16 60-6s40 8 60 0;M0 28c20-8 40-14 60-8s40 6 60 2" dur="2.5s" repeatCount="indefinite"/>
        </path>
        <path d="M0 32c20-6 40-10 60-4s40 4 60 2" fill="none" stroke="var(--comp-accent)" strokeWidth="1" opacity="0.2">
          <animate attributeName="d" values="M0 32c20-6 40-10 60-4s40 4 60 2;M0 35c20-7 40-12 60-3s40 5 60 1;M0 32c20-6 40-10 60-4s40 4 60 2" dur="3s" repeatCount="indefinite"/>
        </path>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;2,-3;-1,1;0,0" dur="2.5s" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="rotate" values="-12,60,22;-8,60,19;-15,60,23;-12,60,22" dur="2.5s" repeatCount="indefinite" additive="sum"/>
          <ellipse cx="60" cy="22" rx="18" ry="3" fill="var(--comp-accent)" opacity="0.7"/>
          <ellipse cx="60" cy="22" rx="16" ry="2" fill="none" stroke="var(--comp-accent-text)" strokeWidth="0.5" opacity="0.5"/>
          <line x1="60" y1="19" x2="60" y2="25" stroke="var(--comp-accent-text)" strokeWidth="0.5" opacity="0.4"/>
          <circle cx="56" cy="16" r="2.5" fill="var(--comp-text)" opacity="0.8"/>
          <line x1="56" y1="18" x2="56" y2="20" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
          <line x1="54" y1="15" x2="52" y2="12" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
          <line x1="58" y1="15" x2="60" y2="12" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
        </g>
        <g opacity="0.3">
          <circle cx="75" cy="30" r="1" fill="var(--comp-accent)"><animate attributeName="cx" values="75;85;95;105" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0.2;0" dur="1.5s" repeatCount="indefinite"/></circle>
          <circle cx="70" cy="32" r="0.8" fill="var(--comp-accent)"><animate attributeName="cx" values="70;80;90;100" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.4;0.15;0" dur="1.8s" repeatCount="indefinite"/></circle>
        </g>
      </svg>
    </div>
  );
}

function ParachuteAnim() {
  return (
    <div className="sport-anim-wrap">
      <svg width="60" height="44" viewBox="0 0 60 44">
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;1,3;-1,1;0,0" dur="4s" repeatCount="indefinite"/>
          <path d="M16 10 Q30 -2 44 10" fill="var(--comp-accent)" opacity="0.3" stroke="var(--comp-accent)" strokeWidth="1">
            <animate attributeName="d" values="M16 10 Q30 -2 44 10;M17 11 Q30 0 43 11;M16 10 Q30 -2 44 10" dur="3s" repeatCount="indefinite"/>
          </path>
          <line x1="16" y1="10" x2="28" y2="28" stroke="var(--comp-accent)" strokeWidth="0.8" opacity="0.5"/>
          <line x1="44" y1="10" x2="32" y2="28" stroke="var(--comp-accent)" strokeWidth="0.8" opacity="0.5"/>
          <line x1="30" y1="2" x2="30" y2="28" stroke="var(--comp-accent)" strokeWidth="0.8" opacity="0.5"/>
          <circle cx="30" cy="30" r="2.5" fill="var(--comp-text)" opacity="0.8"/>
          <line x1="30" y1="32" x2="30" y2="38" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
          <line x1="28" y1="35" x2="30" y2="33" stroke="var(--comp-text)" strokeWidth="0.8" opacity="0.5"/>
          <line x1="32" y1="35" x2="30" y2="33" stroke="var(--comp-text)" strokeWidth="0.8" opacity="0.5"/>
        </g>
      </svg>
    </div>
  );
}

function MotoJumpAnim() {
  return (
    <div className="sport-anim-wrap">
      <svg width="80" height="44" viewBox="0 0 80 44">
        <path d="M0 38 Q20 38 30 30 Q35 26 40 28" fill="none" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.4"/>
        <path d="M50 32 Q60 36 80 38" fill="none" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.4"/>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;2,-6;4,-8;6,-6;8,0" dur="3s" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="rotate" values="0,40,30;-15,40,24;-25,40,22;-10,40,26;0,40,30" dur="3s" repeatCount="indefinite" additive="sum"/>
          <circle cx="34" cy="32" r="4" fill="none" stroke="var(--comp-accent)" strokeWidth="1.5"/>
          <circle cx="48" cy="32" r="4" fill="none" stroke="var(--comp-accent)" strokeWidth="1.5"/>
          <path d="M34 30 L38 26 L44 26 L48 30" fill="none" stroke="var(--comp-accent)" strokeWidth="1.2"/>
          <path d="M38 26 L42 22 L44 26" fill="none" stroke="var(--comp-text)" strokeWidth="1" opacity="0.7"/>
          <circle cx="42" cy="20" r="2" fill="var(--comp-text)" opacity="0.8"/>
        </g>
        <g opacity="0.3">
          <line x1="30" y1="34" x2="24" y2="38" stroke="var(--comp-muted)" strokeWidth="1"><animate attributeName="opacity" values="0;0.4;0" dur="3s" repeatCount="indefinite"/></line>
          <line x1="28" y1="32" x2="22" y2="36" stroke="var(--comp-muted)" strokeWidth="0.8"><animate attributeName="opacity" values="0;0.3;0" dur="3s" repeatCount="indefinite"/></line>
        </g>
      </svg>
    </div>
  );
}

function ClimbAnim() {
  return (
    <div className="sport-anim-wrap">
      <svg width="50" height="44" viewBox="0 0 50 44">
        <path d="M15 42 L20 30 L18 20 L25 8 L30 16 L28 28 L35 42" fill="none" stroke="var(--comp-border)" strokeWidth="1.5" opacity="0.3"/>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;0,-2;1,-4;0,-2;0,0" dur="3.5s" repeatCount="indefinite"/>
          <circle cx="25" cy="22" r="2.5" fill="var(--comp-text)" opacity="0.8"/>
          <line x1="25" y1="24" x2="25" y2="32" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
          <line x1="23" y1="28" x2="21" y2="32" stroke="var(--comp-text)" strokeWidth="0.8" opacity="0.5"/>
          <line x1="27" y1="28" x2="29" y2="32" stroke="var(--comp-text)" strokeWidth="0.8" opacity="0.5"/>
          <line x1="25" y1="20" x2="21" y2="16" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6">
            <animate attributeName="y2" values="16;14;16" dur="3.5s" repeatCount="indefinite"/>
          </line>
          <line x1="25" y1="20" x2="29" y2="17" stroke="var(--comp-text)" strokeWidth="1" opacity="0.6"/>
          <path d="M19 14 L21 16 L19 18" fill="none" stroke="var(--comp-accent)" strokeWidth="1.2">
            <animate attributeName="d" values="M19 14 L21 16 L19 18;M19 12 L21 14 L19 16;M19 14 L21 16 L19 18" dur="3.5s" repeatCount="indefinite"/>
          </path>
        </g>
        <g opacity="0.2">
          <circle cx="18" cy="12" r="0.8" fill="var(--comp-accent)"><animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/></circle>
          <circle cx="30" cy="10" r="0.6" fill="var(--comp-accent)"><animate attributeName="opacity" values="0.2;0.4;0.2" dur="2.5s" repeatCount="indefinite"/></circle>
        </g>
      </svg>
    </div>
  );
}

const SPORT_ANIMS = { base: ParachuteAnim, surf: SurfboardAnim, moto: MotoJumpAnim, climb: ClimbAnim };

function SportAnimation({ sport }) {
  const Anim = SPORT_ANIMS[sport] || SurfboardAnim;
  return <Anim/>;
}

/* ── MAIN APP ── */

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("xtreme-scoreboard");

  const [tab, setTab] = React.useState("dashboard");
  const [showForm, setShowForm] = React.useState(false);
  const [filterSport, setFilterSport] = React.useState(null);
  const [sortCol, setSortCol] = React.useState("name");
  const [sortAsc, setSortAsc] = React.useState(true);

  const { doc: newAthlete, setDoc: setNewAthlete, submit: submitAthlete, reset: resetAthlete } = useDocument({
    name: "",
    sport: "base",
    rating: 75,
    personalBest: 0,
    type: "athlete",
  });

  const { doc: newLog, setDoc: setNewLog, submit: submitLog, reset: resetLog } = useDocument({
    athleteName: "",
    sport: "base",
    value: 0,
    note: "",
    type: "log",
  });

  const athletes = useLiveQuery("type", { key: "athlete" });
  const logs = useLiveQuery("type", { key: "log" });

  const sortedLogs = React.useMemo(() => {
    return [...(logs.docs || [])].sort((a, b) => (b._id || "").localeCompare(a._id || ""));
  }, [logs.docs]);

  const recentLogs = sortedLogs.slice(0, 15);

  const filteredAthletes = React.useMemo(() => {
    if (!filterSport) return athletes.docs || [];
    return (athletes.docs || []).filter((a) => a.sport === filterSport);
  }, [athletes.docs, filterSport]);

  const stats = React.useMemo(() => {
    const docs = athletes.docs || [];
    const logDocs = logs.docs || [];
    const topRated = docs.reduce((best, a) => (!best || a.rating > best.rating ? a : best), null);
    const avgRating = docs.length ? Math.round(docs.reduce((s, a) => s + (a.rating || 0), 0) / docs.length) : 0;
    const sportCounts = {};
    docs.forEach((a) => { sportCounts[a.sport] = (sportCounts[a.sport] || 0) + 1; });
    return { total: docs.length, topRated, avgRating, logCount: logDocs.length, sportCounts };
  }, [athletes.docs, logs.docs]);

  const tableRows = React.useMemo(() => {
    const docs = athletes.docs || [];
    const logDocs = logs.docs || [];
    const rows = docs.map((a) => {
      const sportInfo = getSportInfo(a.sport);
      const athleteLogs = logDocs.filter((l) => l.athleteName === a.name && l.sport === a.sport);
      const totalEntries = athleteLogs.length;
      const bestValue = athleteLogs.length ? Math.max(...athleteLogs.map((l) => l.value || 0)) : 0;
      return { ...a, sportName: sportInfo.name, unit: sportInfo.unit, totalEntries, bestValue };
    });
    rows.sort((a, b) => {
      let va, vb;
      if (sortCol === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (sortCol === "sport") { va = a.sportName; vb = b.sportName; }
      else if (sortCol === "rating") { va = a.rating; vb = b.rating; }
      else if (sortCol === "pb") { va = a.personalBest; vb = b.personalBest; }
      else if (sortCol === "entries") { va = a.totalEntries; vb = b.totalEntries; }
      else if (sortCol === "best") { va = a.bestValue; vb = b.bestValue; }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return rows;
  }, [athletes.docs, logs.docs, sortCol, sortAsc]);

  function handleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const sparkData = React.useMemo(() => {
    return sortedLogs.slice(0, 20).reverse().map((l) => l.value || 0);
  }, [sortedLogs]);

  async function handleAddAthlete(e) {
    e.preventDefault();
    if (!newAthlete.name.trim()) return;
    await submitAthlete();
    resetAthlete();
    setShowForm(false);
  }

  async function handleLogActivity(e) {
    e.preventDefault();
    if (!newLog.athleteName.trim()) return;
    await submitLog();
    resetLog();
  }

  async function handleDelete(doc) {
    await database.del(doc);
  }

  function formatTime(id) {
    if (!id) return "--:--";
    try {
      const ts = parseInt(id.substring(0, 8), 16) * 1000;
      const d = new Date(ts);
      if (isNaN(d.getTime())) return id.substring(0, 5);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return id.substring(0, 5);
    }
  }

  function getSportInfo(id) {
    return SPORTS.find((s) => s.id === id) || SPORTS[0];
  }

  return (
    <div className="pitch-app grid-background">
      <style>{STYLE}</style>
      <PitchCanvas/>
      <div className="pitch-content">
        {/* HEADER */}
        <header className="pitch-header">
          <div className="pitch-title">
            <span className="accent-dot"/>
            <Typewriter text="XTREME SCOREBOARD" speed={60}/>
          </div>
          <div className="pitch-live">
            <span className="pitch-live-dot"/>
            LIVE
          </div>
        </header>

        {/* NAV */}
        <nav className="pitch-nav">
          {[
            { id: "dashboard", label: "T-001 DASHBOARD" },
            { id: "athletes", label: "T-002 ATHLETES" },
            { id: "log", label: "T-003 LOG" },
            { id: "table", label: "T-004 TABLE" },
          ].map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* LAYOUT */}
        <div className="pitch-layout">
          <div className="pitch-main">
            {tab === "dashboard" && (
              <>
                {/* SPORT FILTER */}
                <div className="sport-icon-row">
                  {SPORTS.map((s) => {
                    const Icon = SPORT_ICONS[s.id];
                    return (
                      <div key={s.id} className={`sport-icon ${filterSport === s.id ? "active" : ""}`}
                        onClick={() => setFilterSport(filterSport === s.id ? null : s.id)}
                        title={s.name}>
                        <Icon size={24}/>
                      </div>
                    );
                  })}
                </div>

                {/* STATS ROW */}
                <div className="stats-row">
                  <div className="metric-card highlight" style={{ animationDelay: "0s" }}>
                    <div className="metric-label">METRIC_01 — TOTAL ATHLETES</div>
                    <div className="metric-value">{stats.total}</div>
                    <div className="metric-sublabel">Registered</div>
                  </div>
                  <div className="metric-card" style={{ animationDelay: "0.05s" }}>
                    <div className="metric-label">METRIC_02 — AVG RATING</div>
                    <div className="metric-value">{stats.avgRating}</div>
                    <div className="metric-sublabel">Performance Index</div>
                  </div>
                  <div className="metric-card" style={{ animationDelay: "0.1s" }}>
                    <div className="metric-label">METRIC_03 — TOP RATED</div>
                    <div className="metric-value" style={{ fontSize: stats.topRated ? "1.4rem" : "2.5rem" }}>
                      {stats.topRated ? stats.topRated.name : "\u2014"}
                    </div>
                    <div className="metric-sublabel">{stats.topRated ? getSportInfo(stats.topRated.sport).name : "No data"}</div>
                  </div>
                  <div className="metric-card" style={{ animationDelay: "0.15s" }}>
                    <div className="metric-label">METRIC_04 — ACTIVITY LOG</div>
                    <div className="metric-value">{stats.logCount}</div>
                    <div className="metric-sublabel">Entries Recorded</div>
                  </div>
                </div>

                <MountainDivider/>

                {/* SPORT CARDS */}
                <div className="section-label">SPORT COVERAGE</div>
                <div className="pitch-grid">
                  {SPORTS.map((s, i) => (
                    <div key={s.id} className="image-card" style={{ animationDelay: `${i * 0.08}s` }}>
                      <div className="card-bg" style={{ backgroundImage: `url(${SPORT_IMAGES[s.id]})` }}/>
                      <div className="card-overlay"/>
                      <div className="card-content">
                        <div className="metric-label">{s.name.toUpperCase()}</div>
                        <div className="metric-value" style={{ fontSize: "2rem" }}>
                          {stats.sportCounts[s.id] || 0}
                        </div>
                        <div className="metric-sublabel">Athletes \u00B7 {s.metric} ({s.unit})</div>
                        <SportAnimation sport={s.id}/>
                      </div>
                    </div>
                  ))}
                </div>

                {/* SPARKLINE */}
                {sparkData.length >= 2 && (
                  <div className="sparkline-container">
                    <div className="sparkline-header">
                      <span className="metric-label" style={{ margin: 0 }}>PERFORMANCE TREND</span>
                      <span className="metric-sublabel">Last {sparkData.length} entries</span>
                    </div>
                    <Sparkline data={sparkData} width={600} height={50}/>
                  </div>
                )}
              </>
            )}

            {tab === "athletes" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div className="section-label" style={{ margin: 0 }}>ATHLETE REGISTRY</div>
                  <button className="btn-accent" onClick={() => setShowForm(!showForm)}>
                    {showForm ? "CANCEL" : "+ REGISTER"}
                  </button>
                </div>

                {showForm && (
                  <form className="athlete-form" onSubmit={handleAddAthlete}>
                    <div className="form-row">
                      <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "150px" }}>
                        <label>ATHLETE NAME</label>
                        <input value={newAthlete.name} onChange={(e) => setNewAthlete({ ...newAthlete, name: e.target.value })} placeholder="Enter name"/>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "120px" }}>
                        <label>DISCIPLINE</label>
                        <select value={newAthlete.sport} onChange={(e) => setNewAthlete({ ...newAthlete, sport: e.target.value })}>
                          {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <label>RATING (0-100)</label>
                        <input type="number" min="0" max="100" value={newAthlete.rating} onChange={(e) => setNewAthlete({ ...newAthlete, rating: parseInt(e.target.value) || 0 })}/>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <label>PERSONAL BEST</label>
                        <input type="number" min="0" value={newAthlete.personalBest} onChange={(e) => setNewAthlete({ ...newAthlete, personalBest: parseInt(e.target.value) || 0 })}/>
                      </div>
                      <button type="submit" className="btn-accent" style={{ alignSelf: "flex-end" }}>SAVE</button>
                    </div>
                  </form>
                )}

                {filteredAthletes.length === 0 ? (
                  <EmptyState onAdd={() => setShowForm(true)}/>
                ) : (
                  <div className="athlete-list">
                    {filteredAthletes.map((a, i) => {
                      const sportInfo = getSportInfo(a.sport);
                      return (
                        <div key={a._id} className="athlete-row" style={{ animationDelay: `${i * 0.04}s` }}>
                          <span className="athlete-index">ATH_{String(i + 1).padStart(3, "0")}</span>
                          <span className="athlete-name">{a.name}</span>
                          <span className="athlete-sport">{sportInfo.name}</span>
                          <span className="athlete-rating">{a.rating}<span style={{ color: "var(--comp-muted)", fontWeight: 400, fontSize: "0.7rem" }}>/100</span></span>
                          <button className="btn-danger" onClick={() => handleDelete(a)}>DEL</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="sport-icon-row" style={{ marginTop: "1rem" }}>
                  <span className="metric-label" style={{ margin: 0, lineHeight: "32px" }}>FILTER:</span>
                  {SPORTS.map((s) => {
                    const Icon = SPORT_ICONS[s.id];
                    return (
                      <div key={s.id} className={`sport-icon ${filterSport === s.id ? "active" : ""}`}
                        onClick={() => setFilterSport(filterSport === s.id ? null : s.id)}
                        title={s.name}>
                        <Icon size={24}/>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {tab === "table" && (
              <>
                <div className="section-label">ATHLETE DATA TABLE</div>
                {tableRows.length === 0 ? (
                  <EmptyState onAdd={() => { setTab("athletes"); setShowForm(true); }}/>
                ) : (
                  <table className="pitch-table">
                    <thead>
                      <tr>
                        <th onClick={() => handleSort("name")}>Name{sortCol === "name" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                        <th onClick={() => handleSort("sport")}>Discipline{sortCol === "sport" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                        <th onClick={() => handleSort("rating")}>Rating{sortCol === "rating" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                        <th onClick={() => handleSort("pb")}>Personal Best{sortCol === "pb" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                        <th onClick={() => handleSort("entries")}>Log Entries{sortCol === "entries" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                        <th onClick={() => handleSort("best")}>Best Logged{sortCol === "best" && <span className="sort-arrow">{sortAsc ? "\u25B2" : "\u25BC"}</span>}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r, i) => (
                        <tr key={r._id} style={{ animationDelay: `${i * 0.04}s` }}>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td className="col-sport">{r.sportName}</td>
                          <td className="col-rating">{r.rating}<span style={{ color: "var(--comp-muted)", fontWeight: 400, fontSize: "0.7rem" }}>/100</span></td>
                          <td className="col-pb">{r.personalBest} <span style={{ color: "var(--comp-muted)", fontSize: "0.7rem" }}>{r.unit}</span></td>
                          <td>{r.totalEntries}</td>
                          <td className="col-pb">{r.bestValue > 0 ? r.bestValue : "\u2014"} {r.bestValue > 0 && <span style={{ color: "var(--comp-muted)", fontSize: "0.7rem" }}>{r.unit}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {tab === "log" && (
              <>
                <div className="section-label">LOG ACTIVITY</div>
                <form className="athlete-form" onSubmit={handleLogActivity}>
                  <div className="form-row">
                    <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "150px" }}>
                      <label>ATHLETE NAME</label>
                      <input value={newLog.athleteName} onChange={(e) => setNewLog({ ...newLog, athleteName: e.target.value })} placeholder="Athlete name"/>
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "120px" }}>
                      <label>DISCIPLINE</label>
                      <select value={newLog.sport} onChange={(e) => setNewLog({ ...newLog, sport: e.target.value })}>
                        {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label>VALUE ({getSportInfo(newLog.sport).unit})</label>
                      <input type="number" min="0" value={newLog.value} onChange={(e) => setNewLog({ ...newLog, value: parseInt(e.target.value) || 0 })}/>
                    </div>
                    <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <label>NOTE</label>
                      <input value={newLog.note} onChange={(e) => setNewLog({ ...newLog, note: e.target.value })} placeholder="Optional note"/>
                    </div>
                    <button type="submit" className="btn-accent" style={{ alignSelf: "flex-end" }}>LOG</button>
                  </div>
                </form>

                <MountainDivider/>

                <div className="section-label">ALL ENTRIES</div>
                {sortedLogs.length === 0 ? (
                  <div className="empty-state">
                    <p>No activity logged yet. Record a performance entry above.</p>
                  </div>
                ) : (
                  <div className="athlete-list">
                    {sortedLogs.map((l, i) => {
                      const sportInfo = getSportInfo(l.sport);
                      return (
                        <div key={l._id} className="athlete-row" style={{ animationDelay: `${i * 0.03}s` }}>
                          <span className="athlete-index">LOG_{String(i + 1).padStart(3, "0")}</span>
                          <span className="athlete-name">{l.athleteName}</span>
                          <span className="athlete-sport">{sportInfo.name}</span>
                          <span className="athlete-rating">{l.value} <span style={{ color: "var(--comp-muted)", fontWeight: 400, fontSize: "0.7rem" }}>{sportInfo.unit}</span></span>
                          <button className="btn-danger" onClick={() => handleDelete(l)}>DEL</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* SIDEBAR */}
          <div className="pitch-sidebar">
            <div className="feed-section-title">ACTIVITY FEED</div>
            {recentLogs.length === 0 ? (
              <div style={{ color: "var(--comp-muted)", fontSize: "0.75rem", padding: "1rem 0" }}>
                No activity yet. Log a performance entry to see it here.
              </div>
            ) : (
              recentLogs.map((l, i) => {
                const sportInfo = getSportInfo(l.sport);
                return (
                  <div key={l._id} className="feed-item" style={{ animationDelay: `${i * 0.05}s` }}>
                    <span className="feed-time">{formatTime(l._id)}</span>
                    <span className="feed-text">
                      <strong>{l.athleteName}</strong> \u2014 {l.value}{sportInfo.unit} {sportInfo.name}
                      {l.note && <span style={{ color: "var(--comp-muted)", display: "block", fontSize: "0.7rem", marginTop: "0.15rem" }}>{l.note}</span>}
                    </span>
                  </div>
                );
              })
            )}

            <MountainDivider/>

            <div className="feed-section-title">DISCIPLINE BREAKDOWN</div>
            {SPORTS.map((s) => {
              const count = stats.sportCounts[s.id] || 0;
              const Icon = SPORT_ICONS[s.id];
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0", borderBottom: "1px solid oklch(0.85 0.01 240 / 0.15)" }}>
                  <Icon size={16}/>
                  <span style={{ flex: 1, fontSize: "0.75rem" }}>{s.name}</span>
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: count > 0 ? "var(--comp-accent)" : "var(--comp-muted)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
                </div>
              );
            })}

            <div style={{ marginTop: "1.5rem" }}>
              <div className="feed-section-title">DANGER INDEX</div>
              {SPORTS.map((s) => {
                const dangerLevels = { base: 95, surf: 82, moto: 78, climb: 88 };
                return (
                  <div key={s.id} style={{ marginBottom: "0.6rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", fontFamily: "'Space Grotesk', monospace", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--comp-muted)", marginBottom: "0.2rem" }}>
                      <span>{s.id.toUpperCase()}</span>
                      <span style={{ color: "var(--comp-accent)" }}>{dangerLevels[s.id]}%</span>
                    </div>
                    <div className="danger-bar">
                      <div className="danger-bar-fill" style={{ width: `${dangerLevels[s.id]}%` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
