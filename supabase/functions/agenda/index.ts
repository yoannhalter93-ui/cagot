// Fonction Supabase « agenda » : le planning Cagot de l'artisan au format iCalendar, pour s'y
// abonner depuis Google Agenda, l'agenda de l'iPhone ou Outlook (mise à jour automatique).
// Accès par lien secret : https://…/functions/v1/agenda?t=<jeton> (jeton créé par lien_agenda()).
// Contenu : rendez-vous / jours de chantier + échéances des factures à encaisser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { calendrier, type Evenement } from "./ics.ts";

const TYPES: Record<string, string> = { visite: "👀 Visite", travaux: "🔨 Chantier", rdv: "📅 RDV", autre: "📌" };

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Méthode non autorisée", { status: 405 });
  const jeton = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[0-9a-f]{64}$/.test(jeton)) return new Response("Lien d'agenda invalide", { status: 404 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: j } = await admin.from("agenda_jetons").select("user_id").eq("jeton", jeton).maybeSingle();
  if (!j) return new Response("Lien d'agenda invalide ou remplacé", { status: 404 });
  const uid = j.user_id as string;

  const depuis = new Date(Date.now() - 180 * 86400e3).toISOString();
  const [rdv, factures, ent, chantiers, clients] = await Promise.all([
    admin.from("rendez_vous").select("*").eq("user_id", uid).gte("fin", depuis).order("debut").limit(3000),
    admin.from("documents").select("id, numero, date_document, contenu").eq("user_id", uid).eq("type", "facture").eq("statut", "emise").limit(1000),
    admin.from("entreprises").select("infos").eq("user_id", uid).maybeSingle(),
    admin.from("chantiers").select("id, titre").eq("user_id", uid).limit(2000),
    admin.from("clients").select("id, nom, adresse, telephone, email").eq("user_id", uid).limit(5000),
  ]);
  if (rdv.error || factures.error) {
    console.error("[agenda]", rdv.error ?? factures.error);
    return new Response("Agenda momentanément indisponible", { status: 503 });
  }
  const infos = (ent.data?.infos ?? {}) as Record<string, unknown>;
  const delai = Number(infos.delai_paiement || 30);
  const nomChantier = new Map((chantiers.data ?? []).map((c) => [c.id, c.titre]));
  const ficheClient = new Map((clients.data ?? []).map((c) => [c.id, c]));
  const euros = (n: unknown) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const evenements: Evenement[] = (rdv.data ?? []).map((r) => {
    const cl = r.client_id ? ficheClient.get(r.client_id) : null;
    const adresse = cl?.adresse ? String(cl.adresse).replace(/\n/g, ", ") : "";
    return {
      uid: `${r.id}@cagot.fr`,
      titre: `${TYPES[r.type] ?? "📅"} ${r.titre}`,
      debut: new Date(r.debut),
      fin: new Date(r.fin),
      journee: r.journee,
      lieu: r.lieu || adresse || undefined,
      description: [
        cl ? `Client : ${cl.nom}` : "",
        cl?.telephone ? `Tél. : ${cl.telephone}` : "",
        cl?.email ? `E-mail : ${cl.email}` : "",
        adresse && adresse !== r.lieu ? `Adresse : ${adresse}` : "",
        r.chantier_id && nomChantier.get(r.chantier_id) ? `Chantier : ${nomChantier.get(r.chantier_id)}` : "",
        r.notes,
      ].filter(Boolean).join("\n") || undefined,
      modifie: new Date(r.updated_at),
    };
  });
  for (const f of factures.data ?? []) {
    const c = (f.contenu ?? {}) as Record<string, unknown>;
    if (c.avoir) continue;
    const echeance = new Date(new Date(`${f.date_document}`).getTime() + delai * 86400e3);
    evenements.push({
      uid: `echeance-${f.id}@cagot.fr`,
      titre: `💶 Échéance facture ${f.numero} – ${c.client_nom || "client"} (${euros(infos.franchise_tva ? c.total_ht : c.total_ttc)})`,
      debut: echeance,
      fin: echeance,
      journee: true,
      description: "Facture à encaisser (Cagot). Une fois payée, elle disparaît de l'agenda.",
    });
  }

  const nom = `Cagot${infos.nom ? ` – ${String(infos.nom).slice(0, 60)}` : ""}`;
  return new Response(req.method === "HEAD" ? null : calendrier(nom, evenements), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="cagot.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
});
