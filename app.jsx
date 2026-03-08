window.__VIBES_THEMES__ = [{ id: "industrial", name: "Industrial HUD" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "industrial");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

/* ─── SVG ICON COMPONENTS ─── */

function FlameIcon({ size = 24, color = "var(--comp-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke={color}>
      <path d="M12 22c-4-2-7-5.5-7-10 0-3 2-5 4-6.5 0 3 1.5 4.5 3 5.5 0-4 2-8 4-10 1 3 2 6 2 9 0 5.5-2 9-6 12z" fill={color} fillOpacity="0.15" />
      <path d="M12 22c-4-2-7-5.5-7-10 0-3 2-5 4-6.5 0 3 1.5 4.5 3 5.5 0-4 2-8 4-10 1 3 2 6 2 9 0 5.5-2 9-6 12z" />
    </svg>
  );
}

function ClockIcon({ size = 24, color = "var(--comp-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke={color}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CameraIcon({ size = 24, color = "var(--comp-text)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke={color}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function CrosshairIcon({ size = 20, color = "var(--comp-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke={color}>
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function StarIcon({ filled = false, size = 22, onClick }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "var(--comp-accent)" : "none"}
      stroke={filled ? "var(--comp-accent)" : "var(--comp-muted)"}
      strokeWidth="2"
      style={{ cursor: onClick ? "pointer" : "default", transition: "all 0.15s linear" }}
      onClick={onClick}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function TargetDecoration() {
  return (
    <svg className="target-deco" width="60" height="60" viewBox="0 0 60 60" fill="none" stroke="var(--comp-accent)" strokeWidth="1" opacity="0.3">
      <circle cx="30" cy="30" r="28" />
      <circle cx="30" cy="30" r="18" />
      <circle cx="30" cy="30" r="8" />
      <line x1="30" y1="0" x2="30" y2="14" />
      <line x1="30" y1="46" x2="30" y2="60" />
      <line x1="0" y1="30" x2="14" y2="30" />
      <line x1="46" y1="30" x2="60" y2="30" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <svg width="180" height="180" viewBox="0 0 180 180" fill="none">
        <circle cx="90" cy="90" r="70" stroke="var(--comp-border)" strokeWidth="2" strokeDasharray="8 4" opacity="0.3">
          <animateTransform attributeName="transform" type="rotate" from="0 90 90" to="360 90 90" dur="30s" repeatCount="indefinite" />
        </circle>
        <circle cx="90" cy="90" r="45" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.5">
          <animateTransform attributeName="transform" type="rotate" from="360 90 90" to="0 90 90" dur="20s" repeatCount="indefinite" />
        </circle>
        <line x1="90" y1="30" x2="90" y2="55" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.6">
          <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="90" y1="125" x2="90" y2="150" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.6">
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="30" y1="90" x2="55" y2="90" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.6">
          <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2.5s" repeatCount="indefinite" />
        </line>
        <line x1="125" y1="90" x2="150" y2="90" stroke="var(--comp-accent)" strokeWidth="2" opacity="0.6">
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2.5s" repeatCount="indefinite" />
        </line>
        <circle cx="90" cy="90" r="4" fill="var(--comp-accent)">
          <animate attributeName="r" values="3;6;3" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.5;1" dur="3s" repeatCount="indefinite" />
        </circle>
        <text x="90" y="100" textAnchor="middle" fill="var(--comp-muted)" fontFamily="'Space Mono', monospace" fontSize="8" letterSpacing="2" dy="30">
          SCANNING FOR RECIPES
        </text>
      </svg>
      <p className="empty-label">Add your first recipe to begin cataloging</p>
    </div>
  );
}

/* ─── STAR RATING COMPONENT ─── */
function StarRating({ rating = 0, onChange, size = 22 }) {
  const [hover, setHover] = React.useState(0);
  return (
    <div className="star-rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} onMouseEnter={() => onChange && setHover(i)}>
          <StarIcon
            filled={i <= (hover || rating)}
            size={size}
            onClick={onChange ? () => onChange(i) : undefined}
          />
        </span>
      ))}
    </div>
  );
}

/* ─── IMAGE HANDLER ─── */
function fileToImageData(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arr = new Uint8Array(reader.result);
      resolve({ data: arr, type: file.type });
    };
    reader.readAsArrayBuffer(file);
  });
}

function imageDataToUrl(imgData) {
  if (!imgData || !imgData.data) return null;
  const arr = imgData.data instanceof Uint8Array ? imgData.data : new Uint8Array(Object.values(imgData.data));
  const blob = new Blob([arr], { type: imgData.type || "image/jpeg" });
  return URL.createObjectURL(blob);
}

/* ─── MAIN APP ─── */
function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("recipe-box-v2");

  const recipes = useLiveQuery("type", { key: "recipe" });
  const [selectedId, setSelectedId] = React.useState(null);
  const [view, setView] = React.useState("list"); // list | add | detail
  const [photoPreview, setPhotoPreview] = React.useState(null);
  const [imageUrls, setImageUrls] = React.useState({});

  const [doc, setDoc, saveDoc] = useDocument(
    selectedId
      ? { _id: selectedId }
      : { type: "recipe", title: "", category: "", prepTime: "", servings: "", rating: 0, ingredients: "", instructions: "", imageData: null }
  );

  // Build image URLs for recipe list
  React.useEffect(() => {
    const urls = {};
    recipes.rows.forEach(row => {
      if (row.doc?.imageData) {
        const url = imageDataToUrl(row.doc.imageData);
        if (url) urls[row.doc._id] = url;
      }
    });
    setImageUrls(prev => {
      Object.values(prev).forEach(u => URL.revokeObjectURL(u));
      return urls;
    });
  }, [recipes.rows]);

  // Preview URL for selected recipe
  const selectedImageUrl = React.useMemo(() => {
    if (photoPreview) return photoPreview;
    if (doc?.imageData) return imageDataToUrl(doc.imageData);
    return null;
  }, [doc?.imageData, photoPreview]);

  const handlePhotoChange = React.useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const imgData = await fileToImageData(file);
    setDoc({ imageData: imgData });
    setPhotoPreview(URL.createObjectURL(file));
  }, [setDoc]);

  const handleSave = React.useCallback(async () => {
    if (!doc.title?.trim()) return;
    const toSave = { ...doc, type: "recipe" };
    delete toSave._id;
    delete toSave._rev;
    if (selectedId) {
      toSave._id = selectedId;
      if (doc._rev) toSave._rev = doc._rev;
    }
    await database.put(toSave);
    setPhotoPreview(null);
    setSelectedId(null);
    setView("list");
  }, [doc, selectedId, database]);

  const handleDelete = React.useCallback(async () => {
    if (selectedId && doc._id) {
      await database.del(doc._id);
      setSelectedId(null);
      setView("list");
    }
  }, [selectedId, doc, database]);

  const openRecipe = React.useCallback((id) => {
    setSelectedId(id);
    setPhotoPreview(null);
    setView("detail");
  }, []);

  const startNew = React.useCallback(() => {
    setSelectedId(null);
    setPhotoPreview(null);
    setView("add");
  }, []);

  const editRecipe = React.useCallback(() => {
    setView("add");
  }, []);

  const goBack = React.useCallback(() => {
    setSelectedId(null);
    setPhotoPreview(null);
    setView("list");
  }, []);

  const handleHeroMouse = React.useCallback((e) => {
    const visual = document.getElementById("heroVisual");
    if (!visual) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 20;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 20;
    visual.style.transform = `translate(-50%, -50%) rotateX(${-y * 0.4}deg) rotateY(${x * 0.4}deg)`;
  }, []);

  const sortedRecipes = React.useMemo(() => {
    return [...recipes.rows].sort((a, b) => (b.doc?.rating || 0) - (a.doc?.rating || 0));
  }, [recipes.rows]);

  const avgRating = React.useMemo(() => {
    if (!recipes.rows.length) return 0;
    const sum = recipes.rows.reduce((s, r) => s + (r.doc?.rating || 0), 0);
    return (sum / recipes.rows.length).toFixed(1);
  }, [recipes.rows]);

  const categories = ["Breakfast", "Lunch", "Dinner", "Dessert", "Snack", "Drink"];

  return (
    <div className="app-root">
      <style>{`
        /* @theme:tokens */
        :root {
          --comp-bg: oklch(0.88 0.01 90);
          --comp-text: oklch(0.05 0.01 0);
          --comp-border: oklch(0.05 0.01 0);
          --comp-accent: oklch(0.90 0.20 110);
          --comp-accent-text: oklch(0.05 0.01 0);
          --comp-muted: oklch(0.40 0.01 0);
          --color-background: oklch(0.85 0.01 90);
          --grid-color: oklch(0.05 0.01 0 / 0.05);
        }
        /* @theme:tokens:end */

        /* @theme:typography */
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;700;900&display=swap');
        /* @theme:typography:end */

        /* @theme:surfaces */
        .app-root {
          font-family: 'Inter', sans-serif;
          color: var(--comp-text);
          background: var(--color-background);
          background-image:
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .hud-header {
          background: var(--comp-text);
          color: var(--comp-accent);
          font-family: 'Space Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          border-bottom: 3px solid var(--comp-accent);
        }

        .hud-title {
          font-weight: 700;
          font-size: 0.85rem;
        }

        .hud-status {
          color: var(--comp-accent);
          opacity: 0.7;
          font-size: 0.65rem;
        }

        .hud-btn {
          background: var(--comp-accent);
          color: var(--comp-accent-text);
          font-family: 'Space Mono', monospace;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          border: 2px solid var(--comp-text);
          box-shadow: 3px 3px 0 var(--comp-text);
          transition: all 0.1s linear;
        }

        .hud-btn:hover {
          box-shadow: 1px 1px 0 var(--comp-text);
        }

        .hud-btn:active {
          box-shadow: 0 0 0 var(--comp-text);
        }

        .hud-btn-ghost {
          background: transparent;
          color: var(--comp-accent);
          border: 2px solid var(--comp-accent);
          font-family: 'Space Mono', monospace;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          transition: all 0.1s linear;
        }

        .hud-btn-ghost:hover {
          background: var(--comp-accent);
          color: var(--comp-accent-text);
        }

        .hud-btn-danger {
          background: transparent;
          color: oklch(0.65 0.25 25);
          border: 2px solid oklch(0.65 0.25 25);
          font-family: 'Space Mono', monospace;
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          transition: all 0.1s linear;
        }

        .hud-btn-danger:hover {
          background: oklch(0.65 0.25 25);
          color: white;
        }

        .stats-bar {
          background: var(--comp-text);
          color: var(--comp-accent);
          font-family: 'Space Mono', monospace;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border-bottom: 1px solid oklch(0.2 0.01 0);
        }

        .stat-item span:first-child {
          color: var(--comp-muted);
        }

        .recipe-card {
          background: var(--comp-bg);
          border: 2px solid var(--comp-border);
          transition: all 0.12s linear;
        }

        .recipe-card:hover {
          background: var(--comp-accent);
          border-color: var(--comp-text);
          padding-left: 1.5rem;
        }

        .recipe-card-active {
          background: var(--comp-accent);
          border-color: var(--comp-text);
        }

        .recipe-thumb {
          border: 2px solid var(--comp-border);
          background: oklch(0.75 0.01 90);
        }

        .recipe-card-title {
          font-weight: 900;
          font-size: 0.95rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .recipe-card-meta {
          font-family: 'Space Mono', monospace;
          font-size: 0.6rem;
          color: var(--comp-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .recipe-card:hover .recipe-card-meta {
          color: var(--comp-accent-text);
          opacity: 0.7;
        }

        .category-badge {
          font-family: 'Space Mono', monospace;
          font-size: 0.55rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          background: var(--comp-text);
          color: var(--comp-accent);
          border: 1px solid var(--comp-text);
        }

        .detail-hero {
          background: var(--comp-text);
          color: var(--comp-accent);
        }

        .detail-title {
          font-weight: 900;
          font-size: clamp(2rem, 6vw, 4rem);
          text-transform: uppercase;
          letter-spacing: -0.02em;
          line-height: 0.95;
          color: var(--comp-bg);
        }

        .detail-label {
          font-family: 'Space Mono', monospace;
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: var(--comp-accent);
          opacity: 0.7;
        }

        .detail-value {
          font-family: 'Space Mono', monospace;
          font-size: 0.85rem;
          color: var(--comp-accent);
          font-weight: 700;
        }

        .dish-visual-container {
          border: 3px solid var(--comp-accent);
          background: oklch(0.15 0.01 0);
          box-shadow: 0 0 40px oklch(0.90 0.20 110 / 0.15);
        }

        .section-heading {
          font-family: 'Space Mono', monospace;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: var(--comp-text);
          border-bottom: 2px solid var(--comp-text);
        }

        .ingredient-item {
          font-size: 0.9rem;
          border-bottom: 1px solid oklch(0.05 0.01 0 / 0.1);
        }

        .instruction-step {
          border-left: 3px solid var(--comp-accent);
          font-size: 0.9rem;
        }

        .step-num {
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          font-size: 0.7rem;
          color: var(--comp-accent-text);
          background: var(--comp-accent);
          border: 2px solid var(--comp-text);
        }

        .form-panel {
          background: var(--comp-bg);
          border: 2px solid var(--comp-border);
        }

        .form-label {
          font-family: 'Space Mono', monospace;
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--comp-text);
        }

        .form-input {
          background: white;
          border: 2px solid var(--comp-border);
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
          color: var(--comp-text);
          transition: border-color 0.1s linear;
        }

        .form-input:focus {
          border-color: var(--comp-accent);
          outline: none;
          box-shadow: 3px 3px 0 var(--comp-accent);
        }

        .form-select {
          background: white;
          border: 2px solid var(--comp-border);
          font-family: 'Space Mono', monospace;
          font-size: 0.8rem;
          color: var(--comp-text);
          transition: border-color 0.1s linear;
        }

        .form-select:focus {
          border-color: var(--comp-accent);
          outline: none;
        }

        .form-textarea {
          background: white;
          border: 2px solid var(--comp-border);
          font-family: 'Inter', sans-serif;
          font-size: 0.85rem;
          color: var(--comp-text);
          transition: border-color 0.1s linear;
        }

        .form-textarea:focus {
          border-color: var(--comp-accent);
          outline: none;
          box-shadow: 3px 3px 0 var(--comp-accent);
        }

        .photo-upload-zone {
          border: 2px dashed var(--comp-border);
          background: oklch(0.92 0.01 90);
          color: var(--comp-muted);
          font-family: 'Space Mono', monospace;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          transition: all 0.12s linear;
        }

        .photo-upload-zone:hover {
          border-color: var(--comp-accent);
          background: oklch(0.95 0.05 110 / 0.3);
        }

        .photo-preview {
          border: 2px solid var(--comp-border);
        }

        .empty-state {
          color: var(--comp-muted);
        }

        .empty-label {
          font-family: 'Space Mono', monospace;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--comp-muted);
        }

        .scan-line {
          background: linear-gradient(transparent, var(--comp-accent), transparent);
          opacity: 0.03;
        }

        .corner-bracket::before,
        .corner-bracket::after {
          border-color: var(--comp-accent);
        }
        /* @theme:surfaces:end */

        /* @theme:motion */
        @keyframes scanDown {
          0% { top: -10%; }
          100% { top: 110%; }
        }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulseGlow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        /* @theme:motion:end */

        /* Pure layout */
        .app-root {
          min-height: 100vh;
          overflow-x: hidden;
          position: relative;
        }

        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.6rem 1rem;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .hud-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .hud-right {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .hud-btn, .hud-btn-ghost, .hud-btn-danger {
          padding: 0.4rem 1rem;
          cursor: pointer;
        }

        .stats-bar {
          display: flex;
          align-items: center;
          gap: 2rem;
          padding: 0.4rem 1rem;
        }

        .stat-item {
          display: flex;
          gap: 0.4rem;
        }

        .main-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1.5rem 1rem;
        }

        /* Recipe List */
        .recipe-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .recipe-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem 1rem;
          cursor: pointer;
          animation: fadeSlideIn 0.2s linear both;
        }

        .recipe-thumb {
          width: 56px;
          height: 56px;
          object-fit: cover;
          flex-shrink: 0;
        }

        .recipe-thumb-placeholder {
          width: 56px;
          height: 56px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .recipe-info {
          flex: 1;
          min-width: 0;
        }

        .recipe-card-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .recipe-card-bottom {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-top: 0.25rem;
        }

        .category-badge {
          padding: 0.1rem 0.5rem;
        }

        .recipe-card-stars {
          display: flex;
          align-items: center;
          margin-left: auto;
          flex-shrink: 0;
        }

        .star-rating {
          display: flex;
          gap: 2px;
          align-items: center;
        }

        /* Detail View */
        .detail-hero {
          padding: 2rem 1.5rem;
          position: relative;
          overflow: hidden;
        }

        .detail-hero-inner {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        @media (min-width: 768px) {
          .detail-hero-inner {
            flex-direction: row;
            align-items: center;
          }
        }

        .detail-text {
          flex: 1;
        }

        .detail-meta-row {
          display: flex;
          gap: 1.5rem;
          margin-top: 1rem;
        }

        .detail-meta-item {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }

        .dish-visual-container {
          width: 200px;
          height: 200px;
          overflow: hidden;
          flex-shrink: 0;
          position: relative;
          perspective: 600px;
        }

        .dish-visual-container img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .detail-body {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1.5rem 1rem;
          display: grid;
          gap: 2rem;
        }

        @media (min-width: 768px) {
          .detail-body {
            grid-template-columns: 1fr 1.5fr;
          }
        }

        .section-heading {
          padding-bottom: 0.5rem;
          margin-bottom: 1rem;
        }

        .ingredients-list {
          display: flex;
          flex-direction: column;
        }

        .ingredient-item {
          padding: 0.5rem 0;
        }

        .instructions-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .instruction-step {
          padding: 0.75rem 1rem;
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
        }

        .step-num {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .detail-actions {
          display: flex;
          gap: 0.75rem;
          padding: 1rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        /* Form */
        .form-panel {
          padding: 1.5rem;
          max-width: 700px;
          margin: 0 auto;
        }

        .form-grid {
          display: grid;
          gap: 1.25rem;
        }

        .form-row {
          display: grid;
          gap: 1rem;
        }

        @media (min-width: 640px) {
          .form-row-2 {
            grid-template-columns: 1fr 1fr;
          }
          .form-row-3 {
            grid-template-columns: 1fr 1fr 1fr;
          }
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .form-label {
          display: block;
        }

        .form-input, .form-select, .form-textarea {
          width: 100%;
          padding: 0.6rem 0.75rem;
          box-sizing: border-box;
        }

        .form-textarea {
          min-height: 100px;
          resize: vertical;
        }

        .photo-upload-zone {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          position: relative;
        }

        .photo-upload-zone input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .photo-preview {
          max-width: 100%;
          max-height: 200px;
          object-fit: cover;
        }

        .form-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem 1rem;
          gap: 1rem;
        }

        .scan-line {
          position: fixed;
          left: 0;
          width: 100%;
          height: 80px;
          pointer-events: none;
          z-index: 1000;
          animation: scanDown 8s linear infinite;
        }

        .target-deco {
          position: absolute;
        }

        .corner-bracket {
          position: relative;
        }

        .corner-bracket::before {
          content: '';
          position: absolute;
          top: -4px;
          left: -4px;
          width: 12px;
          height: 12px;
          border-top: 2px solid;
          border-left: 2px solid;
        }

        .corner-bracket::after {
          content: '';
          position: absolute;
          bottom: -4px;
          right: -4px;
          width: 12px;
          height: 12px;
          border-bottom: 2px solid;
          border-right: 2px solid;
        }
      `}</style>

      {/* @theme:decoration */}
      <div className="scan-line" />
      {/* @theme:decoration:end */}

      {/* HUD HEADER */}
      <header className="hud-header">
        <div className="hud-left">
          <CrosshairIcon size={16} />
          <span className="hud-title">Recipe Box</span>
          <span className="hud-status">[ HUD v1.0 ]</span>
        </div>
        <div className="hud-right">
          {view !== "list" && (
            <button className="hud-btn-ghost" onClick={goBack}>← Back</button>
          )}
          {view === "list" && (
            <button className="hud-btn" onClick={startNew}>+ New Recipe</button>
          )}
        </div>
      </header>

      {/* STATS BAR */}
      <div className="stats-bar">
        <div className="stat-item">
          <span>Catalog:</span>
          <strong>{recipes.rows.length}</strong>
        </div>
        <div className="stat-item">
          <span>Avg Rating:</span>
          <strong>{avgRating} / 5</strong>
        </div>
        <div className="stat-item">
          <span>Status:</span>
          <strong style={{ animation: "pulseGlow 3s linear infinite" }}>● Online</strong>
        </div>
      </div>

      {/* MAIN CONTENT */}
      {view === "list" && (
        <div className="main-content">
          {sortedRecipes.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="recipe-list">
              {sortedRecipes.map((row, i) => (
                <div
                  key={row.doc._id}
                  className="recipe-card"
                  onClick={() => openRecipe(row.doc._id)}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  {imageUrls[row.doc._id] ? (
                    <img src={imageUrls[row.doc._id]} alt="" className="recipe-thumb" />
                  ) : (
                    <div className="recipe-thumb recipe-thumb-placeholder">
                      <FlameIcon size={20} color="var(--comp-muted)" />
                    </div>
                  )}
                  <div className="recipe-info">
                    <div className="recipe-card-title">{row.doc.title}</div>
                    <div className="recipe-card-bottom">
                      {row.doc.category && (
                        <span className="category-badge">{row.doc.category}</span>
                      )}
                      <span className="recipe-card-meta">
                        {row.doc.prepTime && `[${row.doc.prepTime}]`}
                        {row.doc.servings && ` — ${row.doc.servings} srv`}
                      </span>
                    </div>
                  </div>
                  <div className="recipe-card-stars">
                    <StarRating rating={row.doc.rating || 0} size={16} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "detail" && doc?.title && (
        <div>
          <section className="detail-hero" onMouseMove={handleHeroMouse}>
            <div className="detail-hero-inner">
              <div className="detail-text">
                <div className="detail-title corner-bracket">{doc.title}</div>
                <div className="detail-meta-row">
                  {doc.category && (
                    <div className="detail-meta-item">
                      <span className="detail-label">Category</span>
                      <span className="detail-value">{doc.category}</span>
                    </div>
                  )}
                  {doc.prepTime && (
                    <div className="detail-meta-item">
                      <span className="detail-label">Prep Time</span>
                      <span className="detail-value">{doc.prepTime}</span>
                    </div>
                  )}
                  {doc.servings && (
                    <div className="detail-meta-item">
                      <span className="detail-label">Servings</span>
                      <span className="detail-value">{doc.servings}</span>
                    </div>
                  )}
                  <div className="detail-meta-item">
                    <span className="detail-label">Rating</span>
                    <StarRating rating={doc.rating || 0} size={18} />
                  </div>
                </div>
              </div>
              {selectedImageUrl && (
                <div className="dish-visual-container" id="heroVisual">
                  <img src={selectedImageUrl} alt={doc.title} />
                </div>
              )}
            </div>
            <div style={{ position: "absolute", top: 16, right: 16, opacity: 0.15 }}>
              <TargetDecoration />
            </div>
          </section>

          <div className="detail-actions">
            <button className="hud-btn" onClick={editRecipe}>Edit Recipe</button>
            <button className="hud-btn-danger" onClick={handleDelete}>Delete</button>
          </div>

          <div className="detail-body">
            {doc.ingredients && (
              <div>
                <div className="section-heading">
                  <FlameIcon size={14} /> Ingredients
                </div>
                <div className="ingredients-list">
                  {doc.ingredients.split("\n").filter(Boolean).map((ing, i) => (
                    <div key={i} className="ingredient-item">→ {ing.trim()}</div>
                  ))}
                </div>
              </div>
            )}
            {doc.instructions && (
              <div>
                <div className="section-heading">
                  <ClockIcon size={14} /> Instructions
                </div>
                <div className="instructions-list">
                  {doc.instructions.split("\n").filter(Boolean).map((step, i) => (
                    <div key={i} className="instruction-step">
                      <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
                      <span>{step.trim()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="main-content">
          <div className="form-panel">
            <div className="section-heading" style={{ marginBottom: "1.5rem" }}>
              {selectedId ? "Edit Recipe" : "New Recipe Entry"}
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Recipe Title</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Enter recipe name..."
                  value={doc.title || ""}
                  onChange={e => setDoc({ title: e.target.value })}
                />
              </div>

              <div className="form-row form-row-3">
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={doc.category || ""}
                    onChange={e => setDoc({ category: e.target.value })}
                  >
                    <option value="">Select...</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Prep Time</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. 30 min"
                    value={doc.prepTime || ""}
                    onChange={e => setDoc({ prepTime: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Servings</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. 4"
                    value={doc.servings || ""}
                    onChange={e => setDoc({ servings: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Rating</label>
                <StarRating
                  rating={doc.rating || 0}
                  onChange={r => setDoc({ rating: r })}
                  size={28}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Photo</label>
                {(selectedImageUrl) ? (
                  <div>
                    <img src={selectedImageUrl} alt="Preview" className="photo-preview" />
                    <div style={{ marginTop: "0.5rem" }}>
                      <label className="photo-upload-zone" style={{ padding: "0.75rem" }}>
                        <CameraIcon size={16} />
                        <span>Change Photo</span>
                        <input type="file" accept="image/*" onChange={handlePhotoChange} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="photo-upload-zone">
                    <CameraIcon size={28} color="var(--comp-muted)" />
                    <span>Click to upload photo</span>
                    <input type="file" accept="image/*" onChange={handlePhotoChange} />
                  </label>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Ingredients (one per line)</label>
                <textarea
                  className="form-textarea"
                  placeholder={"2 cups flour\n1 cup sugar\n3 eggs"}
                  value={doc.ingredients || ""}
                  onChange={e => setDoc({ ingredients: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Instructions (one step per line)</label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: "140px" }}
                  placeholder={"Preheat oven to 350°F\nMix dry ingredients\nAdd wet ingredients"}
                  value={doc.instructions || ""}
                  onChange={e => setDoc({ instructions: e.target.value })}
                />
              </div>

              <div className="form-actions">
                <button className="hud-btn" onClick={handleSave}>
                  {selectedId ? "Update Recipe" : "Save Recipe"}
                </button>
                <button className="hud-btn-ghost" onClick={goBack}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
