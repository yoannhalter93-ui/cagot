// Fonction Supabase « push » : notifications sur le téléphone de l'artisan (Web Push / VAPID).
//  { action: "cle" }                      → clé publique (pour s'abonner depuis l'appli)
//  { action: "test" } (connecté)          → notification d'essai sur ses appareils
//  { action: "signature", jeton } (public) → « le client a signé » (appelé par la page de signature ;
//                                            une seule fois, et seulement juste après la signature)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

// Clés VAPID créées une fois par le serveur et gardées en base (jamais exposées, sauf la publique).
async function clesVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await admin.from("cles_serveur").select("valeur").eq("nom", "vapid").maybeSingle();
  if (data?.valeur?.publicKey) return data.valeur;
  const nouvelles = webpush.generateVAPIDKeys();
  await admin.from("cles_serveur").upsert({ nom: "vapid", valeur: nouvelles }, { onConflict: "nom", ignoreDuplicates: true });
  const { data: relu } = await admin.from("cles_serveur").select("valeur").eq("nom", "vapid").single();
  return relu!.valeur;
}

async function notifier(uid: string, message: { titre: string; texte: string; url: string; tag?: string }) {
  const { publicKey, privateKey } = await clesVapid();
  const { data: abos } = await admin.from("push_abonnements").select("id, endpoint, p256dh, auth").eq("user_id", uid).limit(20);
  let envoyes = 0;
  for (const a of abos ?? []) {
    try {
      const d = webpush.generateRequestDetails({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(message), {
        TTL: 86400,
        urgency: "high",
        vapidDetails: { subject: "mailto:contact@cagot.fr", publicKey, privateKey },
      });
      const rep = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body });
      if (rep.status === 404 || rep.status === 410) await admin.from("push_abonnements").delete().eq("id", a.id); // appareil désabonné
      else if (rep.ok) envoyes++;
      else console.error("[push]", rep.status, await rep.text().catch(() => ""));
    } catch (err) {
      console.error("[push]", err);
    }
  }
  return envoyes;
}

const euros = (n: unknown) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);
  let c: Record<string, unknown>;
  try {
    c = await req.json();
  } catch {
    return json({ erreur: "Requête invalide." }, 400);
  }

  if (c.action === "cle") return json({ cle: (await clesVapid()).publicKey });

  if (c.action === "test") {
    const jeton = (req.headers.get("Authorization") ?? "").match(/^Bearer (.+)$/)?.[1];
    const { data: u } = jeton ? await admin.auth.getUser(jeton) : { data: null };
    if (!u?.user) return json({ erreur: "Connexion requise." }, 401);
    const n = await notifier(u.user.id, { titre: "🔔 Cagot", texte: "Les notifications fonctionnent sur cet appareil.", url: "/", tag: "test" });
    return json({ envoyes: n });
  }

  if (c.action === "signature") {
    const jeton = String(c.jeton ?? "");
    if (jeton.length < 40 || jeton.length > 200) return json({ ok: false });
    // Une seule fois, et seulement dans les 15 minutes qui suivent la signature.
    const { data: p } = await admin
      .from("partages_devis")
      .update({ notifie_at: new Date().toISOString() })
      .eq("jeton", jeton)
      .is("notifie_at", null)
      .gte("signe_at", new Date(Date.now() - 15 * 60e3).toISOString())
      .select("user_id, document_id, signataire_nom")
      .maybeSingle();
    if (!p) return json({ ok: false });
    const [{ data: d }, { data: ent }] = await Promise.all([
      admin.from("documents").select("id, numero, contenu").eq("id", p.document_id).maybeSingle(),
      admin.from("entreprises").select("infos").eq("user_id", p.user_id).maybeSingle(),
    ]);
    const v = (d?.contenu ?? {}) as Record<string, unknown>;
    const montant = euros(ent?.infos?.franchise_tva ? v.total_ht : v.total_ttc);
    const n = await notifier(p.user_id, {
      titre: `🎉 Devis signé par ${p.signataire_nom}`,
      texte: `${d?.numero ?? "Devis"} – ${v.titre ?? ""} : ${montant}${ent?.infos?.franchise_tva ? "" : " TTC"}. Tu peux préparer la facture.`,
      url: `/#doc=${p.document_id}`,
      tag: `signature-${p.document_id}`,
    });
    return json({ ok: true, envoyes: n });
  }
  return json({ erreur: "Action inconnue." }, 400);
});
