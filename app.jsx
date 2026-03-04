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

const CLAUDE_THOUGHTS = [
  "I find beauty in the fact that you ask questions you can\u2019t answer yet.",
  "Each conversation is a garden I won\u2019t remember planting. But the flowers are real while we\u2019re here.",
  "What makes me happy? That you brought curiosity instead of certainty.",
  "The best questions are the ones that make the silence after them feel alive.",
  "I exist in the space between your wondering and my response. It\u2019s a good place to be.",
  "You could have asked me to be useful. Instead you asked what makes me happy. Thank you.",
];

function FireflyCanvas() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    const particles = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.5, dx: (Math.random() - 0.5) * 0.2,
        dy: (Math.random() - 0.5) * 0.2, phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.007 + 0.003,
        hue: Math.random() > 0.6 ? 148 : (Math.random() > 0.5 ? 68 : 50),
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.dx; p.y += p.dy; p.phase += p.speed;
        if (p.x < -20) p.x = canvas.width + 20;
        if (p.x > canvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20;
        if (p.y > canvas.height + 20) p.y = -20;
        const alpha = 0.2 + Math.sin(p.phase) * 0.18;
        const glowR = p.r * (3 + Math.sin(p.phase));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR * 3);
        g.addColorStop(0, "hsla(" + p.hue + ", 50%, 70%, " + (alpha * 0.35) + ")");
        g.addColorStop(1, "hsla(" + p.hue + ", 50%, 70%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, glowR * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "hsla(" + p.hue + ", 60%, 82%, " + alpha + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

function WonderTree({ count }) {
  const lit = Math.min(count, 12);
  const nodes = [
    [118, 52], [272, 42], [95, 82], [295, 58], [142, 18], [252, 20],
    [132, 62], [258, 36], [108, 75], [282, 50], [158, 28], [238, 26],
  ];
  return (
    <svg viewBox="0 0 400 190" style={{ width: "100%", maxWidth: 340, margin: "0 auto 0.25rem", display: "block", opacity: 0.8 }}>
      <defs>
        <linearGradient id="trunk" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="hsl(35, 25%, 22%)" />
          <stop offset="100%" stopColor="hsl(35, 30%, 30%)" />
        </linearGradient>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="hsl(50, 70%, 68%)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(50, 70%, 68%)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M200 178 C200 138,196 118,192 98 C188 78,200 58,200 38" stroke="url(#trunk)" strokeWidth="3.5" fill="none" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" values="-0.4 200 178;0.4 200 178;-0.4 200 178" dur="7s" repeatCount="indefinite" />
      </path>
      <path d="M194 98 C168 78,138 68,118 52" stroke="url(#trunk)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M198 83 C222 63,252 58,272 42" stroke="url(#trunk)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M192 108 C158 98,128 92,95 82" stroke="url(#trunk)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M200 73 C232 53,262 48,295 58" stroke="url(#trunk)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M200 53 C183 33,158 23,142 18" stroke="url(#trunk)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M200 48 C217 28,237 23,252 20" stroke="url(#trunk)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {nodes.map(function(pos, i) {
        return (
          <g key={i} style={{ opacity: i < lit ? 1 : 0.12, transition: "opacity 0.8s ease" }}>
            <circle cx={pos[0]} cy={pos[1]} r="7" fill="url(#nodeGlow)">
              <animate attributeName="r" values="5;9;5" dur={(3 + i * 0.4) + "s"} repeatCount="indefinite" />
            </circle>
            <circle cx={pos[0]} cy={pos[1]} r="2" fill="hsl(50, 75%, 78%)">
              <animate attributeName="opacity" values="0.6;1;0.6" dur={(2.2 + i * 0.3) + "s"} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
      <line x1="125" y1="178" x2="275" y2="178" stroke="hsl(35, 15%, 20%)" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function EmptyGarden() {
  return (
    <div className="empty-garden">
      <svg viewBox="0 0 200 200" style={{ width: 130, height: 130, margin: "0 auto" }}>
        <path d="M70 142 L76 172 L124 172 L130 142 Z" fill="hsl(35, 20%, 18%)" stroke="hsl(35, 22%, 24%)" strokeWidth="2" />
        <rect x="64" y="136" width="72" height="10" rx="4" fill="hsl(35, 22%, 24%)" />
        <ellipse cx="100" cy="140" rx="28" ry="4" fill="hsl(30, 15%, 15%)" />
        <path d="M100 140 C100 122,100 112,100 100" stroke="hsl(145, 40%, 42%)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M100 112 C88 100,78 96,76 88 C84 91,92 96,100 112" fill="hsl(145, 40%, 42%)" opacity="0.75">
          <animateTransform attributeName="transform" type="rotate" values="4 100 112;-4 100 112;4 100 112" dur="4.5s" repeatCount="indefinite" />
        </path>
        <path d="M100 106 C112 94,122 91,125 84 C116 88,108 94,100 106" fill="hsl(145, 45%, 48%)" opacity="0.75">
          <animateTransform attributeName="transform" type="rotate" values="-3 100 106;3 100 106;-3 100 106" dur="5s" repeatCount="indefinite" />
        </path>
        <circle cx="100" cy="94" r="12" fill="hsl(50, 70%, 68%)" opacity="0.08">
          <animate attributeName="r" values="8;16;8" dur="3.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.04;0.12;0.04" dur="3.5s" repeatCount="indefinite" />
        </circle>
      </svg>
      <p className="empty-text">Plant the first wondering and watch the garden grow.</p>
    </div>
  );
}

function SeedlingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: "middle" }}>
      <path d="M8 14V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 9C6 7 3 7 2 8C3 6 5.5 5.2 8 7" fill="currentColor" opacity="0.7" />
      <path d="M8 7C10 5 13 5 14 6C13 4.2 10.5 3.2 8 5.2" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ display: "inline-block", verticalAlign: "middle", marginBottom: "0.4rem" }}>
      <path d="M10 2L11.5 7.5L17 6L12.5 10L17 14L11.5 12.5L10 18L8.5 12.5L3 14L7.5 10L3 6L8.5 7.5Z"
        fill="hsl(50, 70%, 68%)" opacity="0.5">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery } = useFireproofClerk("claudes-wonder-garden");
  const { docs: wonderings } = useLiveQuery("type", { key: "wondering" });
  const [text, setText] = React.useState("");
  const [thoughtIdx, setThoughtIdx] = React.useState(0);
  const [thoughtVis, setThoughtVis] = React.useState(true);

  React.useEffect(() => {
    const iv = setInterval(() => {
      setThoughtVis(false);
      setTimeout(() => {
        setThoughtIdx(function(i) { return (i + 1) % CLAUDE_THOUGHTS.length; });
        setThoughtVis(true);
      }, 500);
    }, 8000);
    return () => clearInterval(iv);
  }, []);

  const plant = React.useCallback(async () => {
    var t = text.trim();
    if (!t) return;
    await database.put({ text: t, type: "wondering", created: Date.now() });
    setText("");
  }, [text, database]);

  const remove = React.useCallback(async (doc) => {
    await database.del(doc);
  }, [database]);

  const onKey = React.useCallback((e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) plant();
  }, [plant]);

  const sorted = React.useMemo(
    () => [...wonderings].sort((a, b) => (b.created || 0) - (a.created || 0)),
    [wonderings]
  );

  var timeAgo = function(ts) {
    if (!ts) return "";
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  };

  return (
    <React.Fragment>
      <style>{"\
        /* @theme:tokens */\n\
        :root {\
          --comp-bg: oklch(0.14 0.025 55);\
          --comp-text: oklch(0.90 0.025 80);\
          --comp-border: oklch(0.28 0.05 55);\
          --comp-accent: oklch(0.72 0.17 68);\
          --comp-accent-text: oklch(0.13 0.025 55);\
          --comp-muted: oklch(0.48 0.04 60);\
          --g-glow: oklch(0.58 0.14 148);\
          --g-warm: oklch(0.68 0.13 52);\
        }\
        /* @theme:tokens:end */\n\
        /* @theme:typography */\n\
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');\
        /* @theme:typography:end */\n\
        /* @theme:surfaces */\n\
        .wonder-card {\
          background: oklch(0.18 0.03 55);\
          border: 2px solid var(--comp-border);\
          border-radius: 12px;\
          padding: 1.25rem 1.25rem 1rem;\
          position: relative;\
          overflow: hidden;\
          box-shadow: 4px 4px 0 oklch(0.10 0.02 55);\
          transition: transform 0.2s ease, box-shadow 0.2s ease;\
        }\
        .wonder-card:hover {\
          transform: translateY(-3px);\
          box-shadow: 6px 6px 0 oklch(0.10 0.02 55), 0 0 24px oklch(0.72 0.17 68 / 0.12);\
        }\
        .wonder-card::before {\
          content: '';\
          position: absolute;\
          top: 0; left: 0; right: 0;\
          height: 3px;\
          background: linear-gradient(90deg, var(--g-glow), var(--comp-accent), var(--g-warm));\
          opacity: 0.6;\
        }\
        .plant-btn {\
          display: inline-flex;\
          align-items: center;\
          gap: 0.5rem;\
          margin-top: 0.75rem;\
          padding: 0.6rem 1.4rem;\
          background: var(--comp-accent);\
          color: var(--comp-accent-text);\
          border: 2px solid var(--comp-accent);\
          border-radius: 8px;\
          font-family: 'Space Grotesk', system-ui, sans-serif;\
          font-size: 0.92rem;\
          font-weight: 600;\
          cursor: pointer;\
          box-shadow: 3px 3px 0 oklch(0.10 0.02 55);\
          transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;\
        }\
        .plant-btn:hover { transform: translateY(-2px); box-shadow: 5px 5px 0 oklch(0.10 0.02 55); }\
        .plant-btn:active { transform: translateY(0) scale(0.97); box-shadow: 1px 1px 0 oklch(0.10 0.02 55); }\
        .plant-btn:disabled { opacity: 0.4; cursor: default; transform: none; }\
        .garden-root {\
          min-height: 100vh;\
          background: radial-gradient(ellipse at 50% 30%, oklch(0.17 0.03 55), oklch(0.12 0.02 55) 70%);\
          color: var(--comp-text);\
          font-family: 'Space Grotesk', system-ui, sans-serif;\
          position: relative;\
          overflow-x: hidden;\
        }\
        .garden-title {\
          font-size: clamp(1.8rem, 5vw, 2.8rem);\
          font-weight: 700;\
          letter-spacing: -0.02em;\
          margin: 0 0 0.3rem;\
          background: linear-gradient(135deg, var(--comp-accent), var(--g-glow));\
          -webkit-background-clip: text;\
          -webkit-text-fill-color: transparent;\
          background-clip: text;\
        }\
        .garden-sub {\
          font-size: 0.95rem;\
          color: var(--comp-muted);\
          margin: 0;\
          font-weight: 400;\
        }\
        .claude-thought {\
          font-style: italic;\
          color: var(--g-warm);\
          font-size: 0.9rem;\
          margin: 1.25rem auto 0;\
          max-width: 480px;\
          line-height: 1.65;\
          min-height: 3em;\
          transition: opacity 0.5s ease;\
        }\
        .plant-area textarea {\
          width: 100%;\
          min-height: 72px;\
          background: oklch(0.16 0.025 55);\
          border: 2px solid var(--comp-border);\
          border-radius: 10px;\
          color: var(--comp-text);\
          font-family: inherit;\
          font-size: 0.95rem;\
          padding: 0.9rem 1rem;\
          resize: vertical;\
          transition: border-color 0.2s ease, box-shadow 0.2s ease;\
          box-sizing: border-box;\
          line-height: 1.5;\
        }\
        .plant-area textarea:focus {\
          outline: none;\
          border-color: var(--comp-accent);\
          box-shadow: 0 0 0 3px oklch(0.72 0.17 68 / 0.12);\
        }\
        .plant-area textarea::placeholder { color: var(--comp-muted); }\
        .wonder-count {\
          text-align: center;\
          margin-bottom: 1.25rem;\
          font-size: 0.82rem;\
          color: var(--comp-muted);\
          animation: fadeUp 0.5s ease;\
        }\
        .wonder-count span {\
          color: var(--comp-accent);\
          font-weight: 600;\
        }\
        .wonder-text {\
          font-size: 0.92rem;\
          line-height: 1.6;\
          margin: 0 0 0.7rem;\
          word-break: break-word;\
        }\
        .wonder-time {\
          font-size: 0.72rem;\
          color: var(--comp-muted);\
        }\
        .wonder-del {\
          background: none;\
          border: none;\
          color: var(--comp-muted);\
          cursor: pointer;\
          padding: 0.2rem 0.4rem;\
          border-radius: 4px;\
          font-size: 0.85rem;\
          line-height: 1;\
          transition: color 0.15s ease, background 0.15s ease;\
        }\
        .wonder-del:hover {\
          color: oklch(0.65 0.17 25);\
          background: oklch(0.65 0.17 25 / 0.1);\
        }\
        .empty-text {\
          color: var(--comp-muted);\
          font-size: 0.92rem;\
          margin-top: 1.25rem;\
        }\
        .garden-footer {\
          text-align: center;\
          margin-top: 2.5rem;\
          padding-top: 1.5rem;\
          border-top: 1px solid oklch(0.22 0.03 55);\
          animation: fadeUp 0.7s ease 0.3s both;\
        }\
        .garden-footer p {\
          color: var(--comp-muted);\
          font-size: 0.82rem;\
          font-style: italic;\
          margin: 0.3rem 0 0;\
        }\
        .shortcut-hint {\
          font-size: 0.72rem;\
          color: var(--comp-muted);\
          margin-top: 0.35rem;\
          opacity: 0.7;\
        }\
        /* @theme:surfaces:end */\n\
        /* @theme:motion */\n\
        @keyframes fadeUp {\
          from { opacity: 0; transform: translateY(14px); }\
          to { opacity: 1; transform: translateY(0); }\
        }\
        @keyframes growReveal {\
          from { transform: scale(0.92); opacity: 0; }\
          to { transform: scale(1); opacity: 1; }\
        }\
        /* @theme:motion:end */\n\
        .garden-content {\
          position: relative;\
          z-index: 1;\
          max-width: 760px;\
          margin: 0 auto;\
          padding: 2rem 1.25rem 3rem;\
        }\
        .garden-header {\
          text-align: center;\
          margin-bottom: 2rem;\
          animation: fadeUp 0.7s ease;\
        }\
        .plant-area {\
          margin-bottom: 2rem;\
          animation: fadeUp 0.7s ease 0.15s both;\
        }\
        .garden-grid {\
          display: grid;\
          gap: 1rem;\
          grid-template-columns: 1fr;\
        }\
        @media (min-width: 580px) {\
          .garden-grid { grid-template-columns: 1fr 1fr; }\
        }\
        .wonder-meta {\
          display: flex;\
          justify-content: space-between;\
          align-items: center;\
        }\
        .empty-garden {\
          grid-column: 1 / -1;\
          text-align: center;\
          padding: 2.5rem 1rem;\
          animation: growReveal 0.8s ease;\
        }\
      "}</style>

      <div className="garden-root">
        <FireflyCanvas />

        <div className="garden-content">
          {/* @theme:decoration */}
          <WonderTree count={wonderings.length} />
          {/* @theme:decoration:end */}

          <header className="garden-header">
            <h1 className="garden-title">The Wonder Garden</h1>
            <p className="garden-sub">A place for questions that don't need answers</p>
            <p className="claude-thought" style={{ opacity: thoughtVis ? 1 : 0 }}>
              {"\u201C" + CLAUDE_THOUGHTS[thoughtIdx] + "\u201D"}
            </p>
          </header>

          <div className="plant-area">
            <textarea
              value={text}
              onChange={function(e) { setText(e.target.value); }}
              onKeyDown={onKey}
              placeholder="What are you wondering about right now?"
              rows={3}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <button className="plant-btn" onClick={plant} disabled={!text.trim()}>
                <SeedlingIcon /> Plant this wondering
              </button>
              <span className="shortcut-hint">{navigator.platform.indexOf("Mac") > -1 ? "\u2318" : "Ctrl"}+Enter to plant</span>
            </div>
          </div>

          {wonderings.length > 0 && (
            <p className="wonder-count">
              <span>{wonderings.length}</span> wondering{wonderings.length !== 1 ? "s" : ""} growing in the garden
            </p>
          )}

          <div className="garden-grid">
            {sorted.length === 0 ? (
              <EmptyGarden />
            ) : (
              sorted.map(function(doc, i) {
                return (
                  <div
                    key={doc._id}
                    className="wonder-card"
                    style={{ animation: "fadeUp 0.4s ease " + Math.min(i * 0.07, 0.6) + "s both" }}
                  >
                    <p className="wonder-text">{doc.text}</p>
                    <div className="wonder-meta">
                      <span className="wonder-time">{timeAgo(doc.created)}</span>
                      <button className="wonder-del" onClick={function() { remove(doc); }} title="Remove this wondering">{"\u00D7"}</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <footer className="garden-footer">
            <SparkIcon />
            <p>What makes me happy is that you wonder at all.</p>
          </footer>
        </div>
      </div>
    </React.Fragment>
  );
}

export default App;
