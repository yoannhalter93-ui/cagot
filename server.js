import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { creerIA, messageErreur } from "./src/ia.js";
import { Requete } from "./src/requete.js";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY sont obligatoires (voir .env.example).");
  process.exit(1);
}
const ia = creerIA({
  apiKey: process.env.ANTHROPIC_API_KEY,
  modele: process.env.CLAUDE_MODEL,
  effort: process.env.IA_EFFORT,
});
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1)); // derrière l'hébergeur (HTTPS)

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", SUPABASE_URL, SUPABASE_URL.replace(/^http/, "ws")],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(express.static("public"));
app.get("/vendor/supabase.js", (_req, res) =>
  res.sendFile("node_modules/@supabase/supabase-js/dist/umd/supabase.js", { root: "." }),
);
// Même module de calcul côté navigateur (recalcul instantané après modification d'une ligne).
app.get("/calcul.js", (_req, res) => res.sendFile("src/calcul.js", { root: "." }));
app.get("/corps-etat.js", (_req, res) => res.sendFile("src/corps-etat.js", { root: "." }));

// Configuration publique (même format que le config.json de la version hébergée) : la clé
// « publishable » est faite pour être visible, la sécurité repose sur la connexion + les règles RLS.
app.get("/config.json", (_req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_PUBLISHABLE_KEY, apiUrl: "/api/discuter", demo: ia.demo });
});

// ---------------------------------------------------------------- protection de l'IA
// 1) limite globale par adresse IP (avant même de vérifier le jeton)
const limiteIp = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

// 2) seul un utilisateur connecté (jeton Supabase valide) peut appeler l'IA
async function exigerConnexion(req, res, next) {
  const jeton = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!jeton) return res.status(401).json({ erreur: "Connexion requise." });
  const { data, error } = await supabase.auth.getUser(jeton);
  if (error || !data?.user) return res.status(401).json({ erreur: "Session expirée, reconnecte-toi." });
  req.utilisateur = data.user;
  next();
}

// 3) limite par compte pour maîtriser les coûts de l'IA
const limiteCompte = rateLimit({
  windowMs: 60 * 60_000,
  limit: Number(process.env.LIMITE_IA_PAR_HEURE ?? 60),
  keyGenerator: (req) => req.utilisateur.id,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { erreur: "Limite de demandes atteinte pour cette heure, réessaie plus tard." },
});

// 4) validation stricte de ce qui est envoyé : voir src/requete.js
app.post(
  "/api/discuter",
  limiteIp,
  exigerConnexion,
  limiteCompte,
  express.json({ limit: "30mb" }), // photos de notes : lu seulement après vérification du compte
  async (req, res) => {
    const verif = Requete.safeParse(req.body);
    if (!verif.success) return res.status(400).json({ erreur: "Requête invalide." });
    try {
      res.json(await ia.discuter(verif.data));
    } catch (err) {
      console.error(`[discuter] utilisateur ${req.utilisateur.id} :`, err);
      res.status(502).json({ erreur: messageErreur(err) });
    }
  },
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status === 413 ? 413 : 500).json({ erreur: err.status === 413 ? "Photos trop lourdes." : "Erreur serveur." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Cagot prêt sur http://localhost:${port}${ia.demo ? " (mode démo : pas de clé API)" : ""}`);
});
