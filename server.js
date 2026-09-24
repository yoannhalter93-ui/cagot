import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { discuter, modeDemo } from "./src/ia.js";
import { CORPS_ETAT } from "./src/corps-etat.js";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY sont obligatoires (voir .env.example).");
  process.exit(1);
}
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

// Configuration publique : la clé « publishable » est faite pour être visible,
// la sécurité des données repose sur la connexion + les règles RLS de la base.
app.get("/api/config", (_req, res) => {
  res.json({ demo: modeDemo(), supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_PUBLISHABLE_KEY, corpsEtat: CORPS_ETAT });
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

// 4) validation stricte de ce qui est envoyé
const Image = z.string().max(8_000_000).regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/);
const Requete = z.object({
  historique: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        texte: z.string().max(50_000).default(""),
        brut: z.string().max(200_000).optional(),
        images: z.array(Image).max(10).optional(),
      }),
    )
    .min(1)
    .max(80)
    .refine((h) => h[0].role === "user" && h.at(-1).role === "user", "L'historique doit commencer et finir par l'artisan."),
  entreprise: z
    .object({
      nom: z.string().max(200).optional(),
      metiers: z.array(z.string().max(40)).max(40).optional(),
      franchise_tva: z.boolean().optional(),
    })
    .default({}),
  tarifs: z
    .array(
      z.object({
        corps_etat: z.string().max(40).default(""),
        designation: z.string().max(300),
        unite: z.string().max(20),
        prix: z.number().nonnegative().max(1_000_000),
      }),
    )
    .max(2000)
    .default([]),
});

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
      res.json(await discuter(verif.data));
    } catch (err) {
      console.error(`[discuter] utilisateur ${req.utilisateur.id} :`, err);
      let message = "Erreur inattendue, réessaie.";
      if (err instanceof Anthropic.RateLimitError) message = "Trop de demandes en même temps, réessaie dans un instant.";
      else if (err instanceof Anthropic.APIConnectionError) message = "Impossible de joindre le service IA (connexion).";
      else if (err instanceof Anthropic.APIError) message = "Le service IA est indisponible, réessaie.";
      else if (err.message?.startsWith("L'IA") || err.message?.startsWith("Réponse de l'IA")) message = err.message;
      res.status(502).json({ erreur: message });
    }
  },
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status === 413 ? 413 : 500).json({ erreur: err.status === 413 ? "Photos trop lourdes." : "Erreur serveur." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Cagot prêt sur http://localhost:${port}${modeDemo() ? " (mode démo : pas de clé API)" : ""}`);
});
