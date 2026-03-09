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

/* ─── SVG Plant Avatars ─── */

function MonsteraAvatar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" className="plant-avatar">
      <rect width="60" height="60" rx="8" fill="var(--comp-text)" opacity="0.08" />
      <g transform="translate(10, 8)">
        <path d="M20 45 C20 45 20 25 20 20" stroke="var(--comp-text)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M20 20 C10 15 2 20 5 10 C8 5 15 3 20 8 C18 12 16 16 20 20Z" fill="var(--comp-text)" opacity="0.7">
          <animate attributeName="d" dur="4s" repeatCount="indefinite" values="M20 20 C10 15 2 20 5 10 C8 5 15 3 20 8 C18 12 16 16 20 20Z;M20 20 C9 14 1 19 4 9 C7 4 14 2 20 7 C18 11 16 15 20 20Z;M20 20 C10 15 2 20 5 10 C8 5 15 3 20 8 C18 12 16 16 20 20Z" />
        </path>
        <path d="M20 18 C30 13 38 18 35 8 C32 3 25 1 20 6 C22 10 24 14 20 18Z" fill="var(--comp-text)" opacity="0.85">
          <animate attributeName="d" dur="5s" repeatCount="indefinite" values="M20 18 C30 13 38 18 35 8 C32 3 25 1 20 6 C22 10 24 14 20 18Z;M20 18 C31 14 39 19 36 9 C33 4 26 2 20 7 C22 11 24 15 20 18Z;M20 18 C30 13 38 18 35 8 C32 3 25 1 20 6 C22 10 24 14 20 18Z" />
        </path>
        <circle cx="12" cy="14" r="2.5" fill="var(--comp-bg)" opacity="0.6" />
        <circle cx="28" cy="12" r="2" fill="var(--comp-bg)" opacity="0.5" />
        <circle cx="22" cy="30" r="1" fill="var(--comp-text)" opacity="0.3" />
        <path d="M16 42 Q20 38 24 42" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" opacity="0.4" />
      </g>
    </svg>
  );
}

function SucculentAvatar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" className="plant-avatar">
      <rect width="60" height="60" rx="8" fill="var(--comp-text)" opacity="0.08" />
      <g transform="translate(12, 10)">
        <ellipse cx="18" cy="38" rx="10" ry="6" fill="var(--comp-text)" opacity="0.15" />
        <path d="M18 40 C18 40 10 38 8 30 C6 22 12 18 18 22 C24 18 30 22 28 30 C26 38 18 40 18 40Z" fill="var(--comp-text)" opacity="0.6">
          <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.6;0.7;0.6" />
        </path>
        <path d="M18 22 C14 16 16 8 18 4 C20 8 22 16 18 22Z" fill="var(--comp-text)" opacity="0.75" />
        <path d="M12 26 C6 22 4 14 6 10 C10 14 14 20 12 26Z" fill="var(--comp-text)" opacity="0.5" />
        <path d="M24 26 C30 22 32 14 30 10 C26 14 22 20 24 26Z" fill="var(--comp-text)" opacity="0.5" />
        <line x1="18" y1="22" x2="18" y2="6" stroke="var(--comp-bg)" strokeWidth="0.8" opacity="0.4" />
      </g>
    </svg>
  );
}

function TrailingAvatar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" className="plant-avatar">
      <rect width="60" height="60" rx="8" fill="var(--comp-text)" opacity="0.08" />
      <g transform="translate(8, 5)">
        <rect x="12" y="6" width="20" height="14" rx="2" fill="var(--comp-text)" opacity="0.2" />
        <path d="M14 20 C10 28 6 32 4 42" stroke="var(--comp-text)" strokeWidth="1.8" fill="none" strokeLinecap="round">
          <animate attributeName="d" dur="6s" repeatCount="indefinite" values="M14 20 C10 28 6 32 4 42;M14 20 C9 27 5 33 3 43;M14 20 C10 28 6 32 4 42" />
        </path>
        <path d="M22 20 C26 30 30 36 34 44" stroke="var(--comp-text)" strokeWidth="1.8" fill="none" strokeLinecap="round">
          <animate attributeName="d" dur="5s" repeatCount="indefinite" values="M22 20 C26 30 30 36 34 44;M22 20 C27 31 31 37 35 45;M22 20 C26 30 30 36 34 44" />
        </path>
        <circle cx="4" cy="42" r="3" fill="var(--comp-text)" opacity="0.5" />
        <circle cx="34" cy="44" r="3" fill="var(--comp-text)" opacity="0.5" />
        <circle cx="10" cy="30" r="2.5" fill="var(--comp-text)" opacity="0.4" />
        <circle cx="28" cy="32" r="2.5" fill="var(--comp-text)" opacity="0.4" />
        <path d="M16 10 C18 4 20 4 22 10" stroke="var(--comp-text)" strokeWidth="1.5" fill="var(--comp-text)" opacity="0.6" />
        <path d="M20 8 C22 2 24 2 26 8" stroke="var(--comp-text)" strokeWidth="1.2" fill="var(--comp-text)" opacity="0.45" />
      </g>
    </svg>
  );
}

function FiddleLeafAvatar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" className="plant-avatar">
      <rect width="60" height="60" rx="8" fill="var(--comp-text)" opacity="0.08" />
      <g transform="translate(14, 5)">
        <path d="M16 48 C16 48 16 22 16 18" stroke="var(--comp-text)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M16 18 C8 14 4 8 8 2 C12 -2 16 4 16 10Z" fill="var(--comp-text)" opacity="0.8">
          <animate attributeName="d" dur="4.5s" repeatCount="indefinite" values="M16 18 C8 14 4 8 8 2 C12 -2 16 4 16 10Z;M16 18 C7 13 3 7 7 1 C11 -3 16 3 16 9Z;M16 18 C8 14 4 8 8 2 C12 -2 16 4 16 10Z" />
        </path>
        <path d="M16 18 C24 14 28 8 24 2 C20 -2 16 4 16 10Z" fill="var(--comp-text)" opacity="0.65" />
        <path d="M16 30 C8 26 6 20 10 16" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" opacity="0.4" />
        <path d="M16 30 C24 26 26 20 22 16" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" opacity="0.4" />
        <line x1="16" y1="18" x2="16" y2="4" stroke="var(--comp-bg)" strokeWidth="0.7" opacity="0.5" />
        <path d="M12 44 Q16 40 20 44" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" opacity="0.3" />
      </g>
    </svg>
  );
}

function CalatheaAvatar({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" className="plant-avatar">
      <rect width="60" height="60" rx="8" fill="var(--comp-text)" opacity="0.08" />
      <g transform="translate(10, 6)">
        <path d="M20 46 C20 46 20 20 20 16" stroke="var(--comp-text)" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="20" cy="14" rx="14" ry="10" fill="var(--comp-text)" opacity="0.55">
          <animate attributeName="ry" dur="5s" repeatCount="indefinite" values="10;11;10" />
        </ellipse>
        <line x1="20" y1="4" x2="20" y2="24" stroke="var(--comp-bg)" strokeWidth="1" opacity="0.5" />
        <path d="M10 10 Q14 14 20 14" stroke="var(--comp-bg)" strokeWidth="0.8" fill="none" opacity="0.4" />
        <path d="M30 10 Q26 14 20 14" stroke="var(--comp-bg)" strokeWidth="0.8" fill="none" opacity="0.4" />
        <path d="M12 18 Q16 16 20 18" stroke="var(--comp-bg)" strokeWidth="0.8" fill="none" opacity="0.4" />
        <path d="M28 18 Q24 16 20 18" stroke="var(--comp-bg)" strokeWidth="0.8" fill="none" opacity="0.4" />
        <path d="M16 42 Q20 38 24 42" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" opacity="0.3" />
      </g>
    </svg>
  );
}

function WaterDropIcon({ size = 16, animated = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2 C8 2 3 8 3 11 C3 13.8 5.2 15 8 15 C10.8 15 13 13.8 13 11 C13 8 8 2 8 2Z" fill="var(--comp-text)" opacity="0.7">
        {animated && <animate attributeName="opacity" dur="2s" repeatCount="indefinite" values="0.7;0.3;0.7" />}
      </path>
    </svg>
  );
}

function SunIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3.5" stroke="var(--comp-text)" strokeWidth="1.5" fill="none" />
      <line x1="8" y1="1" x2="8" y2="3" stroke="var(--comp-text)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="13" x2="8" y2="15" stroke="var(--comp-text)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="8" x2="3" y2="8" stroke="var(--comp-text)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="8" x2="15" y2="8" stroke="var(--comp-text)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ScissorsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="12" r="2.5" stroke="var(--comp-text)" strokeWidth="1.3" fill="none" />
      <circle cx="12" cy="12" r="2.5" stroke="var(--comp-text)" strokeWidth="1.3" fill="none" />
      <line x1="5.5" y1="10" x2="12" y2="2" stroke="var(--comp-text)" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="10.5" y1="10" x2="4" y2="2" stroke="var(--comp-text)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SprayIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="5" y="6" width="6" height="9" rx="1" stroke="var(--comp-text)" strokeWidth="1.3" fill="none" />
      <path d="M7 6 L7 4 L10 2" stroke="var(--comp-text)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <circle cx="3" cy="2" r="0.8" fill="var(--comp-text)" opacity="0.5" />
      <circle cx="5" cy="1" r="0.6" fill="var(--comp-text)" opacity="0.4" />
      <circle cx="2" cy="4" r="0.5" fill="var(--comp-text)" opacity="0.3" />
    </svg>
  );
}

function FloatingBubbles() {
  return (
    <svg className="floating-bubbles" viewBox="0 0 400 600" preserveAspectRatio="none">
      <circle cx="50" cy="500" r="4" fill="var(--comp-text)" opacity="0.06">
        <animate attributeName="cy" dur="8s" repeatCount="indefinite" values="500;100;500" />
        <animate attributeName="opacity" dur="8s" repeatCount="indefinite" values="0.06;0.12;0.06" />
      </circle>
      <circle cx="150" cy="450" r="3" fill="var(--comp-text)" opacity="0.05">
        <animate attributeName="cy" dur="10s" repeatCount="indefinite" values="450;50;450" />
        <animate attributeName="opacity" dur="10s" repeatCount="indefinite" values="0.05;0.1;0.05" />
      </circle>
      <circle cx="250" cy="520" r="5" fill="var(--comp-text)" opacity="0.04">
        <animate attributeName="cy" dur="12s" repeatCount="indefinite" values="520;80;520" />
        <animate attributeName="opacity" dur="12s" repeatCount="indefinite" values="0.04;0.08;0.04" />
      </circle>
      <circle cx="320" cy="480" r="2.5" fill="var(--comp-text)" opacity="0.07">
        <animate attributeName="cy" dur="7s" repeatCount="indefinite" values="480;120;480" />
        <animate attributeName="opacity" dur="7s" repeatCount="indefinite" values="0.07;0.14;0.07" />
      </circle>
      <circle cx="380" cy="550" r="3.5" fill="var(--comp-text)" opacity="0.05">
        <animate attributeName="cy" dur="9s" repeatCount="indefinite" values="550;60;550" />
      </circle>
    </svg>
  );
}

function EmptyStatePlant() {
  return (
    <svg width="180" height="200" viewBox="0 0 180 200" fill="none" className="empty-state-svg">
      <path d="M90 190 C90 190 90 120 90 100" stroke="var(--comp-text)" strokeWidth="3" strokeLinecap="round" opacity="0.5">
        <animate attributeName="d" dur="3s" repeatCount="indefinite" values="M90 190 C90 190 90 120 90 100;M90 190 C90 190 90 118 90 98;M90 190 C90 190 90 120 90 100" />
      </path>
      <path d="M90 100 C65 85 50 60 60 35 C70 15 85 20 90 40 C88 55 86 75 90 100Z" fill="var(--comp-text)" opacity="0.25">
        <animate attributeName="d" dur="5s" repeatCount="indefinite" values="M90 100 C65 85 50 60 60 35 C70 15 85 20 90 40 C88 55 86 75 90 100Z;M90 100 C63 83 48 58 58 33 C68 13 83 18 90 38 C88 53 86 73 90 100Z;M90 100 C65 85 50 60 60 35 C70 15 85 20 90 40 C88 55 86 75 90 100Z" />
      </path>
      <path d="M90 100 C115 85 130 60 120 35 C110 15 95 20 90 40 C92 55 94 75 90 100Z" fill="var(--comp-text)" opacity="0.2" />
      <circle cx="75" cy="60" r="5" fill="var(--comp-bg)" opacity="0.4" />
      <circle cx="105" cy="55" r="4" fill="var(--comp-bg)" opacity="0.3" />
      <ellipse cx="90" cy="192" rx="25" ry="5" fill="var(--comp-text)" opacity="0.08" />
      <text x="90" y="175" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--comp-text)" opacity="0.4" letterSpacing="0.1em">ADD YOUR FIRST PLANT</text>
    </svg>
  );
}

/* ─── Plant Avatar Map ─── */

const PLANT_AVATARS = {
  monstera: MonsteraAvatar,
  succulent: SucculentAvatar,
  trailing: TrailingAvatar,
  fiddle: FiddleLeafAvatar,
  calathea: CalatheaAvatar,
};

const CARE_TYPES = [
  { id: "water", label: "HYDRATION", icon: WaterDropIcon },
  { id: "mist", label: "MISTING", icon: SprayIcon },
  { id: "prune", label: "PRUNING", icon: ScissorsIcon },
  { id: "light", label: "SUNLIGHT", icon: SunIcon },
];

const AVATAR_OPTIONS = [
  { id: "monstera", label: "Monstera" },
  { id: "succulent", label: "Succulent" },
  { id: "trailing", label: "Trailing" },
  { id: "fiddle", label: "Fiddle Leaf" },
  { id: "calathea", label: "Calathea" },
];

/* ─── Main App ─── */

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery, useDocument } = useFireproofClerk("happy-plants-db");

  const [activeFilter, setActiveFilter] = React.useState("ALL");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [selectedPlantId, setSelectedPlantId] = React.useState(null);

  const plants = useLiveQuery("type", { key: "plant" });

  const [newPlant, setNewPlant, saveNewPlant] = useDocument({
    type: "plant",
    name: "",
    species: "",
    avatar: "monstera",
    careType: "water",
    intervalDays: 7,
    lastCared: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const getDaysUntilCare = React.useCallback((plant) => {
    const last = new Date(plant.lastCared);
    const next = new Date(last);
    next.setDate(next.getDate() + (plant.intervalDays || 7));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    next.setHours(0, 0, 0, 0);
    const diff = Math.ceil((next - now) / (1000 * 60 * 60 * 24));
    return diff;
  }, []);

  const getStatusLabel = React.useCallback((days) => {
    if (days <= 0) return "DUE NOW";
    if (days === 1) return "TOMORROW";
    return `IN ${String(days).padStart(2, "0")} DAYS`;
  }, []);

  const getFilterStatus = React.useCallback((days) => {
    if (days <= 0) return "THIRSTY";
    if (days <= 3) return "SOON";
    return "HAPPY";
  }, []);

  const filteredPlants = React.useMemo(() => {
    let list = plants.docs || [];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.species.toLowerCase().includes(q));
    }
    if (activeFilter !== "ALL") {
      list = list.filter(p => {
        const days = getDaysUntilCare(p);
        const status = getFilterStatus(days);
        return status === activeFilter;
      });
    }
    return list.sort((a, b) => getDaysUntilCare(a) - getDaysUntilCare(b));
  }, [plants.docs, searchTerm, activeFilter, getDaysUntilCare, getFilterStatus]);

  const duePlants = React.useMemo(() => {
    return (plants.docs || []).filter(p => getDaysUntilCare(p) <= 0);
  }, [plants.docs, getDaysUntilCare]);

  const selectedPlant = React.useMemo(() => {
    if (!selectedPlantId) return null;
    return (plants.docs || []).find(p => p._id === selectedPlantId);
  }, [plants.docs, selectedPlantId]);

  const handleAddPlant = React.useCallback(async () => {
    if (!newPlant.name.trim()) return;
    await saveNewPlant();
    setShowAddForm(false);
    setNewPlant({
      type: "plant",
      name: "",
      species: "",
      avatar: "monstera",
      careType: "water",
      intervalDays: 7,
      lastCared: new Date().toISOString().split("T")[0],
      notes: "",
    });
  }, [newPlant, saveNewPlant, setNewPlant]);

  const handleWaterPlant = React.useCallback(async (plant) => {
    await database.put({
      ...plant,
      lastCared: new Date().toISOString().split("T")[0],
    });
  }, [database]);

  const handleDeletePlant = React.useCallback(async (plant) => {
    await database.del(plant);
    if (selectedPlantId === plant._id) setSelectedPlantId(null);
  }, [database, selectedPlantId]);

  const careIcon = React.useCallback((careType) => {
    const ct = CARE_TYPES.find(c => c.id === careType);
    return ct ? ct.icon : WaterDropIcon;
  }, []);

  const careLabel = React.useCallback((careType) => {
    const ct = CARE_TYPES.find(c => c.id === careType);
    return ct ? ct.label : "HYDRATION";
  }, []);

  const filters = ["ALL", "THIRSTY", "SOON", "HAPPY"];

  return (
    <div className="app-root">
      <style>{`
        /* @theme:tokens */
        :root {
          --comp-bg: oklch(0.73 0.12 160);
          --comp-text: oklch(0.12 0.03 150);
          --comp-border: oklch(0.12 0.03 150);
          --comp-accent: oklch(0.12 0.03 150);
          --comp-accent-text: oklch(0.73 0.12 160);
          --comp-muted: oklch(0.12 0.03 150 / 0.6);
          --color-background: oklch(0.73 0.12 160);
          --font-serif: 'Playfair Display', serif;
          --font-mono: 'Space Mono', monospace;
          --grid-border: 1px solid var(--comp-border);
          --pad-lg: 40px;
          --pad-md: 20px;
          --sidebar-width: 60px;
        }
        /* @theme:tokens:end */

        /* @theme:typography */
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap');
        /* @theme:typography:end */

        /* @theme:surfaces */
        .app-root {
          background-color: var(--comp-bg);
          color: var(--comp-text);
          font-family: var(--font-mono);
          -webkit-font-smoothing: antialiased;
        }

        .sidebar {
          border-right: var(--grid-border);
          background-color: var(--comp-bg);
        }

        .util-btn {
          border-radius: 50%;
          border: var(--grid-border);
          background: transparent;
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.8rem;
          transition: all 0.2s ease;
        }

        .util-btn:hover {
          background: var(--comp-text);
          color: var(--comp-bg);
        }

        .sidebar-nav {
          font-size: 0.65rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
        }

        .sidebar-nav span {
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .sidebar-nav span:hover {
          opacity: 1;
        }

        .header {
          border-bottom: var(--grid-border);
        }

        .header-title {
          font-family: var(--font-serif);
          font-size: clamp(3rem, 6vw, 4.5rem);
          font-weight: 400;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .header-desc {
          font-size: 0.75rem;
          line-height: 1.6;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .wavy-text {
          background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0,5 Q12.5,0 25,5 T50,5 T75,5 T100,5" fill="none" stroke="%230b130e" stroke-width="1.2"/></svg>') bottom repeat-x;
          background-size: 30px 8px;
        }

        .header-right {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sub-nav {
          border-bottom: var(--grid-border);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .nav-links span {
          opacity: 0.7;
          transition: opacity 0.2s, border-color 0.2s;
        }

        .nav-links span:hover {
          opacity: 1;
        }

        .nav-links span.active {
          border-bottom: 1px solid var(--comp-border);
          opacity: 1;
        }

        .search-input {
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--comp-border);
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .search-input::placeholder {
          color: var(--comp-text);
          opacity: 0.6;
        }

        .specimen-list {
          border-right: var(--grid-border);
        }

        .list-item {
          border-bottom: var(--grid-border);
          color: inherit;
          text-decoration: none;
          transition: background-color 0.2s ease;
        }

        .list-item:hover {
          background-color: oklch(0.12 0.03 150 / 0.04);
        }

        .list-item:hover .tag-pill {
          background: var(--comp-text);
          color: var(--comp-bg);
        }

        .list-item.selected {
          background-color: oklch(0.12 0.03 150 / 0.08);
        }

        .item-title {
          font-family: var(--font-serif);
          font-size: 1.4rem;
          font-weight: 400;
          letter-spacing: 0.01em;
        }

        .item-sub {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          opacity: 0.8;
        }

        .tag-pill {
          border: var(--grid-border);
          border-radius: 999px;
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transition: all 0.2s ease;
        }

        .tag-pill.due-now {
          background: var(--comp-text);
          color: var(--comp-bg);
        }

        .item-value {
          font-size: 0.8rem;
          font-weight: 700;
        }

        .item-value.overdue {
          opacity: 1;
        }

        .protocol-panel {
          background-color: var(--comp-bg);
        }

        .oval-stamp {
          border: var(--grid-border);
          border-radius: 50%;
          font-size: 0.55rem;
          line-height: 1.2;
          letter-spacing: 0.05em;
          background: var(--comp-bg);
        }

        .panel-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .panel-hr {
          border: none;
          border-top: var(--grid-border);
        }

        .panel-title {
          font-family: var(--font-serif);
          font-size: 1.8rem;
          font-weight: 400;
        }

        .panel-desc {
          font-size: 0.75rem;
          line-height: 1.6;
        }

        .task-item {
          font-size: 0.75rem;
        }

        .task-item span:first-child {
          opacity: 0.9;
        }

        .dotted-hr {
          border: none;
          border-top: 1px dashed var(--comp-border);
        }

        .total-row {
          font-size: 1.1rem;
          font-weight: 700;
        }

        .btn-action {
          border: var(--grid-border);
          background: transparent;
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          transition: all 0.2s ease;
        }

        .btn-action:hover {
          background: var(--comp-text);
          color: var(--comp-bg);
        }

        .btn-action:active {
          transform: scale(0.97);
        }

        .btn-small {
          border: var(--grid-border);
          background: transparent;
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transition: all 0.2s ease;
        }

        .btn-small:hover {
          background: var(--comp-text);
          color: var(--comp-bg);
        }

        .btn-danger:hover {
          background: oklch(0.55 0.2 25);
          color: oklch(0.98 0 0);
          border-color: oklch(0.55 0.2 25);
        }

        .form-overlay {
          background: oklch(0.12 0.03 150 / 0.3);
          backdrop-filter: blur(4px);
        }

        .form-panel {
          background: var(--comp-bg);
          border: var(--grid-border);
        }

        .form-title {
          font-family: var(--font-serif);
          font-size: 1.6rem;
          font-weight: 400;
        }

        .form-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          opacity: 0.8;
        }

        .form-input {
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--comp-border);
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.8rem;
        }

        .form-input:focus {
          border-bottom-width: 2px;
          outline: none;
        }

        .form-select {
          background: transparent;
          border: var(--grid-border);
          color: var(--comp-text);
          font-family: var(--font-mono);
          font-size: 0.75rem;
          text-transform: uppercase;
        }

        .avatar-option {
          border: var(--grid-border);
          opacity: 0.5;
          transition: all 0.2s ease;
        }

        .avatar-option:hover {
          opacity: 0.8;
        }

        .avatar-option.selected {
          opacity: 1;
          background: oklch(0.12 0.03 150 / 0.06);
        }

        .plant-avatar {
          transition: transform 0.3s ease;
        }

        .list-item:hover .plant-avatar {
          transform: scale(1.05);
        }

        .floating-bubbles {
          opacity: 0.6;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: var(--comp-text);
          font-size: 1.2rem;
          transition: opacity 0.2s;
          opacity: 0.6;
        }

        .close-btn:hover {
          opacity: 1;
        }

        .detail-action-row .btn-small {
          flex: 1;
        }

        .empty-state-svg text {
          font-family: var(--font-mono);
        }
        /* @theme:surfaces:end */

        /* @theme:motion */
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .list-item {
          animation: fadeSlideIn 0.3s ease both;
        }

        .list-item:nth-child(2) { animation-delay: 0.05s; }
        .list-item:nth-child(3) { animation-delay: 0.1s; }
        .list-item:nth-child(4) { animation-delay: 0.15s; }
        .list-item:nth-child(5) { animation-delay: 0.2s; }
        .list-item:nth-child(6) { animation-delay: 0.25s; }

        .form-overlay {
          animation: fadeIn 0.2s ease;
        }

        .form-panel {
          animation: fadeSlideIn 0.3s ease;
        }

        .item-value.overdue {
          animation: pulseGlow 2s ease-in-out infinite;
        }
        /* @theme:motion:end */

        /* Layout-only styles (no visual properties) */
        .app-root {
          min-height: 100vh;
          display: grid;
          grid-template-columns: var(--sidebar-width) 1fr;
          overflow-x: hidden;
        }

        .sidebar {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 25px 0 60px 0;
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          width: var(--sidebar-width);
          z-index: 10;
        }

        .sidebar-utils {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .util-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .sidebar-nav {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          display: flex;
          gap: 40px;
        }

        .sidebar-nav span {
          cursor: pointer;
        }

        .main-content {
          grid-column: 2;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }

        .header {
          padding: 45px var(--pad-lg);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .header-left {
          max-width: 60%;
        }

        .header-title {
          margin-bottom: 25px;
        }

        .wavy-text {
          position: relative;
          display: inline-block;
          padding-bottom: 6px;
        }

        .header-right {
          text-align: right;
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-top: 10px;
        }

        .sub-nav {
          padding: 15px var(--pad-lg);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .nav-links {
          display: flex;
          gap: 35px;
        }

        .nav-links span {
          cursor: pointer;
          padding-bottom: 4px;
        }

        .search-input {
          padding: 4px 0;
          width: 240px;
          outline: none;
        }

        .content-split {
          display: grid;
          grid-template-columns: 1fr 380px;
          flex-grow: 1;
          align-items: stretch;
        }

        .specimen-list {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }

        .list-item {
          display: grid;
          grid-template-columns: 60px 1.5fr 1fr 100px;
          gap: 30px;
          align-items: center;
          padding: 25px var(--pad-lg);
          cursor: pointer;
        }

        .item-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }

        .item-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tag-pill {
          padding: 5px 16px;
          text-align: center;
          width: fit-content;
        }

        .item-value {
          text-align: right;
          white-space: nowrap;
        }

        .protocol-panel {
          padding: var(--pad-lg);
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }

        .oval-stamp {
          position: absolute;
          top: 45px;
          right: 40px;
          width: 110px;
          height: 55px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          transform: rotate(-12deg);
          z-index: 2;
        }

        .panel-label {
          margin-bottom: 15px;
        }

        .panel-hr {
          margin: 0 0 25px 0;
        }

        .panel-title {
          margin-bottom: 20px;
          max-width: 80%;
        }

        .panel-desc {
          margin-bottom: 45px;
          max-width: 95%;
        }

        .task-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-bottom: 25px;
        }

        .task-item {
          display: flex;
          justify-content: space-between;
        }

        .dotted-hr {
          margin: 20px 0;
        }

        .total-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 40px;
        }

        .btn-action {
          margin-top: auto;
          padding: 22px;
          cursor: pointer;
          text-align: left;
        }

        .btn-small {
          padding: 8px 14px;
          cursor: pointer;
        }

        .form-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .form-panel {
          width: 100%;
          max-width: 480px;
          max-height: 90vh;
          overflow-y: auto;
          padding: var(--pad-lg);
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }

        .form-field {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          margin-bottom: 8px;
        }

        .form-input {
          width: 100%;
          padding: 8px 0;
          box-sizing: border-box;
        }

        .form-select {
          width: 100%;
          padding: 8px;
          box-sizing: border-box;
        }

        .avatar-grid {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .avatar-option {
          padding: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .form-actions {
          display: flex;
          gap: 12px;
          margin-top: 30px;
        }

        .form-actions .btn-action {
          flex: 1;
          text-align: center;
          padding: 16px;
        }

        .floating-bubbles {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
        }

        .close-btn {
          cursor: pointer;
          padding: 4px;
        }

        .detail-section {
          margin-bottom: 20px;
        }

        .detail-action-row {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }

        @media (max-width: 1100px) {
          .content-split {
            grid-template-columns: 1fr 320px;
          }
          .list-item {
            grid-template-columns: 50px 1fr auto 80px;
            gap: 20px;
            padding: 20px;
          }
        }

        @media (max-width: 850px) {
          .app-root {
            grid-template-columns: 1fr;
          }
          .sidebar {
            display: none;
          }
          .main-content {
            grid-column: 1;
          }
          .content-split {
            grid-template-columns: 1fr;
          }
          .specimen-list {
            border-right: none;
          }
          .protocol-panel {
            border-top: var(--grid-border);
          }
          .oval-stamp {
            top: 30px;
            right: 30px;
          }
          .nav-links {
            gap: 20px;
          }
          .search-input {
            width: 100%;
          }
          .list-item {
            grid-template-columns: 50px 1fr auto;
            padding: 20px var(--pad-lg);
          }
          .item-value {
            display: none;
          }
          .header {
            flex-direction: column;
            gap: 20px;
          }
          .header-left {
            max-width: 100%;
          }
          .header-right {
            text-align: left;
            flex-direction: row;
            gap: 20px;
          }
        }
      `}</style>

      {/* @theme:decoration */}
      <FloatingBubbles />
      {/* @theme:decoration:end */}

      <aside className="sidebar">
        <div className="sidebar-utils">
          <button className="util-btn" onClick={() => setShowAddForm(true)}>+</button>
          <button className="util-btn">?</button>
        </div>
        <div className="sidebar-nav">
          {CARE_TYPES.map(ct => (
            <span key={ct.id}>{ct.label}</span>
          ))}
        </div>
      </aside>

      <main className="main-content">
        <header className="header">
          <div className="header-left">
            <h1 className="header-title">Happy Plants</h1>
            <div className="header-desc">
              CURATED PROTOCOLS FOR OPTIMAL<br />
              GROWTH <br />
              <span className="wavy-text">& SPECIALIZED CARE.</span>
            </div>
          </div>
          <div className="header-right">
            <div>CYCLE: {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase()}</div>
            <div>{(plants.docs || []).length} SPECIMENS</div>
          </div>
        </header>

        <nav className="sub-nav">
          <div className="nav-links">
            {filters.map(f => (
              <span
                key={f}
                className={activeFilter === f ? "active" : ""}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </span>
            ))}
          </div>
          <div>
            <input
              type="text"
              className="search-input"
              placeholder="SEARCH BY SPECIMEN OR TYPE"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </nav>

        <section className="content-split">
          <div className="specimen-list">
            {filteredPlants.length === 0 && (
              <div className="empty-state">
                <EmptyStatePlant />
              </div>
            )}
            {filteredPlants.map((plant, i) => {
              const days = getDaysUntilCare(plant);
              const AvatarComponent = PLANT_AVATARS[plant.avatar] || MonsteraAvatar;
              const Icon = careIcon(plant.careType);
              return (
                <div
                  key={plant._id}
                  className={`list-item${selectedPlantId === plant._id ? " selected" : ""}`}
                  onClick={() => setSelectedPlantId(plant._id === selectedPlantId ? null : plant._id)}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <AvatarComponent size={60} />
                  <div className="item-details">
                    <div className="item-title">{plant.name}</div>
                    <div className="item-sub">{plant.species || "UNKNOWN SPECIES"}</div>
                  </div>
                  <div className={`tag-pill${days <= 0 ? " due-now" : ""}`}>
                    {careLabel(plant.careType)}
                  </div>
                  <div className={`item-value${days <= 0 ? " overdue" : ""}`}>
                    {getStatusLabel(days)}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="protocol-panel">
            <div className="oval-stamp">
              <span>{duePlants.length === 0 ? "ALL" : duePlants.length}</span>
              <span>{duePlants.length === 0 ? "PLANTS" : "PLANTS"}</span>
              <span>{duePlants.length === 0 ? "HAPPY" : "THIRSTY"}</span>
            </div>

            {selectedPlant ? (
              <>
                <div className="panel-label">SPECIMEN DETAIL</div>
                <hr className="panel-hr" />

                <h2 className="panel-title">{selectedPlant.name}</h2>
                <p className="panel-desc">
                  {selectedPlant.species && `Species: ${selectedPlant.species}. `}
                  {selectedPlant.notes || "No additional notes for this specimen."}
                </p>

                <div className="panel-label">CARE SCHEDULE</div>
                <hr className="panel-hr" />

                <div className="task-list">
                  <div className="task-item">
                    <span>Care Type</span>
                    <span>{careLabel(selectedPlant.careType)}</span>
                  </div>
                  <div className="task-item">
                    <span>Interval</span>
                    <span>EVERY {selectedPlant.intervalDays} DAYS</span>
                  </div>
                  <div className="task-item">
                    <span>Last Cared</span>
                    <span>{new Date(selectedPlant.lastCared).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</span>
                  </div>
                  <div className="task-item">
                    <span>Next Due</span>
                    <span>{getStatusLabel(getDaysUntilCare(selectedPlant))}</span>
                  </div>
                </div>

                <hr className="dotted-hr" />

                <div className="detail-action-row">
                  <button className="btn-small" onClick={() => handleWaterPlant(selectedPlant)}>
                    MARK DONE
                  </button>
                  <button className="btn-small btn-danger" onClick={() => handleDeletePlant(selectedPlant)}>
                    REMOVE
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="panel-label">CURRENT PROTOCOL</div>
                <hr className="panel-hr" />

                <h2 className="panel-title">Care Summary</h2>
                <p className="panel-desc">
                  Review your botanical specimens before initiating care protocols. Digital records update immediately upon completion.
                </p>

                <div className="panel-label">PENDING LOG</div>
                <hr className="panel-hr" />

                <div className="task-list">
                  {duePlants.length === 0 && (
                    <div className="task-item">
                      <span style={{ opacity: 0.5 }}>No pending tasks</span>
                      <span>—</span>
                    </div>
                  )}
                  {duePlants.map(p => (
                    <div className="task-item" key={p._id}>
                      <span>{p.name} {careLabel(p.careType).toLowerCase()}</span>
                      <span>DUE</span>
                    </div>
                  ))}
                </div>

                <hr className="dotted-hr" />

                <div className="total-row">
                  <span>Total Tasks</span>
                  <span>{String(duePlants.length).padStart(2, "0")}</span>
                </div>

                <button className="btn-action" onClick={() => {
                  if (duePlants.length > 0) {
                    duePlants.forEach(p => handleWaterPlant(p));
                  } else {
                    setShowAddForm(true);
                  }
                }}>
                  {duePlants.length > 0 ? "INITIATE PROTOCOL" : "ADD NEW SPECIMEN"}
                </button>
              </>
            )}
          </aside>
        </section>
      </main>

      {showAddForm && (
        <div className="form-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAddForm(false); }}>
          <div className="form-panel">
            <div className="form-header">
              <h2 className="form-title">New Specimen</h2>
              <button className="close-btn" onClick={() => setShowAddForm(false)}>&#x2715;</button>
            </div>

            <div className="form-field">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. My Monstera"
                value={newPlant.name}
                onChange={e => setNewPlant({ ...newPlant, name: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Species</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Monstera Deliciosa"
                value={newPlant.species}
                onChange={e => setNewPlant({ ...newPlant, species: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Avatar</label>
              <div className="avatar-grid">
                {AVATAR_OPTIONS.map(opt => {
                  const AvatarComp = PLANT_AVATARS[opt.id];
                  return (
                    <div
                      key={opt.id}
                      className={`avatar-option${newPlant.avatar === opt.id ? " selected" : ""}`}
                      onClick={() => setNewPlant({ ...newPlant, avatar: opt.id })}
                      title={opt.label}
                    >
                      <AvatarComp size={48} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Care Type</label>
              <select
                className="form-select"
                value={newPlant.careType}
                onChange={e => setNewPlant({ ...newPlant, careType: e.target.value })}
              >
                {CARE_TYPES.map(ct => (
                  <option key={ct.id} value={ct.id}>{ct.label}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Care Interval (Days)</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="90"
                value={newPlant.intervalDays}
                onChange={e => setNewPlant({ ...newPlant, intervalDays: parseInt(e.target.value) || 7 })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Last Cared</label>
              <input
                className="form-input"
                type="date"
                value={newPlant.lastCared}
                onChange={e => setNewPlant({ ...newPlant, lastCared: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Notes</label>
              <input
                className="form-input"
                type="text"
                placeholder="Optional care notes..."
                value={newPlant.notes}
                onChange={e => setNewPlant({ ...newPlant, notes: e.target.value })}
              />
            </div>

            <div className="form-actions">
              <button className="btn-action" onClick={() => setShowAddForm(false)}>CANCEL</button>
              <button className="btn-action" onClick={handleAddPlant}>ADD SPECIMEN</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
