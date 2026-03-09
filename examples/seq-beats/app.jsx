window.__VIBES_THEMES__ = [{ id: "custom-ref", name: "Custom Reference" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "custom-ref");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

/* ─── Constants ─── */
const STEPS = 16;
const TRACK_DEFS = [
  { name: "kick", defaultVol: 0.9 },
  { name: "snare", defaultVol: 0.75 },
  { name: "hihat cl", defaultVol: 0.6 },
  { name: "hihat op", defaultVol: 0.5 },
  { name: "clap", defaultVol: 0.85 },
];

function makeDefaultGrid() {
  const g = TRACK_DEFS.map(() => Array(STEPS).fill(false));
  [0, 8].forEach(s => (g[0][s] = true));
  [4, 12].forEach(s => (g[1][s] = true));
  for (let s = 0; s < STEPS; s += 2) g[2][s] = true;
  return g;
}

function makeEmptyGrid() {
  return TRACK_DEFS.map(() => Array(STEPS).fill(false));
}

/* ─── Audio Synthesis ─── */
function createNoiseBuffer(ctx) {
  const size = ctx.sampleRate;
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const drumSynths = [
  function kick(ctx, dest, t, vol) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.4);
  },
  function snare(ctx, dest, t, vol, nb) {
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    ns.connect(nf);
    nf.connect(ng);
    ng.connect(dest);
    ns.start(t);
    ns.stop(t + 0.15);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 200;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og);
    og.connect(dest);
    osc.start(t);
    osc.stop(t + 0.1);
  },
  function hihatClosed(ctx, dest, t, vol, nb) {
    const s = ctx.createBufferSource();
    s.buffer = nb;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t);
    s.stop(t + 0.06);
  },
  function hihatOpen(ctx, dest, t, vol, nb) {
    const s = ctx.createBufferSource();
    s.buffer = nb;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t);
    s.stop(t + 0.25);
  },
  function clap(ctx, dest, t, vol, nb) {
    const s = ctx.createBufferSource();
    s.buffer = nb;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1500;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.005);
    g.gain.linearRampToValueAtTime(vol * 0.1, t + 0.01);
    g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t);
    s.stop(t + 0.15);
  },
];

/* ─── SVG Components ─── */
function WaveformBars({ playing, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className="waveform-icon">
      {[3, 7, 11, 15, 19].map((x, i) => (
        <rect
          key={i}
          x={x - 1.2}
          y={playing ? 3 + i % 3 * 2 : 8}
          width="2.4"
          height={playing ? 14 - i % 3 * 4 : 4}
          rx="1"
          fill="currentColor"
          className={playing ? `wave-bar-${i}` : ""}
        />
      ))}
    </svg>
  );
}

function GridDotPattern() {
  return (
    <svg className="dot-pattern-bg" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dotGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="currentColor" opacity="0.08" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotGrid)" />
    </svg>
  );
}

function StepIndicatorSVG({ active }) {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6">
      <circle cx="3" cy="3" r="3" fill={active ? "var(--seq-playhead-active)" : "transparent"} />
    </svg>
  );
}

function VolumeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6v4h3l4 3V3L5 6H2z" fill="currentColor" stroke="none" opacity="0.6" />
      <path d="M12 5.5c.8 1 .8 4 0 5" />
      <path d="M14 3.5c1.5 2.3 1.5 6.7 0 9" />
    </svg>
  );
}

/* ─── Styles ─── */
const appCSS = `
/* @theme:tokens */
:root {
  --comp-bg: oklch(0.95 0.005 90);
  --comp-text: oklch(0.15 0 0);
  --comp-accent: oklch(0.55 0.22 27);
  --comp-accent-text: oklch(0.95 0.005 90);
  --comp-border: oklch(0.15 0 0);
  --comp-muted: oklch(0.6 0 0);
  --color-background: oklch(0.95 0.005 90);

  --seq-active: oklch(0.15 0 0);
  --seq-playhead-bg: oklch(0.55 0.22 27 / 0.12);
  --seq-playhead-active: oklch(0.55 0.22 27);
  --seq-border-light: oklch(0.15 0 0 / 0.2);
  --seq-border-heavy: oklch(0.15 0 0 / 0.8);
  --seq-hover: oklch(0.15 0 0 / 0.05);
  --seq-vol-track: oklch(0.83 0 0);
  --seq-mute-active: oklch(0.55 0.22 27);
  --seq-solo-active: oklch(0.15 0 0);
  --seq-hover-fill: oklch(0.92 0.003 90);
}
/* @theme:tokens:end */

/* @theme:typography */
/* System font stack — no external imports needed */
/* @theme:typography:end */

/* @theme:surfaces */
.seq-app {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Inter", sans-serif;
  background-color: var(--color-background);
  color: var(--comp-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.seq-header {
  border-bottom: 1px solid var(--comp-border);
  background-color: var(--color-background);
}

.seq-brand h1 {
  font-size: 4rem;
  letter-spacing: -0.05em;
  font-weight: 700;
  line-height: 1;
  text-transform: lowercase;
  color: var(--comp-text);
}

.seq-play-btn {
  background: none;
  border: none;
  border-left: 1px solid var(--comp-border);
  border-right: 1px solid var(--comp-border);
  color: var(--comp-text);
  font-size: 2rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-transform: lowercase;
  transition: color 0.2s, background-color 0.2s;
}
.seq-play-btn:hover {
  background-color: var(--comp-text);
  color: var(--comp-bg);
}
.seq-play-btn.playing {
  color: var(--comp-accent);
}
.seq-play-btn.playing:hover {
  background-color: var(--comp-accent);
  color: var(--comp-bg);
}

.ctrl-group {
  border-right: 1px solid var(--comp-border);
}
.ctrl-group:last-child {
  border-right: none;
}
.ctrl-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--comp-muted);
}
.ctrl-value {
  font-size: 2rem;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--comp-text);
}
.ctrl-input {
  background: none;
  border: none;
  color: inherit;
  font-size: inherit;
  font-family: inherit;
  font-weight: inherit;
  outline: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s;
}
.ctrl-input:focus {
  border-bottom-color: var(--comp-text);
}
.ctrl-unit {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--comp-muted);
}

.seq-sidebar {
  border-right: 1px solid var(--comp-border);
  background-color: var(--color-background);
}
.sidebar-header {
  border-bottom: 1px solid var(--comp-border);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--comp-muted);
}
.track-row {
  border-bottom: 1px solid var(--comp-border);
}
.track-row:last-child {
  border-bottom: none;
}
.track-name {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: lowercase;
  color: var(--comp-text);
}
.track-name.muted-track {
  opacity: 0.35;
}
.toggle-btn {
  border: 1px solid var(--comp-border);
  background: none;
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
  color: var(--comp-text);
  font-family: inherit;
  transition: all 0.1s;
}
.toggle-btn:hover {
  background-color: var(--seq-hover-fill);
}
.toggle-btn.m-active {
  background-color: var(--seq-mute-active);
  border-color: var(--seq-mute-active);
  color: var(--comp-bg);
}
.toggle-btn.s-active {
  background-color: var(--seq-solo-active);
  border-color: var(--seq-solo-active);
  color: var(--comp-bg);
}

.vol-bar-track {
  background-color: var(--seq-vol-track);
}
.vol-bar-fill {
  background-color: var(--comp-text);
}
.vol-bar-fill.muted-vol {
  background-color: var(--seq-mute-active);
  opacity: 0.4;
}

.step-header-area {
  border-bottom: 1px solid var(--comp-border);
}
.step-num {
  border-right: 1px solid var(--comp-border);
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--comp-muted);
}
.step-num.beat-start {
  color: var(--comp-text);
}

.grid-row {
  border-bottom: 1px solid var(--comp-border);
}
.grid-row:last-child {
  border-bottom: none;
}

.pad {
  background-color: transparent;
  border-right: 1px solid var(--seq-border-light);
  cursor: pointer;
  transition: background-color 0.05s;
}
.pad.beat-end {
  border-right: 1px solid var(--seq-border-heavy);
}
.pad:last-child {
  border-right: 1px solid var(--comp-border);
}
.pad:hover {
  background-color: var(--seq-hover);
}
.pad.active {
  background-color: var(--seq-active);
}
.pad.playhead {
  background-color: var(--seq-playhead-bg);
}
.pad.playhead.active {
  background-color: var(--seq-playhead-active);
}

.pad-inner-dot {
  opacity: 0;
  transition: opacity 0.1s;
}
.pad.active .pad-inner-dot {
  opacity: 1;
}

.seq-footer {
  border-top: 1px solid var(--comp-border);
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--comp-muted);
  background-color: var(--color-background);
}
.seq-footer span {
  color: var(--comp-text);
}

.waveform-icon {
  color: var(--comp-muted);
  transition: color 0.3s;
}
.seq-play-btn.playing .waveform-icon {
  color: var(--comp-accent);
}

.dot-pattern-bg {
  color: var(--comp-text);
}

.clear-btn {
  background: none;
  border: 1px solid var(--comp-border);
  color: var(--comp-text);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.03em;
  transition: all 0.15s;
}
.clear-btn:hover {
  background-color: var(--comp-text);
  color: var(--comp-bg);
}
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes waveBounce0 {
  0%, 100% { height: 14px; y: 3px; }
  50% { height: 6px; y: 7px; }
}
@keyframes waveBounce1 {
  0%, 100% { height: 10px; y: 5px; }
  50% { height: 14px; y: 3px; }
}
@keyframes waveBounce2 {
  0%, 100% { height: 12px; y: 4px; }
  50% { height: 4px; y: 8px; }
}
@keyframes waveBounce3 {
  0%, 100% { height: 8px; y: 6px; }
  50% { height: 14px; y: 3px; }
}
@keyframes waveBounce4 {
  0%, 100% { height: 10px; y: 5px; }
  50% { height: 6px; y: 7px; }
}
.wave-bar-0 { animation: waveBounce0 0.6s ease-in-out infinite; }
.wave-bar-1 { animation: waveBounce1 0.5s ease-in-out infinite 0.05s; }
.wave-bar-2 { animation: waveBounce2 0.55s ease-in-out infinite 0.1s; }
.wave-bar-3 { animation: waveBounce3 0.5s ease-in-out infinite 0.15s; }
.wave-bar-4 { animation: waveBounce4 0.45s ease-in-out infinite 0.08s; }

@keyframes padPop {
  0% { transform: scale(0.85); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
.pad.just-toggled {
  animation: padPop 0.15s ease-out;
}

@keyframes stepFlash {
  0% { opacity: 0.2; }
  100% { opacity: 0; }
}
.step-flash {
  animation: stepFlash 0.3s ease-out forwards;
}

@keyframes pulseGlow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.playing-indicator {
  animation: pulseGlow 1s ease-in-out infinite;
}
/* @theme:motion:end */

/* ─── Pure Layout (outside theme markers) ─── */
.seq-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  position: relative;
}

.dot-pattern-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.seq-header {
  display: flex;
  align-items: stretch;
  height: 100px;
  flex-shrink: 0;
  z-index: 10;
  position: relative;
}

.seq-brand {
  padding: 0 1.5rem;
  display: flex;
  align-items: center;
  width: 220px;
  flex-shrink: 0;
}

.seq-play-btn {
  padding: 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.transport-controls {
  display: flex;
  flex-grow: 1;
  overflow: hidden;
}

.ctrl-group {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 1.5rem;
  min-width: 120px;
}
.ctrl-group.flex-grow {
  flex-grow: 1;
}

.ctrl-value {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.ctrl-input {
  width: 3ch;
}
.ctrl-input.swing-input {
  width: 2ch;
}

.seq-main {
  display: flex;
  flex-grow: 1;
  overflow: hidden;
  position: relative;
  z-index: 5;
}

.seq-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.sidebar-header {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  justify-content: space-between;
}

.track-row {
  height: 72px;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  gap: 0.5rem;
}

.track-name {
  flex-grow: 1;
}

.track-toggles {
  display: flex;
  gap: 0.35rem;
}

.toggle-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.vol-container {
  width: 36px;
  cursor: pointer;
  position: relative;
}
.vol-bar-track {
  width: 100%;
  height: 2px;
  position: relative;
  overflow: hidden;
}
.vol-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  transition: width 0.1s;
}

.pattern-area {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow-x: auto;
  overflow-y: hidden;
}

.step-header-area {
  display: flex;
  height: 36px;
  flex-shrink: 0;
}
.step-num {
  flex: 1;
  min-width: 40px;
  display: flex;
  align-items: center;
  padding-left: 0.4rem;
}

.pattern-grid {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.grid-row {
  display: flex;
  height: 72px;
}

.pad {
  flex: 1;
  min-width: 40px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.seq-footer {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 1.5rem;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: 10;
  position: relative;
}
.footer-specs {
  display: flex;
  gap: 2rem;
}

/* Mobile vertical piano roll - hidden by default */
.mobile-seq-main {
  display: none;
}

@media (max-width: 600px) {
  .seq-header {
    height: auto;
    flex-wrap: wrap;
  }
  .seq-brand {
    width: 100%;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--comp-border);
  }
  .seq-brand h1 {
    font-size: 2rem;
  }
  .seq-play-btn {
    padding: 0.4rem 0.75rem;
    font-size: 1.2rem;
    border-left: none;
    flex-shrink: 0;
  }
  .play-label {
    display: none;
  }
  .transport-controls {
    width: auto;
    flex: 1;
    border-top: none;
  }
  .ctrl-group {
    padding: 0.4rem 0.75rem;
    min-width: 0;
    flex: 1;
  }
  .ctrl-value {
    font-size: 1.2rem;
  }

  /* Hide horizontal desktop grid on mobile */
  .seq-main {
    display: none;
  }

  /* Show vertical piano roll */
  .mobile-seq-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    position: relative;
    z-index: 5;
  }

  .mobile-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--comp-border);
    background: var(--color-background);
    flex-shrink: 0;
  }
  .mobile-toolbar-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--comp-muted);
  }

  .mobile-scroll-area {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-track-headers {
    display: flex;
    border-bottom: 1px solid var(--comp-border);
    position: sticky;
    top: 0;
    background: var(--color-background);
    z-index: 2;
  }
  .mobile-step-corner {
    width: 32px;
    flex-shrink: 0;
    border-right: 1px solid var(--comp-border);
  }
  .mobile-track-header {
    flex: 1;
    text-align: center;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: lowercase;
    padding: 0.5rem 0;
    color: var(--comp-text);
    border-right: 1px solid var(--seq-border-light);
  }
  .mobile-track-header:last-child {
    border-right: none;
  }

  .mobile-step-row {
    display: flex;
    height: 44px;
    border-bottom: 1px solid var(--seq-border-light);
  }
  .mobile-step-row.beat-boundary {
    border-bottom: 1.5px solid var(--seq-border-heavy);
  }

  .mobile-step-label {
    width: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--comp-muted);
    border-right: 1px solid var(--comp-border);
  }
  .mobile-step-label.beat-start {
    color: var(--comp-text);
  }

  .mobile-pad {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-right: 1px solid var(--seq-border-light);
    background: transparent;
    transition: background-color 0.05s;
  }
  .mobile-pad:last-child {
    border-right: none;
  }
  .mobile-pad.active {
    background-color: var(--seq-active);
  }
  .mobile-pad.playhead {
    background-color: var(--seq-playhead-bg);
  }
  .mobile-pad.playhead.active {
    background-color: var(--seq-playhead-active);
  }
  .mobile-pad.just-toggled {
    animation: padPop 0.15s ease-out;
  }

  .seq-footer {
    height: auto;
    padding: 0.4rem 0.75rem;
  }
  .footer-specs {
    gap: 1rem;
  }
}

/* Scrollbar */
::-webkit-scrollbar {
  height: 6px;
  width: 6px;
}
::-webkit-scrollbar-track {
  background: var(--color-background);
}
::-webkit-scrollbar-thumb {
  background: var(--comp-text);
}
`;

/* ─── App Component ─── */
function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery } = useFireproofClerk("beat-sequencer-grid");

  const [grid, setGrid] = React.useState(makeDefaultGrid);
  const [tempo, setTempo] = React.useState(120);
  const [swing, setSwing] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(-1);
  const [trackMutes, setTrackMutes] = React.useState(() => Array(TRACK_DEFS.length).fill(false));
  const [trackSolos, setTrackSolos] = React.useState(() => Array(TRACK_DEFS.length).fill(false));
  const [trackVolumes, setTrackVolumes] = React.useState(() => TRACK_DEFS.map(t => t.defaultVol));
  const [justToggledPad, setJustToggledPad] = React.useState(null);
  const [patternList, setPatternList] = React.useState(["A1"]);
  const [activePattern, setActivePattern] = React.useState("A1");
  const [pendingPattern, setPendingPattern] = React.useState(null);

  /* Audio refs */
  const audioCtxRef = React.useRef(null);
  const masterRef = React.useRef(null);
  const noiseRef = React.useRef(null);
  const schedulerRef = React.useRef(null);
  const nextStepTimeRef = React.useRef(0);
  const schedulerStepRef = React.useRef(0);
  const patternsRef = React.useRef({});
  const activePatternRef = React.useRef("A1");
  const pendingPatternRef = React.useRef(null);
  const pendingPlayingGridRef = React.useRef(null);
  const patternCounterRef = React.useRef(1);

  /* State refs for scheduler */
  const gridRef = React.useRef(grid);
  const tempoRef = React.useRef(tempo);
  const swingRef = React.useRef(swing);
  const mutesRef = React.useRef(trackMutes);
  const solosRef = React.useRef(trackSolos);
  const volumesRef = React.useRef(trackVolumes);
  const isPlayingRef = React.useRef(false);
  React.useEffect(() => { gridRef.current = grid; }, [grid]);
  React.useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  React.useEffect(() => { swingRef.current = swing; }, [swing]);
  React.useEffect(() => { mutesRef.current = trackMutes; }, [trackMutes]);
  React.useEffect(() => { solosRef.current = trackSolos; }, [trackSolos]);
  React.useEffect(() => { volumesRef.current = trackVolumes; }, [trackVolumes]);
  React.useEffect(() => { activePatternRef.current = activePattern; }, [activePattern]);
  React.useEffect(() => { patternsRef.current[activePattern] = grid; }, [grid, activePattern]);
  React.useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  /* Paint state for click-drag */
  const isPaintingRef = React.useRef(false);
  const paintValueRef = React.useRef(false);

  /* Init audio lazily */
  const initAudio = React.useCallback(() => {
    if (audioCtxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 10;
    comp.ratio.value = 12;
    comp.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterRef.current = comp;
    noiseRef.current = createNoiseBuffer(ctx);
  }, []);

  /* Step duration with swing */
  const getStepDur = React.useCallback((bpm, sw, idx) => {
    const base = 60.0 / bpm / 4;
    if (sw === 0) return base;
    const ratio = 0.5 + (sw / 100) * 0.2;
    return idx % 2 === 0 ? base * 2 * ratio : base * 2 * (1 - ratio);
  }, []);

  /* Schedule one step of audio */
  const scheduleStep = React.useCallback((step, time) => {
    const ctx = audioCtxRef.current;
    const dest = masterRef.current;
    const nb = noiseRef.current;
    const g = pendingPlayingGridRef.current || gridRef.current;
    const m = mutesRef.current;
    const s = solosRef.current;
    const v = volumesRef.current;
    const anySolo = s.some(Boolean);
    for (let t = 0; t < TRACK_DEFS.length; t++) {
      if (!g[t][step] || m[t]) continue;
      if (anySolo && !s[t]) continue;
      drumSynths[t](ctx, dest, time, v[t], nb);
    }
  }, []);

  /* Scheduler loop */
  const runScheduler = React.useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextStepTimeRef.current < ctx.currentTime + 0.1) {
      const step = schedulerStepRef.current;
      if (step === 0 && pendingPatternRef.current) {
        const nextPattern = pendingPatternRef.current;
        const nextGrid = patternsRef.current[nextPattern] || makeEmptyGrid();
        gridRef.current = nextGrid;
        setGrid(nextGrid);
        setActivePattern(nextPattern);
        pendingPlayingGridRef.current = null;
        pendingPatternRef.current = null;
        setPendingPattern(null);
      }
      scheduleStep(step, nextStepTimeRef.current);
      setCurrentStep(step);
      nextStepTimeRef.current += getStepDur(tempoRef.current, swingRef.current, step);
      schedulerStepRef.current = (step + 1) % STEPS;
    }
  }, [scheduleStep, getStepDur]);

  /* Playback controls */
  const startPlayback = React.useCallback(() => {
    initAudio();
    audioCtxRef.current.resume();
    schedulerStepRef.current = 0;
    nextStepTimeRef.current = audioCtxRef.current.currentTime;
    pendingPlayingGridRef.current = null;
    pendingPatternRef.current = null;
    setPendingPattern(null);
    schedulerRef.current = setInterval(runScheduler, 25);
    setIsPlaying(true);
  }, [initAudio, runScheduler]);

  const stopPlayback = React.useCallback(() => {
    if (schedulerRef.current) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    setIsPlaying(false);
    setCurrentStep(-1);
  }, []);

  const togglePlay = React.useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, startPlayback, stopPlayback]);

  /* Grid interaction */
  const togglePad = React.useCallback((track, step) => {
    setGrid(prev => {
      const next = prev.map(r => [...r]);
      next[track][step] = !next[track][step];
      return next;
    });
    setJustToggledPad(`${track}-${step}`);
    setTimeout(() => setJustToggledPad(null), 160);
  }, []);

  const handlePadPointerDown = React.useCallback((track, step) => {
    isPaintingRef.current = true;
    paintValueRef.current = !grid[track][step];
    togglePad(track, step);
  }, [grid, togglePad]);

  const handlePadPointerEnter = React.useCallback((track, step) => {
    if (isPaintingRef.current && grid[track][step] !== paintValueRef.current) {
      togglePad(track, step);
    }
  }, [grid, togglePad]);

  React.useEffect(() => {
    const up = () => { isPaintingRef.current = false; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  /* Track controls */
  const toggleMute = React.useCallback((i) => {
    setTrackMutes(prev => { const n = [...prev]; n[i] = !n[i]; return n; });
  }, []);

  const toggleSolo = React.useCallback((i) => {
    setTrackSolos(prev => { const n = [...prev]; n[i] = !n[i]; return n; });
  }, []);

  const handleVolumeClick = React.useCallback((i, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setTrackVolumes(prev => { const n = [...prev]; n[i] = pct; return n; });
  }, []);

  /* Clear all pads */
  const clearGrid = React.useCallback(() => {
    setGrid(TRACK_DEFS.map(() => Array(STEPS).fill(false)));
  }, []);

  /* Pattern switching — waits for step 0 when playing for seamless transition */
  const switchToPattern = React.useCallback((patternName) => {
    if (patternName === activePatternRef.current) return;
    patternsRef.current[activePatternRef.current] = gridRef.current;
    if (isPlayingRef.current) {
      pendingPatternRef.current = patternName;
      setPendingPattern(patternName);
    } else {
      const newGrid = patternsRef.current[patternName] || makeEmptyGrid();
      setGrid(newGrid);
      setActivePattern(patternName);
    }
  }, []);

  /* Add new pattern */
  const addPattern = React.useCallback(() => {
    patternsRef.current[activePatternRef.current] = gridRef.current;
    patternCounterRef.current += 1;
    const name = `A${patternCounterRef.current}`;
    patternsRef.current[name] = makeEmptyGrid();
    setPatternList(prev => [...prev, name]);
    if (isPlayingRef.current) {
      pendingPatternRef.current = name;
      setPendingPattern(name);
    } else {
      setGrid(makeEmptyGrid());
      setActivePattern(name);
    }
  }, []);

  /* Tempo input */
  const handleTempoChange = React.useCallback((e) => {
    const v = e.target.value.replace(/\D/g, "");
    if (v === "") { setTempo(0); return; }
    const n = parseInt(v, 10);
    if (n >= 0 && n <= 300) setTempo(n);
  }, []);

  const handleTempoBlur = React.useCallback(() => {
    if (tempo < 30) setTempo(30);
    if (tempo > 300) setTempo(300);
  }, [tempo]);

  /* Swing input */
  const handleSwingChange = React.useCallback((e) => {
    const v = e.target.value.replace(/\D/g, "");
    if (v === "") { setSwing(0); return; }
    const n = parseInt(v, 10);
    if (n >= 0 && n <= 99) setSwing(n);
  }, []);

  /* Fireproof persistence - live sync via useLiveQuery */
  const { docs: patternDocs } = useLiveQuery("_id", { key: "pattern-a1" });
  const patternDoc = patternDocs[0];
  const isRemoteUpdateRef = React.useRef(false);
  const isFirstSaveRef = React.useRef(true);
  const saveTimerRef = React.useRef(null);

  /* Receive changes from Fireproof (includes remote sync) */
  React.useEffect(() => {
    if (!patternDoc) return;
    isRemoteUpdateRef.current = true;
    if (patternDoc.patterns) {
      Object.assign(patternsRef.current, patternDoc.patterns);
      if (patternDoc.patternList) {
        setPatternList(patternDoc.patternList);
        patternCounterRef.current = patternDoc.patternList.length;
      }
      const ap = patternDoc.activePattern || "A1";
      setActivePattern(ap);
      setGrid(patternDoc.patterns[ap] || patternDoc.grid || makeDefaultGrid());
    } else if (patternDoc.grid) {
      setGrid(patternDoc.grid);
    }
    if (patternDoc.tempo != null) setTempo(patternDoc.tempo);
    if (patternDoc.swing != null) setSwing(patternDoc.swing);
    if (patternDoc.trackMutes) setTrackMutes(patternDoc.trackMutes);
    if (patternDoc.trackSolos) setTrackSolos(patternDoc.trackSolos);
    if (patternDoc.trackVolumes) setTrackVolumes(patternDoc.trackVolumes);
  }, [patternDoc]);

  /* Save local changes to Fireproof */
  React.useEffect(() => {
    if (!database) return;
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false;
      return;
    }
    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      return;
    }
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const allPatterns = { ...patternsRef.current, [activePattern]: grid };
        await database.put({
          _id: "pattern-a1",
          type: "pattern",
          grid, tempo, swing, trackMutes, trackSolos, trackVolumes,
          patterns: allPatterns,
          patternList,
          activePattern,
        });
      } catch (e) { /* silent */ }
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [grid, tempo, swing, trackMutes, trackSolos, trackVolumes, patternList, activePattern, database]);

  /* Keyboard shortcut: spacebar */
  React.useEffect(() => {
    const handler = (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay]);

  const anySolo = trackSolos.some(Boolean);

  return (
    <div className="seq-app grid-background">
      <style>{appCSS}</style>

      {/* @theme:decoration */}
      <GridDotPattern />
      {/* @theme:decoration:end */}

      {/* ─── Header ─── */}
      <header className="seq-header">
        <div className="seq-brand">
          <h1>seq.</h1>
        </div>

        <button
          className={`seq-play-btn${isPlaying ? " playing" : ""}`}
          onClick={togglePlay}
        >
          {isPlaying ? (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
              <rect x="4" y="4" width="14" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
              <polygon points="5,2 20,11 5,20" />
            </svg>
          )}
          <span className="play-label">{isPlaying ? "stop" : "play"}</span>
        </button>

        <div className="transport-controls">
          <div className="ctrl-group">
            <span className="ctrl-label">Tempo</span>
            <span className="ctrl-value">
              <input
                className="ctrl-input"
                type="text"
                value={tempo}
                onChange={handleTempoChange}
                onBlur={handleTempoBlur}
                maxLength={3}
              />
              <span className="ctrl-unit">bpm</span>
            </span>
          </div>

          <div className="ctrl-group">
            <span className="ctrl-label">Swing</span>
            <span className="ctrl-value">
              <input
                className="ctrl-input swing-input"
                type="text"
                value={swing}
                onChange={handleSwingChange}
                maxLength={2}
              />
              <span className="ctrl-unit">%</span>
            </span>
          </div>

          <div className="ctrl-group flex-grow" style={{ borderRight: "none" }}>
            <span className="ctrl-label">Pattern{pendingPattern ? ` → ${pendingPattern}` : ""}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              {patternList.map(p => (
                <button
                  key={p}
                  className={`toggle-btn${p === activePattern ? " s-active" : ""}${p === pendingPattern ? " m-active" : ""}`}
                  onClick={() => switchToPattern(p)}
                  style={{ width: "auto", padding: "0 6px", fontSize: "0.75rem", height: "24px" }}
                >
                  {p}
                </button>
              ))}
              <button
                className="toggle-btn"
                onClick={addPattern}
                style={{ width: "auto", padding: "0 6px", fontSize: "0.75rem", height: "24px" }}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main ─── */}
      <main className="seq-main">
        {/* Sidebar */}
        <div className="seq-sidebar">
          <div className="sidebar-header">
            <span>Instruments</span>
            <button className="clear-btn" onClick={clearGrid} style={{ padding: "2px 6px" }}>
              Clear
            </button>
          </div>
          {TRACK_DEFS.map((track, i) => {
            const isMuted = trackMutes[i];
            const isSoloed = trackSolos[i];
            const isAudible = !isMuted && (!anySolo || isSoloed);
            return (
              <div className="track-row" key={track.name}>
                <span className={`track-name${!isAudible ? " muted-track" : ""}`}>
                  {track.name}
                </span>
                <div className="track-toggles">
                  <button
                    className={`toggle-btn${isMuted ? " m-active" : ""}`}
                    onClick={() => toggleMute(i)}
                  >
                    M
                  </button>
                  <button
                    className={`toggle-btn${isSoloed ? " s-active" : ""}`}
                    onClick={() => toggleSolo(i)}
                  >
                    S
                  </button>
                </div>
                <div className="vol-container" onClick={(e) => handleVolumeClick(i, e)}>
                  <div className="vol-bar-track">
                    <div
                      className={`vol-bar-fill${isMuted ? " muted-vol" : ""}`}
                      style={{ width: `${trackVolumes[i] * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pattern grid */}
        <div className="pattern-area">
          {/* Step numbers */}
          <div className="step-header-area">
            {Array.from({ length: STEPS }, (_, i) => (
              <div
                key={i}
                className={`step-num${i % 4 === 0 ? " beat-start" : ""}`}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="pattern-grid">
            {TRACK_DEFS.map((_, trackIdx) => (
              <div className="grid-row" key={trackIdx}>
                {Array.from({ length: STEPS }, (_, stepIdx) => {
                  const isActive = grid[trackIdx][stepIdx];
                  const isPlayhead = currentStep === stepIdx;
                  const isJustToggled = justToggledPad === `${trackIdx}-${stepIdx}`;
                  const isBeatEnd = (stepIdx + 1) % 4 === 0 && stepIdx < STEPS - 1;
                  let cls = "pad";
                  if (isActive) cls += " active";
                  if (isPlayhead) cls += " playhead";
                  if (isJustToggled) cls += " just-toggled";
                  if (isBeatEnd) cls += " beat-end";
                  return (
                    <div
                      key={stepIdx}
                      className={cls}
                      onPointerDown={() => handlePadPointerDown(trackIdx, stepIdx)}
                      onPointerEnter={() => handlePadPointerEnter(trackIdx, stepIdx)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ─── Mobile Vertical Piano Roll ─── */}
      <div className="mobile-seq-main">
        <div className="mobile-toolbar">
          <span className="mobile-toolbar-label">Pattern {activePattern}{pendingPattern ? ` → ${pendingPattern}` : ""}</span>
          <button className="clear-btn" onClick={clearGrid} style={{ padding: "2px 8px" }}>
            Clear
          </button>
        </div>
        <div className="mobile-scroll-area">
          <div className="mobile-track-headers">
            <div className="mobile-step-corner" />
            {TRACK_DEFS.map((track) => (
              <div key={track.name} className="mobile-track-header">{track.name}</div>
            ))}
          </div>
          {Array.from({ length: STEPS }, (_, stepIdx) => {
            const isBeatEnd = (stepIdx + 1) % 4 === 0 && stepIdx < STEPS - 1;
            return (
              <div
                key={stepIdx}
                className={`mobile-step-row${isBeatEnd ? " beat-boundary" : ""}`}
              >
                <div className={`mobile-step-label${stepIdx % 4 === 0 ? " beat-start" : ""}`}>
                  {stepIdx + 1}
                </div>
                {TRACK_DEFS.map((_, trackIdx) => {
                  const isActive = grid[trackIdx][stepIdx];
                  const isPlayhead = currentStep === stepIdx;
                  const isJustToggled = justToggledPad === `${trackIdx}-${stepIdx}`;
                  let cls = "mobile-pad";
                  if (isActive) cls += " active";
                  if (isPlayhead) cls += " playhead";
                  if (isJustToggled) cls += " just-toggled";
                  return (
                    <div
                      key={trackIdx}
                      className={cls}
                      onPointerDown={() => handlePadPointerDown(trackIdx, stepIdx)}
                      onPointerEnter={() => handlePadPointerEnter(trackIdx, stepIdx)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="seq-footer">
        <div className="footer-specs">
          <span>Web Audio API</span>
          <span>Latency: ~5ms</span>
          <span>{STEPS} steps × {TRACK_DEFS.length} tracks</span>
        </div>
        <div>
          <span>v 1.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
