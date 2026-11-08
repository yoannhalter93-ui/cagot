// Interface de l'appli au choix de l'artisan : couleurs, clair/sombre, taille du texte,
// raccourcis de la barre du bas, blocs de l'accueil. Réglages enregistrés avec le compte
// (même interface sur le téléphone et la tablette) et gardés sur l'appareil pour s'appliquer
// dès l'ouverture.

export const THEMES = [
  { id: "cagot", nom: "Cagot", principal: "#1f3b63", action: "#f07c1e", accent: "#f2b632", sombre: "#4a7bc0" },
  { id: "marine", nom: "Marine & vert", principal: "#1f3b63", action: "#2f8a4e", accent: "#f2b632", sombre: "#3d6aa8" },
  { id: "foret", nom: "Forêt", principal: "#24563c", action: "#2f8a4e", accent: "#e0b84a", sombre: "#3f8a63" },
  { id: "ardoise", nom: "Ardoise", principal: "#37424f", action: "#1a8fa0", accent: "#f0a43a", sombre: "#5d6d80" },
  { id: "bordeaux", nom: "Bordeaux", principal: "#6b2737", action: "#2f8a4e", accent: "#e9b949", sombre: "#a14a5f" },
  { id: "terre", nom: "Terre cuite", principal: "#7a3e1d", action: "#c8641e", accent: "#f2b632", sombre: "#b0653a" },
  { id: "logo", nom: "Mon logo", principal: null, action: "#2f8a4e", accent: "#f2b632", sombre: null },
];

export const RACCOURCIS = {
  accueil: { nom: "Accueil", svg: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>' },
  chantiers: { nom: "Chantiers", svg: '<path d="M4 18h16"/><path d="M6 18v-3a6 6 0 0 1 12 0v3"/><path d="M12 9V6M10 6h4"/>' },
  clients: { nom: "Clients", svg: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.4 0 4.1 1.5 4.6 4.3"/>' },
  devis: { nom: "Devis", svg: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>' },
  factures: { nom: "Factures", svg: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>' },
  notes: { nom: "Notes", svg: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>' },
};

export const BLOCS_ACCUEIL = {
  activite: "Mes chiffres (devis, factures, encaissé)",
  nouveau: "Bouton « Nouveau chantier »",
  chantiers: "Mes chantiers en cours",
};

export const TAILLES = { normale: 1, grande: 1.12, "tres-grande": 1.25 };

export const INTERFACE_DEFAUT = {
  theme: "marine",
  mode: "auto", // auto | clair | sombre
  taille: "normale",
  raccourcis: ["accueil", "chantiers", "clients"],
  accueil: [
    { id: "activite", visible: true },
    { id: "nouveau", visible: true },
    { id: "chantiers", visible: true },
  ],
};

// Réglages complets et valides (un réglage abîmé ou ancien retombe sur la valeur par défaut).
export function interfaceValide(i) {
  const v = { ...INTERFACE_DEFAUT, ...(i && typeof i === "object" ? i : {}) };
  if (!THEMES.some((t) => t.id === v.theme)) v.theme = INTERFACE_DEFAUT.theme;
  if (!["auto", "clair", "sombre"].includes(v.mode)) v.mode = "auto";
  if (!(v.taille in TAILLES)) v.taille = "normale";
  const r = Array.isArray(v.raccourcis) ? v.raccourcis.filter((x) => x in RACCOURCIS) : [];
  v.raccourcis = [...new Set(r)].slice(0, 3);
  for (const x of INTERFACE_DEFAUT.raccourcis) if (v.raccourcis.length < 3 && !v.raccourcis.includes(x)) v.raccourcis.push(x);
  const blocs = Array.isArray(v.accueil) ? v.accueil.filter((b) => b && b.id in BLOCS_ACCUEIL) : [];
  const vus = new Set(blocs.map((b) => b.id));
  v.accueil = [...blocs.map((b) => ({ id: b.id, visible: b.visible !== false })), ...INTERFACE_DEFAUT.accueil.filter((b) => !vus.has(b.id))];
  return v;
}

const hexValide = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
function eclaircir(hex, part) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const m = (c) => Math.round(c + (255 - c) * part).toString(16).padStart(2, "0");
  return `#${m(r)}${m(g)}${m(b)}`;
}

const sombreSysteme = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;
export const estSombre = (i) => (i.mode === "sombre" ? true : i.mode === "clair" ? false : !!sombreSysteme());

// Applique les réglages à toute la page. couleurLogo : couleur de l'entreprise (thème « Mon logo »).
export function appliquerInterface(i, couleurLogo) {
  const v = interfaceValide(i);
  const racine = document.documentElement;
  const t = THEMES.find((x) => x.id === v.theme);
  const principal = t.principal ?? (hexValide(couleurLogo) ? couleurLogo : "#1f3b63");
  const sombre = estSombre(v);
  if (v.mode === "auto") racine.removeAttribute("data-theme");
  else racine.setAttribute("data-theme", v.mode === "sombre" ? "dark" : "light");
  racine.style.setProperty("--bleu", sombre ? (t.sombre ?? eclaircir(principal, 0.3)) : principal);
  if (!sombre) racine.style.setProperty("--bleu-clair", eclaircir(principal, 0.88));
  else racine.style.removeProperty("--bleu-clair");
  racine.style.setProperty("--vert", t.action);
  racine.style.setProperty("--or", t.accent);
  racine.style.setProperty("--zoom", String(TAILLES[v.taille]));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", sombre ? "#11161d" : principal);
  return v;
}
