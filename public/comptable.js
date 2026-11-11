// Espace expert-comptable : accès en LECTURE SEULE aux factures émises et payées des artisans
// qui l'ont invité. Tout passe par des fonctions du serveur qui vérifient l'accès à chaque appel
// (invitation acceptée, non retirée) : le comptable ne peut ni lire autre chose, ni modifier.
import { genererPdf, pdfFacturX, preparerPolices } from "/pdf-devis.js";
import { xmlFacturX } from "/facturx.js";
import { conditionsDe } from "/personnalisation.js";
import { autoliquidation, mentionsClient, mentionsTvaReduite, ventilationTva } from "/mentions-legales.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const euros = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const ajouterJours = (iso, jours) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + Number(jours || 0));
  return d.toISOString();
};
const arrondi = (n) => Math.round(Number(n || 0) * 100) / 100;
const CLE_INVITATION = "cagot.invitation-comptable";

let sb = null;
let utilisateur = null;
let dossiers = [];
let dossier = null; // { acces, nom, siret, entreprise, factures }
let periode = "annee";

function notifier(message, type = "info") {
  const el = Object.assign(document.createElement("div"), { className: `toast ${type}`, textContent: message });
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function afficherVue(nom) {
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== `vue-${nom}`;
  $("#deconnexion").hidden = !utilisateur;
  window.scrollTo(0, 0);
}

const stockage = {
  lire: () => {
    try {
      return localStorage.getItem(CLE_INVITATION);
    } catch {
      return null;
    }
  },
  ecrire: (v) => {
    try {
      if (v) localStorage.setItem(CLE_INVITATION, v);
      else localStorage.removeItem(CLE_INVITATION);
    } catch {
      /* navigation privée : l'invitation reste dans l'adresse */
    }
  },
};

// ---------------------------------------------------------------- connexion
let mode = "connexion";
function modeConnexion(m) {
  mode = m;
  $("#titre-connexion").textContent = { connexion: "Connexion", inscription: "Créer mon compte", oubli: "Mot de passe oublié" }[m];
  $("#champ-mdp").hidden = m === "oubli";
  $("#form-connexion").mdp.required = m !== "oubli";
  $("#form-connexion").mdp.autocomplete = m === "inscription" ? "new-password" : "current-password";
  $("#btn-connexion").textContent = { connexion: "Se connecter", inscription: "Créer mon compte", oubli: "Recevoir un lien" }[m];
  $("#vers-inscription").textContent = m === "connexion" ? "Créer un compte" : "J'ai déjà un compte";
  $("#message-connexion").hidden = true;
}
function messageConnexion(t) {
  $("#message-connexion").textContent = t;
  $("#message-connexion").hidden = false;
}

$("#vers-inscription").onclick = () => modeConnexion(mode === "connexion" ? "inscription" : "connexion");
$("#vers-oubli").onclick = () => modeConnexion("oubli");
$("#form-connexion").onsubmit = async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.mdp.value;
  const retour = `${location.origin}/comptable.html`;
  $("#btn-connexion").disabled = true;
  try {
    if (mode === "connexion") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) messageConnexion("E-mail ou mot de passe incorrect (ou compte pas encore confirmé).");
    } else if (mode === "inscription") {
      if (password.length < 10) return messageConnexion("Le mot de passe doit faire au moins 10 caractères.");
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: retour } });
      if (error) messageConnexion(`Inscription impossible : ${error.message}`);
      else if (!data.session) messageConnexion("Compte créé ! Cliquez sur le lien reçu par e-mail pour l'activer : vous arriverez directement sur le dossier.");
    } else {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: retour });
      messageConnexion("Si ce compte existe, un e-mail avec un lien pour changer le mot de passe vient d'être envoyé.");
    }
  } finally {
    $("#btn-connexion").disabled = false;
  }
};
$("#form-nouveau-mdp").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: e.target.mdp.value });
  if (error) return notifier(`Mot de passe non modifié : ${error.message}`, "erreur");
  notifier("Mot de passe modifié.");
  demarrer();
};
$("#deconnexion").onclick = () => sb.auth.signOut();

// ---------------------------------------------------------------- dossiers
const MESSAGES_INVITATION = {
  lien_invalide: "Ce lien d'invitation n'est plus valable (accès retiré). Demandez un nouveau lien à l'artisan.",
  expire: "Ce lien d'invitation a expiré (30 jours). Demandez à l'artisan de vous le renvoyer depuis Cagot.",
  deja_utilise: "Ce lien a déjà été utilisé avec un autre compte. Connectez-vous avec ce compte, ou demandez un nouveau lien à l'artisan.",
  propre_compte: "Ce lien est destiné à votre expert-comptable : envoyez-le-lui, il créera son propre compte.",
};

async function accepterInvitation() {
  const jeton = stockage.lire();
  if (!jeton) return;
  const { data, error } = await sb.rpc("accepter_acces_comptable", { p_jeton: jeton });
  if (error) return notifier("Invitation non acceptée (connexion ?). Rechargez la page.", "erreur");
  stockage.ecrire(null);
  if (data.erreur) return notifier(MESSAGES_INVITATION[data.erreur] ?? "Invitation non valable.", "erreur");
  notifier(`✅ Accès accordé au dossier ${data.entreprise || ""}`.trim());
  return data.acces;
}

async function demarrer() {
  afficherVue("chargement");
  const nouveau = await accepterInvitation();
  const { data, error } = await sb.rpc("dossiers_comptables");
  if (error) {
    $("#liste-dossiers").innerHTML = `<p class="aide">Impossible de charger vos dossiers (connexion ?).</p>`;
    return afficherVue("dossiers");
  }
  dossiers = data;
  if (dossiers.length === 1 || nouveau) return ouvrirDossier(nouveau ?? dossiers[0].acces);
  afficherDossiers();
}

function afficherDossiers() {
  $("#liste-dossiers").innerHTML = dossiers.length
    ? dossiers
        .map(
          (d) => `<button type="button" class="element-liste dossier" data-acces="${esc(d.acces)}">
            <strong>${esc(d.nom)}</strong><small>${d.siret ? `SIRET ${esc(d.siret)} · ` : ""}accès depuis le ${dateFr(d.depuis)}</small></button>`,
        )
        .join("")
    : `<div class="carte"><p>Aucun dossier pour l'instant.</p><p class="aide">Demandez à votre client artisan de vous inviter depuis Cagot (Réglages → 🧮 Mon comptable), puis ouvrez le lien reçu.</p></div>`;
  for (const b of document.querySelectorAll("[data-acces]")) b.onclick = () => ouvrirDossier(b.dataset.acces);
  afficherVue("dossiers");
}

async function ouvrirDossier(acces) {
  afficherVue("chargement");
  const { data, error } = await sb.rpc("factures_comptable", { p_acces: acces });
  if (error || data.erreur) {
    notifier(data?.erreur ? "Accès retiré par l'artisan." : "Dossier non chargé (connexion ?).", "erreur");
    return afficherDossiers();
  }
  const infos = dossiers.find((d) => d.acces === acces) ?? {};
  dossier = { acces, ...infos, entreprise: data.entreprise, factures: data.factures };
  $("#nom-dossier").textContent = data.entreprise.nom || infos.nom || "Dossier";
  $("#siret-dossier").textContent = [data.entreprise.siret && `SIRET ${data.entreprise.siret}`, data.entreprise.tva_intra && `TVA ${data.entreprise.tva_intra}`].filter(Boolean).join(" · ");
  $("#retour-dossiers").hidden = dossiers.length < 2;
  rendreDossier();
  afficherVue("dossier");
}
$("#retour-dossiers").onclick = (e) => {
  e.preventDefault();
  afficherDossiers();
};

// ---------------------------------------------------------------- période
function bornes(p) {
  const n = new Date();
  const a = n.getFullYear();
  const m = n.getMonth();
  const t = Math.floor(m / 3) * 3;
  const de = (y, mo) => new Date(y, mo, 1);
  switch (p) {
    case "mois": return [de(a, m), de(a, m + 1)];
    case "mois-1": return [de(a, m - 1), de(a, m)];
    case "trim": return [de(a, t), de(a, t + 3)];
    case "trim-1": return [de(a, t - 3), de(a, t)];
    case "annee": return [de(a, 0), de(a + 1, 0)];
    case "annee-1": return [de(a - 1, 0), de(a, 0)];
    case "perso": {
      const d = $("#date-debut").value ? new Date(`${$("#date-debut").value}T00:00:00`) : new Date(2000, 0, 1);
      const f = $("#date-fin").value ? new Date(`${$("#date-fin").value}T00:00:00`) : new Date(2100, 0, 1);
      f.setDate(f.getDate() + 1);
      return [d, f];
    }
    default: return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
  }
}
const PERIODES = [
  ["mois", "Ce mois"], ["mois-1", "Mois dernier"], ["trim", "Ce trimestre"], ["trim-1", "Trimestre dernier"],
  ["annee", "Cette année"], ["annee-1", "Année dernière"], ["tout", "Tout"], ["perso", "Dates…"],
];
const libellePeriode = () => {
  if (periode === "tout") return "toutes";
  const [d, f] = bornes(periode);
  const fin = new Date(f);
  fin.setDate(fin.getDate() - 1);
  return `${dateFr(d)} au ${dateFr(fin)}`;
};

// Montants d'une facture (franchise de TVA : pas de TVA, TTC = HT).
function montants(f) {
  const c = f.contenu;
  const franchise = !!dossier.entreprise.franchise_tva;
  const ht = arrondi(c.total_ht);
  const tva = franchise ? 0 : arrondi(c.montant_tva);
  return { ht, tva, ttc: franchise ? ht : arrondi(c.total_ttc), taux: franchise ? 0 : Number(c.taux_tva ?? 0) };
}

function facturesPeriode() {
  const [d, f] = bornes(periode);
  return dossier.factures.filter((x) => {
    const t = new Date(x.date_document);
    return t >= d && t < f;
  });
}

function rendreDossier() {
  $("#periodes").innerHTML = PERIODES.map(([id, nom]) => `<button type="button" class="puce ${periode === id ? "choisie" : ""}" data-periode="${id}">${nom}</button>`).join("");
  for (const b of document.querySelectorAll("[data-periode]")) {
    b.onclick = () => {
      periode = b.dataset.periode;
      rendreDossier();
    };
  }
  $("#periode-perso").hidden = periode !== "perso";

  const liste = facturesPeriode();
  const somme = (l, k) => arrondi(l.reduce((t, x) => t + montants(x)[k], 0));
  const payees = liste.filter((x) => x.statut === "payee");
  const aEncaisser = liste.filter((x) => x.statut === "emise");
  $("#resume").innerHTML = [
    ["🧾", "Chiffre d'affaires HT", euros(somme(liste, "ht")), `${liste.length} facture${liste.length > 1 ? "s" : ""} · ${libellePeriode()}`],
    ["🏛️", "TVA collectée", euros(somme(liste, "tva")), dossier.entreprise.franchise_tva ? "Franchise en base (art. 293 B)" : "sur les factures émises"],
    ["🏦", "Encaissé TTC", euros(somme(payees, "ttc")), `${payees.length} payée${payees.length > 1 ? "s" : ""}`],
    ["⏳", "Reste à encaisser TTC", euros(somme(aEncaisser, "ttc")), `${aEncaisser.length} en attente`],
  ]
    .map(([i, t, v, d]) => `<div class="tuile"><small>${i} ${t}</small><strong>${v}</strong><span>${esc(d)}</span></div>`)
    .join("");

  const parTaux = new Map();
  for (const x of liste) {
    const vent = dossier.entreprise.franchise_tva || autoliquidation(x.contenu) ? [{ taux: 0, base_ht: Number(x.contenu.total_ht || 0), montant_tva: 0 }] : ventilationTva(x.contenu);
    for (const v of vent) {
      const t = parTaux.get(Number(v.taux)) ?? { ht: 0, tva: 0 };
      parTaux.set(Number(v.taux), { ht: t.ht + Number(v.base_ht), tva: t.tva + Number(v.montant_tva) });
    }
  }
  $("#tva-par-taux").innerHTML =
    parTaux.size && !dossier.entreprise.franchise_tva
      ? `<table class="table-tva"><thead><tr><th>Taux de TVA</th><th class="num">Base HT</th><th class="num">TVA</th></tr></thead><tbody>${[...parTaux]
          .sort((a, b) => b[0] - a[0])
          .map(([taux, t]) => `<tr><td>${nombre(taux)} %</td><td class="num">${euros(t.ht)}</td><td class="num">${euros(t.tva)}</td></tr>`)
          .join("")}</tbody></table>`
      : "";

  $("#export-csv").disabled = !liste.length;
  $("#liste-factures").innerHTML = liste.length
    ? liste
        .map((x) => {
          const m = montants(x);
          return `<div class="element-liste carte-doc">
            <div class="ligne-doc">
              <div><strong>${esc(x.contenu.client_nom || x.contenu.titre || "Client")}</strong>
                <small>${x.contenu.avoir ? "Avoir" : x.contenu.acompte ? "Facture d'acompte" : x.contenu.situation ? "Facture de situation" : "Facture"} ${esc(x.numero)} · ${dateFr(x.date_document)}${x.contenu.titre ? ` · ${esc(x.contenu.titre)}` : ""}</small>
                <small>HT ${euros(m.ht)} · TVA ${euros(m.tva)}</small></div>
              <div class="droite"><strong>${euros(m.ttc)}</strong><br><span class="pastille statut-${x.statut}">${x.statut === "payee" ? "Payée" : "À encaisser"}</span></div>
            </div>
            <div class="actions-doc"><button type="button" class="action-doc" data-pdf="${esc(x.id)}">📄 PDF</button></div>
          </div>`;
        })
        .join("")
    : `<p class="aide">Aucune facture émise sur cette période.</p>`;
  for (const b of document.querySelectorAll("[data-pdf]")) {
    b.onclick = () => telechargerPdf(dossier.factures.find((x) => x.id === b.dataset.pdf)).catch(() => notifier("PDF impossible à créer, réessayez.", "erreur"));
  }
}
$("#date-debut").onchange = rendreDossier;
$("#date-fin").onchange = rendreDossier;

// ---------------------------------------------------------------- téléchargements
const nomFichier = (t) => String(t || "document").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const chargerScript = (src) =>
  new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = Object.assign(document.createElement("script"), { src, onload: ok, onerror: ko });
    document.head.appendChild(s);
  });

// Mêmes mentions que la facture envoyée au client par l'artisan.
function elementsFacture(f, e) {
  const v = f.contenu;
  const franchise = !!e.franchise_tva;
  const tauxTva = franchise ? 0 : ventilationTva(v).length === 1 ? Number(ventilationTva(v)[0].taux) : v.taux_tva;
  const mentions = v.avoir
    ? []
    : [
        `Date d'échéance : ${dateFr(ajouterJours(f.date_document, e.delai_paiement || 30))}.`,
        v.situation ? `Facture de situation n° ${v.situation.numero} sur le devis n° ${v.situation.devis_numero} (avancement cumulé ${nombre(v.situation.pct_global)} %).` : v.acompte ? `Facture d'acompte de ${nombre(v.acompte.pourcentage)} % sur le devis n° ${v.acompte.devis_numero}.` : v.devis_numero ? `Facture établie selon le devis n° ${v.devis_numero}.` : "",
        "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.",
        e.iban ? `Règlement par virement : IBAN ${e.iban}` : "",
      ];
  mentions.push(...mentionsClient(f, e, dateFr));
  if (franchise) mentions.push("TVA non applicable, art. 293 B du CGI.");
  else if (autoliquidation(v)) {
    // mention d'autoliquidation déjà ajoutée
  } else mentions.push(...mentionsTvaReduite(v, "facture"));
  if (e.assurance) mentions.push(`Assurance décennale : ${e.assurance}.`);
  if (conditionsDe(e, "facture")) mentions.push(conditionsDe(e, "facture"));
  return {
    franchise,
    tauxTva,
    tva: franchise ? 0 : v.montant_tva,
    ttc: franchise ? v.total_ht : v.total_ttc,
    mentions: mentions.filter(Boolean),
    titre: `${v.avoir ? "AVOIR" : v.acompte ? "FACTURE D'ACOMPTE" : v.situation ? `FACTURE DE SITUATION N° ${v.situation.numero}` : "FACTURE"} n° ${f.numero}`,
  };
}

async function telechargerPdf(f) {
  for (const src of ["/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js", "/vendor/pdf-lib.min.js"]) await chargerScript(src);
  await preparerPolices();
  const e = dossier.entreprise;
  const elements = elementsFacture(f, e);
  let blob = genererPdf({ d: f, entreprise: e, elements, euros, nombre, dateFr });
  try {
    const xml = xmlFacturX({ d: f, e, mentions: elements.mentions, echeance: ajouterJours(f.date_document, e.delai_paiement || 30) });
    blob = await pdfFacturX(blob, xml, { titre: `${f.contenu.avoir ? "Avoir" : f.contenu.acompte ? "Facture d'acompte" : f.contenu.situation ? "Facture de situation" : "Facture"} ${f.numero}`, auteur: e.nom || "Cagot", avoir: !!f.contenu.avoir });
  } catch (err) {
    console.error("Factur-X", err);
  }
  telecharger(blob, `${nomFichier(`Facture_${f.numero}_${f.contenu.client_nom || ""}`)}.pdf`);
}

// Tableau pour Excel (séparateur « ; », virgule décimale, accents conservés).
$("#export-csv").onclick = () => {
  const liste = [...facturesPeriode()].sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  const nb = (n) => arrondi(n).toFixed(2).replace(".", ",");
  const cellule = (t) => {
    const s = String(t ?? "").replace(/\r?\n/g, " ");
    return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const e = dossier.entreprise;
  const lignes = [
    ["Date", "Numéro", "Client", "Adresse client", "Objet", "Total HT", "Taux TVA", "TVA", "Total TTC", "Statut", "Échéance", "Devis d'origine"],
    ...liste.map((f) => {
      const m = montants(f);
      return [
        dateFr(f.date_document), f.numero, f.contenu.client_nom, f.contenu.client_adresse, f.contenu.titre,
        nb(m.ht), dossier.entreprise.franchise_tva || autoliquidation(f.contenu) ? "0 %" : ventilationTva(f.contenu).map((v) => `${nombre(v.taux)} %`).join(" + "), nb(m.tva), nb(m.ttc), f.statut === "payee" ? "Payée" : "À encaisser",
        dateFr(ajouterJours(f.date_document, e.delai_paiement || 30)), f.contenu.devis_numero,
      ];
    }),
  ];
  const csv = `﻿${lignes.map((l) => l.map(cellule).join(";")).join("\r\n")}\r\n`;
  const periodeNom = periode === "tout" ? "tout" : libellePeriode().replace(/\//g, "-").replace(" au ", "_au_");
  telecharger(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${nomFichier(`Factures_${e.nom || "artisan"}_${periodeNom}`)}.csv`);
};

// ---------------------------------------------------------------- démarrage
(async () => {
  const m = /invitation=([A-Za-z0-9_-]{40,})/.exec(location.hash);
  if (m) {
    stockage.ecrire(m[1]);
    history.replaceState(null, "", location.pathname);
  }
  $("#bandeau-invitation").hidden = !stockage.lire();
  try {
    const config = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  } catch {
    $("#vue-chargement").innerHTML = `<div class="carte"><p>Connexion impossible. Vérifiez votre réseau et rechargez la page.</p></div>`;
    return;
  }
  sb.auth.onAuthStateChange((evenement, session) => {
    setTimeout(() => {
      if (evenement === "PASSWORD_RECOVERY") {
        utilisateur = session?.user ?? null;
        return afficherVue("nouveau-mdp");
      }
      if (session?.user) {
        if (utilisateur?.id !== session.user.id) {
          utilisateur = session.user;
          demarrer();
        }
      } else {
        utilisateur = null;
        dossier = null;
        modeConnexion(stockage.lire() ? "inscription" : "connexion");
        $("#bandeau-invitation").hidden = !stockage.lire();
        afficherVue("connexion");
      }
    }, 0);
  });
})();
