// Fonction Supabase « discuter » : l'IA du chiffrage, pour la version hébergée gratuitement.
// Même logique que /api/discuter de server.js (code partagé copié dans ./_partage par
// `npm run fonctions`, à relancer avant chaque déploiement).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { creerIA, messageErreur } from "./_partage/ia.js";
import { Requete } from "./_partage/requete.js";

const ia = creerIA({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  modele: Deno.env.get("CLAUDE_MODEL") || undefined,
  // L'offre gratuite coupe une demande à 150 s : effort moyen et délai de 140 s.
  effort: Deno.env.get("IA_EFFORT") || "medium",
  delaiMs: 140_000,
});
const LIMITE_PAR_HEURE = Number(Deno.env.get("LIMITE_IA_PAR_HEURE") ?? 60);
const TAILLE_MAX = 30 * 1024 * 1024;

// Authentification par jeton (pas de cookie) : autoriser toutes les origines ne donne accès à rien.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);

  // 1) Un vrai compte connecté (la passerelle vérifie déjà la signature du jeton,
  //    mais la clé publique anonyme en est un aussi : on exige un utilisateur).
  const autorisation = req.headers.get("Authorization") ?? "";
  const jeton = autorisation.match(/^Bearer (.+)$/)?.[1];
  if (!jeton) return json({ erreur: "Connexion requise." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorisation } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: utilisateur, error: erreurAuth } = await supabase.auth.getUser(jeton);
  if (erreurAuth || !utilisateur?.user) return json({ erreur: "Session expirée, reconnecte-toi." }, 401);

  // 2) Limite par compte (compteur en base, fonction enregistrer_appel_ia)
  const { data: autorise, error: erreurLimite } = await supabase.rpc("enregistrer_appel_ia", {
    p_limite_par_heure: LIMITE_PAR_HEURE,
  });
  if (erreurLimite) {
    console.error("[limite]", erreurLimite);
    return json({ erreur: "Service momentanément indisponible, réessaie." }, 503);
  }
  if (!autorise) return json({ erreur: "Limite de demandes atteinte pour cette heure, réessaie plus tard." }, 429);

  // 3) Validation stricte
  if (Number(req.headers.get("content-length") ?? 0) > TAILLE_MAX) return json({ erreur: "Photos trop lourdes." }, 413);
  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return json({ erreur: "Requête invalide." }, 400);
  }
  const verif = Requete.safeParse(corps);
  if (!verif.success) return json({ erreur: "Requête invalide." }, 400);

  // 4) L'IA
  try {
    return json(await ia.discuter(verif.data));
  } catch (err) {
    console.error(`[discuter] utilisateur ${utilisateur.user.id} :`, err);
    return json({ erreur: messageErreur(err) }, 502);
  }
});
