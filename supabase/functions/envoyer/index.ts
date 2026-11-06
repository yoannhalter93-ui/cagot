// Fonction Supabase « envoyer » : Cagot envoie lui-même le devis / la facture par e-mail,
// PDF en pièce jointe.
//  1) Depuis la boîte mail de l'artisan, s'il l'a branchée (SMTP + mot de passe d'application) :
//     le client reçoit le mail de son adresse, et le mail apparaît dans ses « Envoyés ».
//  2) Sinon via Brevo, si les secrets BREVO_API_KEY et EMAIL_EXPEDITEUR sont définis.
// Actions de réglage : { action: "boite-statut" | "boite-enregistrer" | "boite-supprimer" }.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CLE_BREVO = Deno.env.get("BREVO_API_KEY");
const EXPEDITEUR_BREVO = Deno.env.get("EMAIL_EXPEDITEUR");
const LIMITE_PAR_JOUR = Number(Deno.env.get("LIMITE_EMAILS_PAR_JOUR") ?? 60);
const TAILLE_MAX = 8 * 1024 * 1024;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Serveurs autorisés (port 465, TLS direct : seul port d'envoi ouvert depuis les fonctions Supabase)
const HOTES = ["smtp.gmail.com", "smtp.orange.fr", "smtp.free.fr", "smtp.sfr.fr", "ssl0.ovh.net", "smtp.laposte.net", "smtp.bbox.fr", "smtp.ionos.fr", "mail.gandi.net", "smtp.zoho.eu", "smtp.mail.yahoo.com"];

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
const ligne = (t: string) => t.replace(/[\r\n]+/g, " ").trim();
const b64 = (o: Uint8Array) => btoa(String.fromCharCode(...o));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Chiffrement du mot de passe d'application (AES-GCM, clé dérivée de la clé de service du projet).
async function cle() {
  const brut = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("cagot-boites-mail"), info: new Uint8Array() },
    brut,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function chiffrer(texte: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cle(), new TextEncoder().encode(texte)));
  return `${b64(iv)}.${b64(c)}`;
}
async function dechiffrer(s: string) {
  const [iv, c] = s.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await cle(), deB64(c)));
}

type Boite = { email: string; nom_affiche: string; hote: string; port: number; utilisateur: string; mdp_chiffre: string };

async function envoyerSmtp(b: Boite, mdp: string, m: { to: string[]; replyTo?: string; subject: string; text: string; pdf?: string; nomFichier?: string }) {
  const client = new SMTPClient({ connection: { hostname: b.hote, port: b.port, tls: true, auth: { username: b.utilisateur, password: mdp } } });
  try {
    await client.send({
      from: b.nom_affiche ? `${ligne(b.nom_affiche).replace(/[<>"]/g, "")} <${b.email}>` : b.email,
      to: m.to,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      subject: m.subject,
      content: m.text,
      ...(m.pdf ? { attachments: [{ filename: m.nomFichier ?? "document.pdf", content: m.pdf, encoding: "base64" as const, contentType: "application/pdf" }] } : {}),
    });
  } finally {
    await client.close().catch(() => {});
  }
}

const messageSmtp = (err: unknown) => {
  const t = String((err as Error)?.message ?? err);
  if (/535|534|auth|username|password|credentials/i.test(t)) return "Connexion refusée par ta boîte mail : vérifie l'adresse et le mot de passe d'application.";
  if (/timed out|timeout|connect|dns|refused/i.test(t)) return "Le serveur de ta boîte mail ne répond pas. Vérifie le fournisseur choisi.";
  return "L'e-mail n'a pas pu partir depuis ta boîte mail, réessaie.";
};

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
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: erreurAuth } = await supabase.auth.getUser(jeton);
  if (erreurAuth || !u?.user) return json({ erreur: "Session expirée, reconnecte-toi." }, 401);
  const uid = u.user.id;

  if (Number(req.headers.get("content-length") ?? 0) > TAILLE_MAX) return json({ erreur: "Document trop lourd." }, 413);
  let c: Record<string, unknown>;
  try {
    c = await req.json();
  } catch {
    return json({ erreur: "Requête invalide." }, 400);
  }

  const { data: boite } = await admin.from("boites_mail").select("*").eq("user_id", uid).maybeSingle();

  // --- Réglages de la boîte mail ---
  if (c.action === "boite-statut") {
    return json({ boite: boite ? { email: boite.email, hote: boite.hote, nom_affiche: boite.nom_affiche } : null, brevo: !!(CLE_BREVO && EXPEDITEUR_BREVO) });
  }
  if (c.action === "boite-supprimer") {
    await admin.from("boites_mail").delete().eq("user_id", uid);
    return json({ ok: true });
  }
  if (c.action === "boite-enregistrer") {
    const email = String(c.email ?? "").trim().toLowerCase();
    const hote = String(c.hote ?? "");
    const mdp = String(c.mdp ?? "").replace(/\s+/g, "");
    if (!emailValide(email) || !HOTES.includes(hote) || mdp.length < 4 || mdp.length > 200) return json({ erreur: "Informations incomplètes." }, 400);
    const nouvelle = { email, hote, port: 465, utilisateur: email, nom_affiche: ligne(String(c.nom_affiche ?? "")).slice(0, 120) };
    // Test réel : un mail de confirmation à l'artisan lui-même
    try {
      await envoyerSmtp({ ...nouvelle, mdp_chiffre: "" }, mdp, {
        to: [email],
        subject: "✅ Cagot est branché sur ta boîte mail",
        text: "Bonjour,\n\nTa boîte mail est bien branchée sur Cagot : tes devis et factures partiront désormais de cette adresse, avec le PDF joint, et apparaîtront dans tes messages envoyés.\n\nPour débrancher Cagot : Réglages → Ma boîte mail → Débrancher (ou supprime le mot de passe d'application dans ton compte).\n\nCagot",
      });
    } catch (err) {
      console.error("[smtp test]", err);
      return json({ erreur: messageSmtp(err) }, 400);
    }
    const { error } = await admin.from("boites_mail").upsert({ user_id: uid, ...nouvelle, mdp_chiffre: await chiffrer(mdp), updated_at: new Date().toISOString() });
    if (error) {
      console.error("[boite]", error);
      return json({ erreur: "Réglage non enregistré, réessaie." }, 500);
    }
    return json({ ok: true, email });
  }

  // --- Envoi d'un devis / d'une facture ---
  if (!boite && !(CLE_BREVO && EXPEDITEUR_BREVO)) return json({ erreur: "L'envoi direct n'est pas encore activé.", non_configure: true }, 503);
  const destinataires = Array.isArray(c.destinataires) ? [...new Set(c.destinataires)] : [];
  if (!destinataires.length || destinataires.length > 5 || !destinataires.every(emailValide)) {
    return json({ erreur: "Adresses e-mail invalides (5 au maximum)." }, 400);
  }
  if (!texteCourt(c.sujet, 200) || !texteCourt(c.texte, 5000) || !texteCourt(c.nom_fichier, 120)) return json({ erreur: "Requête invalide." }, 400);
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

  const { data: ent } = await supabase.from("entreprises").select("infos").maybeSingle();
  const nom = ligne(String(ent?.infos?.nom || "Cagot")).slice(0, 70);
  const fichier = nomFichier.endsWith(".pdf") ? nomFichier : `${nomFichier}.pdf`;

  if (boite) {
    try {
      const mdp = await dechiffrer(boite.mdp_chiffre);
      await envoyerSmtp({ ...boite, nom_affiche: boite.nom_affiche || nom }, mdp, {
        to: destinataires as string[],
        subject: ligne(c.sujet as string),
        text: c.texte as string,
        pdf: c.pdf as string,
        nomFichier: fichier,
      });
      return json({ envoye: true, destinataires, depuis: boite.email });
    } catch (err) {
      console.error("[smtp]", err);
      return json({ erreur: messageSmtp(err) }, 502);
    }
  }

  const repondreA = emailValide(ent?.infos?.email) ? ent.infos.email : u.user.email;
  const rep = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": CLE_BREVO!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: nom, email: EXPEDITEUR_BREVO },
      to: destinataires.map((email) => ({ email })),
      ...(repondreA ? { replyTo: { email: repondreA, name: nom } } : {}),
      subject: ligne(c.sujet as string),
      textContent: c.texte,
      attachment: [{ content: c.pdf, name: fichier }],
    }),
  });
  if (!rep.ok) {
    console.error("[brevo]", rep.status, await rep.text().catch(() => ""));
    return json({ erreur: "L'e-mail n'a pas pu partir, réessaie." }, 502);
  }
  return json({ envoye: true, destinataires });
});
