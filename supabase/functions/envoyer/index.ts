// Fonction Supabase « envoyer » : Cagot envoie lui-même le devis / la facture par e-mail,
// PDF en pièce jointe, via Brevo (offre gratuite : 300 e-mails par jour).
// Secrets à définir dans Supabase : BREVO_API_KEY et EMAIL_EXPEDITEUR (adresse validée chez Brevo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const CLE = Deno.env.get("BREVO_API_KEY");
const EXPEDITEUR = Deno.env.get("EMAIL_EXPEDITEUR");
const LIMITE_PAR_JOUR = Number(Deno.env.get("LIMITE_EMAILS_PAR_JOUR") ?? 60);
const TAILLE_MAX = 8 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const emailValide = (m: unknown): m is string =>
  typeof m === "string" && m.length <= 200 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(m);
const texteCourt = (t: unknown, max: number) => typeof t === "string" && t.length <= max;
// Pas de retour à la ligne dans les en-têtes (sujet, nom d'expéditeur)
const ligne = (t: string) => t.replace(/[\r\n]+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);
  if (!CLE || !EXPEDITEUR) return json({ erreur: "L'envoi direct n'est pas encore activé.", non_configure: true }, 503);

  const autorisation = req.headers.get("Authorization") ?? "";
  const jeton = autorisation.match(/^Bearer (.+)$/)?.[1];
  if (!jeton) return json({ erreur: "Connexion requise." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorisation } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: erreurAuth } = await supabase.auth.getUser(jeton);
  if (erreurAuth || !u?.user) return json({ erreur: "Session expirée, reconnecte-toi." }, 401);

  if (Number(req.headers.get("content-length") ?? 0) > TAILLE_MAX) return json({ erreur: "Document trop lourd." }, 413);
  let c: Record<string, unknown>;
  try {
    c = await req.json();
  } catch {
    return json({ erreur: "Requête invalide." }, 400);
  }
  const destinataires = Array.isArray(c.destinataires) ? [...new Set(c.destinataires)] : [];
  if (!destinataires.length || destinataires.length > 5 || !destinataires.every(emailValide)) {
    return json({ erreur: "Adresses e-mail invalides (5 au maximum)." }, 400);
  }
  if (!texteCourt(c.sujet, 200) || !texteCourt(c.texte, 5000) || !texteCourt(c.nom_fichier, 120)) {
    return json({ erreur: "Requête invalide." }, 400);
  }
  if (typeof c.pdf !== "string" || c.pdf.length > TAILLE_MAX || !/^[A-Za-z0-9+/=]+$/.test(c.pdf) || !c.pdf.startsWith("JVBER")) {
    return json({ erreur: "PDF invalide." }, 400);
  }
  const nomFichier = (c.nom_fichier as string).replace(/[^\p{L}\p{N}_.-]+/gu, "_");

  const { data: autorise, error: erreurLimite } = await supabase.rpc("enregistrer_envoi_email", {
    p_destinataires: destinataires.length,
    p_limite_par_jour: LIMITE_PAR_JOUR,
  });
  if (erreurLimite) {
    console.error("[limite]", erreurLimite);
    return json({ erreur: "Service momentanément indisponible, réessaie." }, 503);
  }
  if (!autorise) return json({ erreur: "Limite d'e-mails atteinte pour aujourd'hui." }, 429);

  // L'entreprise de l'artisan : nom affiché et adresse de réponse (le client répond à l'artisan).
  const { data: ent } = await supabase.from("entreprises").select("infos").maybeSingle();
  const nom = ligne(String(ent?.infos?.nom || "Cagot")).slice(0, 70);
  const repondreA = emailValide(ent?.infos?.email) ? ent.infos.email : u.user.email;

  const rep = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": CLE, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: nom, email: EXPEDITEUR },
      to: destinataires.map((email) => ({ email })),
      ...(repondreA ? { replyTo: { email: repondreA, name: nom } } : {}),
      subject: ligne(c.sujet as string),
      textContent: c.texte,
      attachment: [{ content: c.pdf, name: nomFichier.endsWith(".pdf") ? nomFichier : `${nomFichier}.pdf` }],
    }),
  });
  if (!rep.ok) {
    console.error("[brevo]", rep.status, await rep.text().catch(() => ""));
    return json({ erreur: "L'e-mail n'a pas pu partir, réessaie." }, 502);
  }
  return json({ envoye: true, destinataires });
});
