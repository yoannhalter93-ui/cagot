// Fonction Supabase « aide » : l'assistant qui répond aux questions d'utilisation de Cagot.
// Guide stable dans le prompt système (mis en cache), historique court, effort bas (réponses rapides).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { GUIDE } from "./guide.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const CLE = Deno.env.get("ANTHROPIC_API_KEY");
const client = CLE ? new Anthropic({ apiKey: CLE, timeout: 60_000, maxRetries: 1 }) : null;
const LIMITE_PAR_HEURE = Number(Deno.env.get("LIMITE_IA_PAR_HEURE") ?? 60);

type Echange = { role: "user" | "assistant"; texte: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);
  const autorisation = req.headers.get("Authorization") ?? "";
  const jeton = autorisation.match(/^Bearer (.+)$/)?.[1];
  if (!jeton) return json({ erreur: "Connexion requise." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorisation } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u } = await supabase.auth.getUser(jeton);
  if (!u?.user) return json({ erreur: "Session expirée, reconnecte-toi." }, 401);
  if (!client) return json({ reponse: "L'assistant n'est pas encore branché. Écris à contact@cagot.fr, on te répond vite." });

  let corps: { echanges?: Echange[]; contexte?: string };
  try {
    corps = await req.json();
  } catch {
    return json({ erreur: "Requête invalide." }, 400);
  }
  // Historique court et propre : 12 derniers messages, textes bornés, alternance commençant par l'artisan.
  const echanges = (Array.isArray(corps.echanges) ? corps.echanges : [])
    .filter((e) => (e?.role === "user" || e?.role === "assistant") && typeof e.texte === "string" && e.texte.trim())
    .slice(-12)
    .map((e) => ({ role: e.role, content: e.texte.slice(0, 2000) }));
  while (echanges.length && echanges[0].role !== "user") echanges.shift();
  if (!echanges.length || echanges.at(-1)!.role !== "user") return json({ erreur: "Pose ta question." }, 400);

  // Écran d'où l'aide est ouverte (après le guide mis en cache, pour ne pas casser le cache).
  const contexte = typeof corps.contexte === "string" ? corps.contexte.replace(/[\r\n]+/g, " ").slice(0, 400).trim() : "";

  const { data: autorise } = await supabase.rpc("enregistrer_appel_ia", { p_limite_par_heure: LIMITE_PAR_HEURE });
  if (autorise === false) return json({ erreur: "Beaucoup de questions cette heure-ci : réessaie un peu plus tard." }, 429);

  try {
    const rep = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      output_config: { effort: "low" },
      system: [
        { type: "text", text: GUIDE, cache_control: { type: "ephemeral", ttl: "1h" } },
        ...(contexte ? [{ type: "text" as const, text: `# Où est l'artisan en ce moment\n${contexte}\nAdapte ta réponse à cet écran quand c'est utile.` }] : []),
      ],
      messages: echanges,
    });
    if (rep.stop_reason === "refusal") return json({ reponse: "Je ne peux pas répondre à ça. Pour une question sur Cagot, reformule-la ou écris à contact@cagot.fr." });
    const texte = rep.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return json({ reponse: texte || "Je n'ai pas compris, peux-tu reformuler ?" });
  } catch (err) {
    console.error("[aide]", err);
    return json({ erreur: "L'assistant ne répond pas pour l'instant, réessaie dans un moment." }, 502);
  }
});
