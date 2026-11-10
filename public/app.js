import { calculerTotaux, tauxLigne } from "/calcul.js";
import { CORPS_ETAT, nomCorpsEtat } from "/corps-etat.js";
import { demarrerPlateforme } from "/plateforme.js";
import { genererPdf, pdfAttestation, pdfFacturX, preparerPolices } from "/pdf-devis.js";
import { xmlFacturX } from "/facturx.js";
import { couleurDominante, nettoyerLogo } from "/logo.js";
import { NATURES, autoliquidation, estParticulier, mentionsTvaReduite, ventilationTva, formulaireRetractation, horsEtablissement, mentionsClient, texteAcompte } from "/mentions-legales.js";
import { BLOCS_ACCUEIL, INTERFACE_DEFAUT, RACCOURCIS, THEMES, appliquerInterface, interfaceValide } from "/interface.js";
import { LABELS_MAX, conditionsDe, htmlPersonnalisation, labelsDe, modeleDe } from "/personnalisation.js";

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const euros = (n) => Number(n ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const nombre = (n) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const lireNombre = (txt) => Number(String(txt).replace(/\s/g, "").replace("€", "").replace(",", ".")) || 0;
const dateFr = (iso) => new Date(iso).toLocaleDateString("fr-FR");
const ajouterJours = (iso, jours) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + Number(jours || 0));
  return d.toISOString();
};

// Préférences de l'appareil uniquement (voix, brouillon de conversation).
// Les devis, factures, prix et infos entreprise sont dans la base en ligne.
const local = {
  lire(cle, defaut) {
    try {
      const v = localStorage.getItem(`cagot.${cle}`);
      return v === null ? defaut : JSON.parse(v);
    } catch {
      return defaut;
    }
  },
  ecrire(cle, valeur) {
    try {
      localStorage.setItem(`cagot.${cle}`, JSON.stringify(valeur));
    } catch {
      /* stockage local indisponible : sans conséquence */
    }
  },
  effacer(cle) {
    try {
      localStorage.removeItem(`cagot.${cle}`);
    } catch {
      /* idem */
    }
  },
};

// Interface choisie (couleurs, sombre, taille, barre du bas, accueil) : appliquée dès l'ouverture
// avec la copie gardée sur l'appareil, puis avec celle du compte une fois connecté.
let reglagesInterface = interfaceValide(local.lire("interface", null));
appliquerInterface(reglagesInterface, local.lire("couleur-logo", null));

// Messages et confirmations dans la page (les fenêtres alert/confirm du navigateur
// ne sont pas disponibles partout).
function notifier(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function erreur(message, err) {
  if (err) console.error(err);
  notifier(message, "erreur");
}

function demander(message, { ok = "Confirmer", danger = false } = {}) {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<div class="dialogue" role="dialog" aria-modal="true">
      <p></p>
      <div class="dialogue-actions">
        <button type="button" class="annuler">Annuler</button>
        <button type="button" class="valider ${danger ? "danger" : "btn-principal"}"></button>
      </div></div>`;
    fond.querySelector("p").textContent = message;
    fond.querySelector(".valider").textContent = ok;
    const fermer = (reponse) => {
      fond.remove();
      resolve(reponse);
    };
    fond.querySelector(".annuler").onclick = () => fermer(false);
    fond.querySelector(".valider").onclick = () => fermer(true);
    fond.onclick = (e) => {
      if (e.target === fond) fermer(false);
    };
    document.body.appendChild(fond);
    fond.querySelector(".valider").focus();
  });
}

const normaliser = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const emailValide = (m) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(m);

// Fenêtre « Envoyer à » : l'adresse du client déjà remplie, possibilité d'en ajouter.
// Renvoie la liste des adresses (éventuellement vide) ou null si annulé.
function demanderDestinataires(initiales) {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<div class="dialogue dialogue-envoi" role="dialog" aria-modal="true">
      <h3>Envoyer à</h3>
      <div class="destinataires"></div>
      <button type="button" class="lien ajouter-adresse">+ Ajouter une adresse</button>
      ${plateforme.envoiDirect ? `<label class="case-accord copie-envoi"><input type="checkbox" class="copie"><span>📩 M'envoyer une copie (le client ne la voit pas)</span></label>` : ""}
      <p class="aide">${plateforme.envoiDirect ? "Cagot envoie l'e-mail lui-même, avec le PDF joint." : "Le PDF est joint automatiquement. Les adresses sont copiées : dans Gmail, appuie longuement sur « À » puis « Coller »."}</p>
      <div class="dialogue-actions">
        <button type="button" class="annuler">Annuler</button>
        <button type="button" class="valider btn-principal">Envoyer</button>
      </div></div>`;
    const liste = fond.querySelector(".destinataires");
    const ajouter = (valeur = "") => {
      const ligne = document.createElement("div");
      ligne.className = "ligne-destinataire";
      ligne.innerHTML = `<input type="email" inputmode="email" autocomplete="email" placeholder="adresse@exemple.fr"><button type="button" class="retirer" aria-label="Retirer">✕</button>`;
      ligne.querySelector("input").value = valeur;
      ligne.querySelector(".retirer").onclick = () => {
        ligne.remove();
        if (!liste.children.length) ajouter();
      };
      liste.appendChild(ligne);
      return ligne.querySelector("input");
    };
    for (const m of initiales.length ? initiales : [""]) ajouter(m);
    const caseCopie = fond.querySelector(".copie");
    if (caseCopie) caseCopie.checked = local.lire("copie-envois", true) !== false; // cochée par défaut, choix mémorisé
    fond.querySelector(".ajouter-adresse").onclick = () => ajouter().focus();
    const fermer = (reponse) => {
      fond.remove();
      resolve(reponse);
    };
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.onclick = (e) => {
      if (e.target === fond) fermer(null);
    };
    fond.querySelector(".valider").onclick = () => {
      const champs = [...liste.querySelectorAll("input")];
      const adresses = champs.map((c) => c.value.replace(/\s+/g, "").toLowerCase()).filter(Boolean);
      const fausse = champs.find((c) => c.value.trim() && !emailValide(c.value.replace(/\s+/g, "")));
      if (fausse) {
        fausse.classList.add("invalide");
        fausse.focus();
        return notifier("Adresse e-mail incorrecte.", "erreur");
      }
      const choix = [...new Set(adresses)];
      if (caseCopie) {
        choix.copie = caseCopie.checked;
        local.ecrire("copie-envois", caseCopie.checked);
      }
      fermer(choix);
    };
    document.body.appendChild(fond);
    if (!initiales.length) liste.querySelector("input").focus();
  });
}

// ---------------------------------------------------------------------------
// Connexion (Supabase Auth)
// ---------------------------------------------------------------------------
const VERSION_APPLI = "10 nov. 2026 · Agenda : clients";
const plateforme = await demarrerPlateforme();
const { sb } = plateforme;
$("#bandeau-demo").hidden = !plateforme.demo;
$("#bandeau-essai").hidden = !plateforme.essai;
$("#carte-compte").hidden = plateforme.essai;
$("#micro").hidden = !plateforme.dictee;
$("#micro-note").hidden = !plateforme.dictee;
$("#option-mains-libres").hidden = !plateforme.dictee;
$("#imprimer").innerHTML = `<span>📄</span>${plateforme.essai ? "Télécharger" : "PDF"}`;
$("#photo").closest("label").hidden = plateforme.photos === false;
// Bandeau « hors connexion » et synchronisation au retour du réseau
function afficherEtatReseau() {
  const attente = plateforme.horsLigne?.enAttente() ?? 0;
  const bandeau = $("#bandeau-hors-ligne");
  if (!navigator.onLine) {
    bandeau.hidden = false;
    bandeau.textContent = `📴 Hors connexion : tu peux continuer tes notes, photos et chantiers.${attente ? ` ${attente} modification${attente > 1 ? "s" : ""} en attente, envoyée${attente > 1 ? "s" : ""} au retour du réseau.` : ""}`;
  } else if (attente) {
    bandeau.hidden = false;
    bandeau.textContent = `🔄 Synchronisation : ${attente} modification${attente > 1 ? "s" : ""} en cours d'envoi…`;
  } else bandeau.hidden = true;
}
let attentePrecedente = plateforme.horsLigne?.enAttente() ?? 0;
window.addEventListener("cagot-sync", (e) => {
  if (attentePrecedente && !e.detail.attente && navigator.onLine) notifier("✅ Tout est synchronisé avec le serveur.");
  attentePrecedente = e.detail.attente;
  afficherEtatReseau();
});
window.addEventListener("online", afficherEtatReseau);
window.addEventListener("offline", afficherEtatReseau);
afficherEtatReseau();

if (plateforme.partageTelephone && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.error(err));
}
$("#photo-note").closest("label").hidden = plateforme.photos === false;
$("#galerie-note").closest("label").hidden = plateforme.photos === false;
$("#aide-partage").hidden = !plateforme.partageTelephone;

let utilisateur = null;
let modeConnexion = "connexion";

function afficherModeConnexion(mode) {
  modeConnexion = mode;
  const titres = { connexion: "Connexion", inscription: "Créer un compte", oubli: "Mot de passe oublié" };
  const boutons = { connexion: "Se connecter", inscription: "Créer mon compte", oubli: "Recevoir un lien par e-mail" };
  $("#titre-connexion").textContent = titres[mode];
  $("#btn-connexion").textContent = boutons[mode];
  $("#champ-mdp").hidden = mode === "oubli";
  $("#champ-cgu").hidden = mode !== "inscription";
  $("#form-connexion [name=mdp]").required = mode !== "oubli";
  $("#form-connexion [name=mdp]").autocomplete = mode === "inscription" ? "new-password" : "current-password";
  $("#vers-inscription").textContent = mode === "connexion" ? "Créer un compte" : "J'ai déjà un compte";
  $("#message-connexion").hidden = true;
}
$("#vers-inscription").onclick = () => afficherModeConnexion(modeConnexion === "connexion" ? "inscription" : "connexion");
$("#vers-oubli").onclick = () => afficherModeConnexion("oubli");

function messageConnexion(texte) {
  $("#message-connexion").textContent = texte;
  $("#message-connexion").hidden = false;
}

$("#form-connexion").onsubmit = async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.mdp.value;
  $("#btn-connexion").disabled = true;
  try {
    if (modeConnexion === "connexion") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) messageConnexion("E-mail ou mot de passe incorrect (ou compte pas encore confirmé).");
    } else if (modeConnexion === "inscription") {
      if (password.length < 10) return messageConnexion("Le mot de passe doit faire au moins 10 caractères.");
      if (!e.target.cgu.checked) return messageConnexion("Coche la case pour accepter les conditions d'utilisation.");
      const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin, data: { cgu_acceptees: new Date().toISOString(), cgu_version: "2026-11-10" } } });
      if (error) messageConnexion(`Inscription impossible : ${error.message}`);
      else messageConnexion("Compte créé ! Clique sur le lien reçu par e-mail pour l'activer, puis connecte-toi.");
    } else {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      messageConnexion("Si ce compte existe, un e-mail avec un lien pour changer le mot de passe vient d'être envoyé.");
    }
  } finally {
    $("#btn-connexion").disabled = false;
  }
};

$("#form-nouveau-mdp").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: e.target.mdp.value });
  if (error) return erreur(`Impossible de changer le mot de passe : ${error.message}`);
  notifier("Mot de passe modifié.");
  demarrerSession();
};

$("#deconnexion").onclick = async () => {
  if (plateforme.horsLigne?.enAttente() && !(await demander("Des modifications faites hors réseau ne sont pas encore envoyées. Te déconnecter les effacera de ce téléphone.", { ok: "Se déconnecter quand même", danger: true }))) return;
  if (utilisateur) local.effacer(`conversation.${utilisateur.id}`);
  await plateforme.horsLigne?.oublier();
  await sb.auth.signOut();
};

sb.auth.onAuthStateChange((evenement, session) => {
  // Laisser la main à l'appli hors du callback (recommandation Supabase).
  setTimeout(() => {
    if (evenement === "PASSWORD_RECOVERY") return afficherVue("nouveau-mdp");
    if (session?.user) {
      if (utilisateur?.id !== session.user.id) {
        utilisateur = session.user;
        demarrerSession();
      }
    } else {
      utilisateur = null;
      $("#navigation").hidden = true;
      $("#btn-reglages").hidden = true;
      afficherModeConnexion("connexion");
      afficherVue("connexion");
    }
  }, 0);
});

async function jetonAcces() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token;
}

// ---------------------------------------------------------------------------
// Données de l'artisan
// ---------------------------------------------------------------------------
let profil = { infos: { validite: 30, acompte: 30, delai_paiement: 30 }, metiers: [] };
let tarifs = [];

async function chargerProfil() {
  const [ent, tar] = await Promise.all([
    sb.from("entreprises").select("infos, metiers").maybeSingle(),
    sb.from("tarifs").select("*").order("corps_etat").order("designation"),
  ]);
  if (ent.error || tar.error) throw ent.error || tar.error;
  if (ent.data) profil = { infos: { ...profil.infos, ...ent.data.infos }, metiers: ent.data.metiers ?? [] };
  tarifs = tar.data;
  if (profil.infos.interface) mettreInterface(profil.infos.interface, { enregistrer: false });
}

async function demarrerSession() {
  $("#navigation").hidden = false;
  $("#btn-reglages").hidden = false;
  $("#email-compte").textContent = utilisateur.email;
  $("#version-appli").textContent = VERSION_APPLI;
  try {
    await chargerProfil();
  } catch (err) {
    erreur("Impossible de charger tes données. Vérifie ta connexion internet.", err);
  }
  plateforme.horsLigne?.vider();
  conversation = local.lire(`conversation.${utilisateur.id}`, { historique: [], docId: null });
  reafficherConversation();
  // Chantier commencé avant la liste des chantiers : on l'enregistre en ligne.
  if (!conversation.id && conversation.historique.length) sauverConversation();
  else afficherTitreChantier();
  afficherVue(profil.infos.nom ? "accueil" : "parametres");
  importerPartage().catch((err) => erreur("Le contenu partagé n'a pas pu être importé.", err));
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
let typeDocs = "devis"; // onglet Devis ou Factures
let ficheCourante = null; // chantier ouvert (pour revenir à sa fiche)
let filtreDocs = "tout";

function afficherVue(nom) {
  // « devis » et « factures » : même écran, filtré par type
  if (nom === "devis" || nom === "factures") {
    typeDocs = nom === "devis" ? "devis" : "facture";
    filtreDocs = "tout";
    nom = "documents";
  }
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== `vue-${nom}`;
  // Tout ce qui appartient à un chantier allume l'onglet « Chantiers »
  if (["accueil", "chantiers", "clients", "documents", "notes", "parametres"].includes(nom)) ficheCourante = null;
  const raccourci = nom === "documents" || nom === "document" ? (typeDocs === "facture" ? "factures" : "devis") : nom === "note" ? "notes" : nom;
  const onglet = !ficheCourante && reglagesInterface.raccourcis.includes(raccourci) && !["chantier", "fiche"].includes(nom)
    ? raccourci
    : ["chantier", "fiche", "chantiers"].includes(nom) || (ficheCourante && ["note", "document"].includes(nom))
      ? "chantiers"
      : ["documents", "document", "notes", "note", "parametres", "journal", "agenda"].includes(nom)
        ? "plus"
        : nom;
  $("#menu-plus").hidden = true;
  for (const b of document.querySelectorAll("#navigation [data-vue]")) b.classList.toggle("actif", b.dataset.vue === onglet);
  $("#btn-reglages").classList.toggle("actif", nom === "parametres");
  if (nom !== "note") quitterNote();
  if (nom !== "accueil") persoAccueil = false;
  if (nom === "accueil") afficherAccueil();
  if (nom === "chantiers") afficherFiches();
  if (nom === "notes") afficherNotes();
  if (nom === "documents") afficherListe();
  if (nom === "clients") afficherClients();
  if (nom === "journal") afficherJournal();
  if (nom === "agenda") afficherAgenda();
  if (nom === "parametres") afficherParametres();
  window.scrollTo(0, 0);
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-vue]");
  if (b && !b.closest(".vue[hidden]")) {
    if (b.dataset.vue === "plus") {
      $("#menu-plus").hidden = !$("#menu-plus").hidden;
      return;
    }
    return afficherVue(b.dataset.vue);
  }
  if (!$("#menu-plus").hidden && !ev.target.closest(".feuille")) $("#menu-plus").hidden = true;
});

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
// L'accueil est une grille de cases que l'artisan range comme il veut (mode « Personnaliser »).
let persoAccueil = false;
let donneesAccueil = { docs: [], chantiers: [], erreurChantiers: false };

async function afficherAccueil() {
  const e = profil.infos;
  $("#bonjour").textContent = `Bonjour${e.prenom ? ` ${e.prenom}` : ""} 👋`;
  $("#nom-entreprise-accueil").textContent = e.nom || "";
  rendreAccueil();
  const [docs, chantiers, rdvAccueil] = await Promise.all([
    sb.from("documents").select("id, type, statut, numero, date_document, contenu, devis_id, created_at, updated_at").limit(500),
    sb.from("chantiers").select("id, titre, document_id, updated_at, created_at").order("updated_at", { ascending: false }).limit(100),
    sb.from("rendez_vous").select("*").gte("fin", new Date().toISOString()).lt("debut", new Date(Date.now() + 14 * 864e5).toISOString()).order("debut").limit(8),
  ]);
  // Comme la page Chantiers : un devis = un seul chantier (le plus ancien s'il y a eu un doublon).
  const vus = new Set();
  const uniques = [...(chantiers.data ?? [])]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .filter((c) => !c.document_id || (!vus.has(c.document_id) && vus.add(c.document_id)))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 4);
  donneesAccueil = { docs: docs.data ?? [], chantiers: uniques, erreurChantiers: !!chantiers.error, rdv: (rdvAccueil.data ?? []).map((x) => ({ ...x, debut: new Date(x.debut), fin: new Date(x.fin) })) };
  rendreAccueil();
}

// Étape réelle du chantier sur l'accueil (devis à envoyer, envoyé, accepté, facture…).
function pastilleChantier(ch, docs) {
  const d = docs.find((x) => x.id === ch.document_id);
  if (!d) return `<span class="pastille statut-envoye">notes</span>`;
  const f = docs.find((x) => x.type === "facture" && x.devis_id === d.id);
  const [classe, texte] = f
    ? f.statut === "payee" ? ["statut-payee", "payé"] : f.statut === "emise" ? ["statut-emise", "à encaisser"] : ["statut-brouillon", "à facturer"]
    : { envoye: ["statut-envoye", "devis envoyé"], accepte: ["statut-accepte", "accepté"], refuse: ["statut-refuse", "refusé"] }[d.statut] ?? ["statut-brouillon", "devis à envoyer"];
  return `<span class="pastille ${classe}">${texte}</span>`;
}

function htmlCase(id) {
  const { docs, chantiers, erreurChantiers } = donneesAccueil;
  const { tuiles, par } = indicateurs(docs);
  if (tuiles[id]) return htmlTuile(id, tuiles[id]);
  const delai = Number(profil.infos.delai_paiement || 30);
  const mini = (titre, valeur, detail) => `<div class="tuile tuile-info"><small>${titre}</small><strong>${valeur}</strong><span>${detail}</span></div>`;
  const ligneDoc = (d, info) => `<button type="button" class="carte-chantier" data-ouvrir-doc="${esc(d.id)}"><span class="icone-chantier">${d.type === "devis" ? "📝" : "🧾"}</span>
      <span><strong>${esc(d.contenu.client_nom || d.contenu.titre || "Sans titre")}</strong><small>${esc(d.numero || "")} · ${info}</small></span><span class="montant">${euros(montantDoc(d))}</span></button>`;
  switch (id) {
    case "ca-mois": {
      const debut = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const liste = docs.filter((d) => d.type === "facture" && d.statut !== "brouillon" && new Date(d.date_document) >= debut);
      const ht = liste.reduce((t, d) => t + Number(d.contenu.total_ht || 0), 0);
      return mini("📈 Facturé ce mois", euros(ht), `HT · ${liste.length} facture${liste.length > 1 ? "s" : ""}`);
    }
    case "taux-acceptation": {
      const decides = par.accepte.length + par.refuse.length;
      return mini("🎯 Taux d'acceptation", decides ? `${Math.round((100 * par.accepte.length) / decides)} %` : "—", `${par.accepte.length} accepté${par.accepte.length > 1 ? "s" : ""} · ${par.refuse.length} refusé${par.refuse.length > 1 ? "s" : ""}`);
    }
    case "impayes": {
      const liste = par["a-encaisser"];
      const retard = liste.filter((d) => joursDepuis(d.date_document) > delai).length;
      return `<button type="button" class="tuile ${retard ? "alerte" : ""}" data-vue="journal"><small>⚠️ Impayés</small><strong>${euros(liste.reduce((t, d) => t + montantDoc(d), 0))}</strong><span>${liste.length} facture${liste.length > 1 ? "s" : ""}${retard ? ` · ${retard} en retard` : ""}</span></button>`;
    }
    case "courbe-ca": {
      const maintenant = new Date();
      const mois = Array.from({ length: 6 }, (_, i) => new Date(maintenant.getFullYear(), maintenant.getMonth() - 5 + i, 1));
      const valeurs = mois.map((debut) => {
        const fin = new Date(debut.getFullYear(), debut.getMonth() + 1, 1);
        return docs
          .filter((d) => d.type === "facture" && d.statut !== "brouillon" && new Date(d.date_document) >= debut && new Date(d.date_document) < fin)
          .reduce((t, d) => t + Number(d.contenu.total_ht || 0), 0);
      });
      const max = Math.max(...valeurs, 1);
      const L = 300;
      const H = 120;
      const pas = L / 6;
      const barres = valeurs
        .map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * (H - 18)));
          return `<rect x="${i * pas + 8}" y="${H - h}" width="${pas - 16}" height="${h}" rx="4" class="${i === 5 ? "colonne-courante" : "colonne"}"><title>${euros(v)} HT</title></rect>`;
        })
        .join("");
      const noms = mois.map((m, i) => `<text x="${i * pas + pas / 2}" y="${H + 14}" text-anchor="middle">${m.toLocaleDateString("fr-FR", { month: "short" })}</text>`).join("");
      return `<div class="titre-section ligne-titre"><h3>📊 Chiffre d'affaires</h3><button type="button" class="lien" data-vue="journal">Journal ›</button></div>
        <div class="carte-courbe"><p class="aide">Ce mois-ci : <strong>${euros(valeurs[5])} HT</strong></p>
        <svg viewBox="0 0 ${L} ${H + 20}" class="courbe-ca" role="img" aria-label="Chiffre d'affaires HT des 6 derniers mois">${barres}${noms}</svg></div>`;
    }
    case "nouveau":
      return `<button type="button" class="btn-devis-rapide" data-action-accueil="chantier">＋ Nouveau chantier</button>
        <p class="aide centre">Un chantier = le client, tes notes et photos, le devis et la facture, étape par étape.</p>`;
    case "raccourcis":
      return `<div class="titre-section"><h3>⚡ Actions rapides</h3></div><div class="actions-rapides">
        <button type="button" data-action-accueil="chantier">🏗️<span>Chantier</span></button>
        <button type="button" data-action-accueil="note">🗒️<span>Note</span></button>
        <button type="button" data-action-accueil="facture">🧾<span>Facture</span></button>
        <button type="button" data-action-accueil="client">👤<span>Client</span></button></div>`;
    case "chantiers":
      return `<div class="titre-section ligne-titre"><h3>Mes chantiers en cours</h3><button type="button" class="lien" data-vue="chantiers">Voir tout ›</button></div>
        ${
          chantiers.length
            ? chantiers
                .map(
                  (ch) => `<button type="button" class="carte-chantier" data-ouvrir-chantier="${esc(ch.id)}">
            <span class="icone-chantier">🏗️</span><span><strong>${esc(ch.titre || "Chantier sans titre")}</strong><small>${ilYa(ch.updated_at)}</small></span>
            ${pastilleChantier(ch, docs)}</button>`,
                )
                .join("")
            : `<p class="aide">${erreurChantiers ? "Liste indisponible (connexion ?)." : "Pas encore de chantier. Appuie sur « Nouveau chantier » pour commencer."}</p>`
        }`;
    case "agenda": {
      const auto = elementsAuto(docs).filter((x) => x.debut <= new Date(Date.now() + 14 * 864e5) && x.fin >= jourSeul(new Date()));
      const liste = [...(donneesAccueil.rdv ?? []), ...auto].sort((a, b) => a.debut - b.debut).slice(0, 6);
      return `<div class="titre-section ligne-titre"><h3>📅 À venir</h3><button type="button" class="lien" data-vue="agenda">Agenda ›</button></div>${
        liste.length ? liste.map((x) => htmlElementAgenda(x, jourSeul(x.debut)).replace('<span class="heure-rdv">', `<span class="heure-rdv">${esc(nomJour(x.debut))} · `)).join("") : `<p class="aide">Rien de prévu dans les 2 semaines. <button type="button" class="lien" data-vue="agenda">Ouvrir l'agenda</button></p>`
      }`;
    }
    case "relances": {
      const liste = par.envoye.filter((d) => joursDepuis(dateSuivi(d, "envoye") || d.updated_at) >= 7);
      return `<div class="titre-section"><h3>⏰ Devis à relancer</h3></div>${liste.length ? liste.slice(0, 5).map((d) => ligneDoc(d, `envoyé ${ilYa(dateSuivi(d, "envoye") || d.updated_at)}`)).join("") : `<p class="aide">Aucun devis à relancer 👍</p>`}`;
    }
    case "retards": {
      const liste = par["a-encaisser"].filter((d) => joursDepuis(d.date_document) > delai);
      return `<div class="titre-section"><h3>⚠️ Factures en retard</h3></div>${liste.length ? liste.slice(0, 5).map((d) => ligneDoc(d, `échéance ${dateFr(ajouterJours(d.date_document, delai))}`)).join("") : `<p class="aide">Aucune facture en retard 👍</p>`}`;
    }
  }
  return "";
}

function rendreAccueil() {
  const grille = $("#blocs-accueil");
  const cases = reglagesInterface.accueil.filter((b) => b.visible);
  grille.classList.toggle("en-perso", persoAccueil);
  grille.innerHTML = cases
    .map(
      (b) => `<div class="case-accueil ${b.taille}" data-case="${b.id}">
        ${persoAccueil ? `<div class="outils-case"><span class="poignee" aria-hidden="true">⠿</span><button type="button" data-taille-case="${b.id}" aria-label="Changer la taille">${b.taille === "large" ? "↙︎ Petite" : "↗︎ Grande"}</button><button type="button" data-masquer-case="${b.id}" aria-label="Retirer">✕</button></div>` : ""}
        <div class="contenu-case">${htmlCase(b.id)}</div></div>`,
    )
    .join("");
  $("#barre-perso-accueil").hidden = !persoAccueil;
  $("#perso-accueil").hidden = persoAccueil;
  const masquees = reglagesInterface.accueil.filter((b) => !b.visible);
  $("#ajout-cases").hidden = !persoAccueil || !masquees.length;
  $("#liste-ajout-cases").innerHTML = masquees.map((b) => `<button type="button" class="ajout-case" data-ajouter-case="${b.id}">${BLOCS_ACCUEIL[b.id].icone} ${esc(BLOCS_ACCUEIL[b.id].nom)} <b>＋</b></button>`).join("");
  if (persoAccueil) return;
  for (const t of grille.querySelectorAll(".tuile[data-filtre]")) {
    t.onclick = () => {
      afficherVue(t.dataset.type === "facture" ? "factures" : "devis");
      filtreDocs = t.dataset.filtre;
      afficherListe();
    };
  }
  for (const b of grille.querySelectorAll("[data-ouvrir-chantier]")) b.onclick = () => ouvrirFiche(b.dataset.ouvrirChantier);
  for (const b of grille.querySelectorAll("[data-ouvrir-doc]")) b.onclick = () => ouvrirDocument(b.dataset.ouvrirDoc);
  for (const b of grille.querySelectorAll("[data-rdv]")) {
    b.onclick = () => {
      const x = (donneesAccueil.rdv ?? []).find((r) => r.id === b.dataset.rdv);
      if (x) vueAgenda = { mode: "semaine", date: x.debut };
      afficherVue("agenda");
    };
  }
  for (const b of grille.querySelectorAll("[data-action-accueil]")) {
    b.onclick = () => {
      const a = b.dataset.actionAccueil;
      if (a === "chantier") return nouveauChantier();
      if (a === "facture") return nouvelleFactureVierge();
      if (a === "note") {
        afficherVue("notes");
        return $("#nouvelle-note").click();
      }
      afficherVue("clients");
      editerClient(null);
    };
  }
}

function modifierCases(modif) {
  const i = structuredClone(reglagesInterface);
  modif(i.accueil);
  mettreInterface(i);
  rendreAccueil();
}

$("#perso-accueil").onclick = () => {
  persoAccueil = true;
  rendreAccueil();
};
$("#fin-perso").onclick = () => {
  persoAccueil = false;
  rendreAccueil();
  notifier("Accueil enregistré ✓");
};
$("#vue-accueil").addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-taille-case]");
  const m = ev.target.closest("[data-masquer-case]");
  const a = ev.target.closest("[data-ajouter-case]");
  if (t) modifierCases((l) => {
    const b = l.find((x) => x.id === t.dataset.tailleCase);
    b.taille = b.taille === "large" ? "petit" : "large";
  });
  if (m) modifierCases((l) => (l.find((x) => x.id === m.dataset.masquerCase).visible = false));
  if (a) modifierCases((l) => {
    const i = l.findIndex((x) => x.id === a.dataset.ajouterCase);
    const [b] = l.splice(i, 1);
    b.visible = true;
    const dernier = l.map((x) => x.visible).lastIndexOf(true);
    l.splice(dernier + 1, 0, b);
  });
});

// Glisser-déposer au doigt (ou à la souris) : la case suit le doigt, les autres se poussent.
(() => {
  const grille = $("#blocs-accueil");
  let glisse = null;
  grille.addEventListener("pointerdown", (ev) => {
    if (!persoAccueil || ev.target.closest("button")) return;
    const c = ev.target.closest(".case-accueil");
    if (!c) return;
    ev.preventDefault();
    const r = c.getBoundingClientRect();
    glisse = { c, dx: ev.clientX - r.left, dy: ev.clientY - r.top, id: ev.pointerId, fantome: c.cloneNode(true) };
    glisse.fantome.classList.add("fantome");
    Object.assign(glisse.fantome.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
    document.body.appendChild(glisse.fantome);
    c.classList.add("en-glisse");
    grille.setPointerCapture(ev.pointerId);
  });
  grille.addEventListener("pointermove", (ev) => {
    if (!glisse || ev.pointerId !== glisse.id) return;
    glisse.fantome.style.left = `${ev.clientX - glisse.dx}px`;
    glisse.fantome.style.top = `${ev.clientY - glisse.dy}px`;
    // défilement auto près des bords
    if (ev.clientY < 90) window.scrollBy(0, -12);
    else if (ev.clientY > innerHeight - 110) window.scrollBy(0, 12);
    const cible = [...grille.querySelectorAll(".case-accueil:not(.en-glisse)")].find((x) => {
      const r = x.getBoundingClientRect();
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    });
    if (!cible) return;
    const r = cible.getBoundingClientRect();
    const apres = cible.classList.contains("large") ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2 || ev.clientY > r.bottom - 8;
    grille.insertBefore(glisse.c, apres ? cible.nextSibling : cible);
  });
  const finir = (ev) => {
    if (!glisse || ev.pointerId !== glisse.id) return;
    glisse.fantome.remove();
    glisse.c.classList.remove("en-glisse");
    const ordre = [...grille.querySelectorAll(".case-accueil")].map((x) => x.dataset.case);
    glisse = null;
    modifierCases((l) => {
      const visibles = ordre.map((id) => l.find((x) => x.id === id));
      const autres = l.filter((x) => !ordre.includes(x.id));
      l.splice(0, l.length, ...visibles, ...autres);
    });
  };
  grille.addEventListener("pointerup", finir);
  grille.addEventListener("pointercancel", finir);
})();

// Facture sans devis : un brouillon vierge à compléter.
async function nouvelleFactureVierge() {
  const contenu = calculerTotaux({
    titre: "Travaux",
    client_nom: "",
    client_adresse: "",
    client_email: "",
    adresse_chantier: "",
    description: "",
    sections: [{ titre: "Prestations", lignes: [{ designation: "Nouvelle prestation", detail: "", quantite: 1, unite: "u", prix_unitaire_ht: 0, prix_source: "artisan", calcul: "" }] }],
    taux_tva: profil.infos.franchise_tva ? 0 : 10,
    duree_estimee: "",
    hypotheses: [],
  });
  const { data, error } = await sb.from("documents").insert({ type: "facture", contenu }).select("id").single();
  if (error) return erreur("Facture non créée.", error);
  ouvrirDocument(data.id);
}
$("#nouveau-document").onclick = () => (typeDocs === "facture" ? nouvelleFactureVierge() : nouveauChantier());

// --- Ma boîte mail (envoi depuis l'adresse de l'artisan) ---
const AIDES_BOITE = {
  "smtp.gmail.com": `<p><strong>Gmail : crée un « mot de passe d'application » (2 minutes)</strong></p><ol>
    <li>Ouvre <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (connecté à ton Gmail).</li>
    <li>Si Google le demande, active d'abord la <strong>validation en deux étapes</strong>.</li>
    <li>Nom de l'application : <strong>Cagot</strong>, puis <strong>Créer</strong>.</li>
    <li>Copie le code de 16 lettres et colle-le ci-dessous.</li></ol>`,
  "smtp.orange.fr": "<p>Orange : utilise ton mot de passe de messagerie Orange (ou un mot de passe d'application si tu as la double authentification).</p>",
  "smtp.mail.yahoo.com": "<p>Yahoo : crée un mot de passe d'application dans « Sécurité du compte ».</p>",
  "smtp.zoho.eu": "<p>Zoho : crée un mot de passe d'application dans « Sécurité ».</p>",
};

async function afficherBoite() {
  const etat = $("#etat-boite");
  const form = $("#form-boite");
  if (!plateforme.boiteMail || !plateforme.envoiPossible) {
    etat.innerHTML = `<p class="aide">Disponible dans la version en ligne de Cagot.</p>`;
    return;
  }
  try {
    const { boite } = await plateforme.boiteMail("boite-statut", {}, await jetonAcces());
    if (boite) {
      form.hidden = true;
      etat.innerHTML = `<div class="boite-ok">✅ Branchée sur <strong>${esc(boite.email)}</strong><br><small>Tes devis et factures partent de cette adresse.</small></div>
        <button type="button" class="btn-secondaire" id="changer-boite">Changer</button> <button type="button" class="lien danger" id="debrancher-boite">Débrancher</button>`;
      $("#changer-boite").onclick = () => {
        form.hidden = false;
        form.elements.email.value = boite.email;
        form.elements.nom_affiche.value = boite.nom_affiche || profil.infos.nom || "";
        form.elements.hote.value = boite.hote;
        form.elements.hote.onchange();
      };
      $("#debrancher-boite").onclick = async () => {
        if (!(await demander("Débrancher ta boîte mail ? Les envois repasseront par Gmail/WhatsApp de ton téléphone.", { ok: "Débrancher", danger: true }))) return;
        await plateforme.boiteMail("boite-supprimer", {}, await jetonAcces()).catch((err) => erreur(err.message, err));
        afficherBoite();
      };
    } else {
      etat.innerHTML = `<p class="aide">Pas encore branchée.</p>`;
      form.hidden = false;
      form.elements.email.value ||= profil.infos.email || utilisateur?.email || "";
      form.elements.nom_affiche.value ||= profil.infos.nom || "";
      form.elements.hote.value = /@gmail\.com$/i.test(form.elements.email.value) ? "smtp.gmail.com" : form.elements.hote.value;
      form.elements.hote.onchange();
    }
  } catch (err) {
    etat.innerHTML = `<p class="aide">${esc(err.message)}</p>`;
  }
}

$("#form-boite").elements.hote.onchange = () => {
  const hote = $("#form-boite").elements.hote.value;
  $("#aide-boite").innerHTML = AIDES_BOITE[hote] ?? "<p>Utilise le mot de passe de ta messagerie (ou un mot de passe d'application si ton fournisseur le propose).</p>";
  $("#libelle-mdp").firstChild.textContent = hote === "smtp.gmail.com" ? "Mot de passe d'application " : "Mot de passe de la messagerie ";
};

$("#form-boite").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const bouton = $("#brancher-boite");
  bouton.disabled = true;
  bouton.textContent = "Test en cours…";
  try {
    const r = await plateforme.boiteMail("boite-enregistrer", { email: f.email.value.trim(), nom_affiche: f.nom_affiche.value.trim(), hote: f.hote.value, mdp: f.mdp.value }, await jetonAcces());
    f.mdp.value = "";
    notifier(`✅ Boîte mail branchée : un mail de test est parti vers ${r.email}.`);
    afficherBoite();
  } catch (err) {
    erreur(err.message, err);
  } finally {
    bouton.disabled = false;
    bouton.textContent = "🔌 Brancher ma boîte mail";
  }
};

// --- Expert-comptable : accès direct en lecture seule aux factures émises et payées ---
// Les liens envoyés aux clients et au comptable utilisent toujours l'adresse officielle de Cagot,
// même si l'appli a été ouverte par l'ancienne adresse (cagot.pages.dev).
const ORIGINE_PUBLIQUE = /(^|\.)cagot\.pages\.dev$/.test(location.hostname) ? "https://app.cagot.fr" : location.origin;
const lienComptable = (jeton) => `${ORIGINE_PUBLIQUE}/comptable.html#invitation=${jeton}`;

async function envoyerInvitationComptable(a) {
  const lien = lienComptable(a.jeton);
  const nomEntreprise = profil.infos.nom || "mon entreprise";
  const texte = `Bonjour${a.nom ? ` ${a.nom}` : ""},\n\nJe vous donne un accès en lecture seule à mes factures (${nomEntreprise}) sur Cagot : vous pourrez les consulter, télécharger les PDF et exporter le tableau pour la comptabilité et la TVA.\n\nOuvrez ce lien personnel (valable 30 jours) et créez votre compte gratuit avec votre adresse e-mail :\n${lien}\n\nCordialement,\n${[profil.infos.prenom, nomEntreprise].filter(Boolean).join(" ")}`;
  try {
    await navigator.clipboard.writeText(lien);
  } catch {
    // presse-papiers refusé : le lien est dans le message
  }
  await plateforme.partager({ sujet: `Accès à mes factures – ${nomEntreprise}`, texte, destinataires: a.email ? [a.email] : [], notifier });
}

async function afficherComptables() {
  const zone = $("#liste-comptables");
  const { data, error } = await sb.from("acces_comptables").select("id, nom, email, jeton, accepte_at, consulte_at, revoque, created_at").order("created_at", { ascending: false });
  if (error) {
    zone.innerHTML = `<p class="aide">${/acces_comptables/.test(error.message) ? "Fonction pas encore activée sur le serveur." : "Impossible de charger (connexion ?)."}</p>`;
    return;
  }
  const actifs = data.filter((a) => !a.revoque && !(!a.accepte_at && joursDepuis(a.created_at) > 30));
  zone.innerHTML = actifs
    .map((a) => {
      const etat = a.accepte_at
        ? `✅ Accès actif depuis le ${dateFr(a.accepte_at)}${a.consulte_at ? ` · dernière consultation ${ilYa(a.consulte_at)}` : ""}`
        : `⏳ Invitation envoyée ${ilYa(a.created_at)} · pas encore acceptée`;
      return `<div class="acces-comptable">
        <div><strong>${esc(a.nom || a.email)}</strong><small>${esc(a.email)}</small><span>${etat}</span></div>
        <div class="actions-doc">
          ${a.accepte_at ? "" : `<button type="button" class="action-doc" data-renvoyer="${esc(a.id)}">📤 Renvoyer le lien</button>`}
          <button type="button" class="action-doc danger" data-retirer="${esc(a.id)}">Retirer l'accès</button>
        </div></div>`;
    })
    .join("");
  for (const b of zone.querySelectorAll("[data-renvoyer]")) b.onclick = () => envoyerInvitationComptable(data.find((a) => a.id === b.dataset.renvoyer));
  for (const b of zone.querySelectorAll("[data-retirer]")) {
    b.onclick = async () => {
      const a = data.find((x) => x.id === b.dataset.retirer);
      if (!(await demander(`Retirer l'accès de ${a.nom || a.email} ? Il ne verra plus tes factures.`, { ok: "Retirer l'accès", danger: true }))) return;
      const { error: err } = await sb.from("acces_comptables").update({ revoque: true }).eq("id", a.id);
      if (err) return erreur("Accès non retiré.", err);
      notifier("Accès retiré.");
      afficherComptables();
    };
  }
}

$("#form-comptable").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target.elements;
  const a = { nom: f.nom.value.trim(), email: f.email.value.trim().toLowerCase(), jeton: jetonAleatoire() };
  if (a.email === utilisateur?.email?.toLowerCase()) return erreur("Mets l'adresse de ton comptable, pas la tienne.");
  const { error } = await sb.from("acces_comptables").insert(a);
  if (error) return erreur("Invitation impossible (connexion ?).", error);
  ev.target.reset();
  afficherComptables();
  await envoyerInvitationComptable(a);
};

// --- Mon interface : couleurs, sombre, taille du texte, barre du bas, accueil ---
let minuterieInterface = null;
function mettreInterface(i, { enregistrer = true } = {}) {
  reglagesInterface = appliquerInterface(i, profil.infos.couleur);
  local.ecrire("interface", reglagesInterface);
  local.ecrire("couleur-logo", profil.infos.couleur ?? null);
  rendreBarreDuBas();
  if (!enregistrer || !utilisateur) return;
  clearTimeout(minuterieInterface);
  minuterieInterface = setTimeout(async () => {
    profil.infos = { ...profil.infos, interface: reglagesInterface };
    const { error } = await sb.from("entreprises").upsert({ user_id: utilisateur.id, infos: profil.infos, metiers: profil.metiers, updated_at: new Date().toISOString() });
    if (error) erreur("Interface non enregistrée en ligne (elle reste sur cet appareil).", error);
  }, 700);
}
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => appliquerInterface(reglagesInterface, profil.infos.couleur));

function rendreBarreDuBas() {
  const nav = $("#navigation");
  for (const b of nav.querySelectorAll("[data-raccourci]")) b.remove();
  const plus = $("#onglet-plus");
  for (const id of reglagesInterface.raccourcis) {
    const r = RACCOURCIS[id];
    const b = document.createElement("button");
    b.dataset.vue = id;
    b.dataset.raccourci = id;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${r.svg}</svg><span>${esc(r.nom)}</span>`;
    nav.insertBefore(b, plus);
  }
}

function rendreReglagesInterface() {
  const i = reglagesInterface;
  $("#choix-themes").innerHTML = THEMES.map((t) => {
    const c = t.principal ?? (couleurValide(profil.infos.couleur) ? profil.infos.couleur : "#1f3b63");
    return `<label class="theme ${t.id === i.theme ? "choisi" : ""}"><input type="radio" name="theme-interface" value="${t.id}" ${t.id === i.theme ? "checked" : ""}>
      <span class="pastilles"><i data-couleur="${c}"></i><i data-couleur="${t.action}"></i><i data-couleur="${t.accent}"></i></span><strong>${esc(t.nom)}</strong></label>`;
  }).join("");
  for (const p of $("#choix-themes").querySelectorAll("[data-couleur]")) p.style.background = p.dataset.couleur; // (CSP : pas de style en ligne)
  for (const r of document.querySelectorAll("[name=mode-interface]")) r.checked = r.value === i.mode;
  for (const r of document.querySelectorAll("[name=taille-interface]")) r.checked = r.value === i.taille;
  const options = (choisi) => Object.entries(RACCOURCIS).map(([id, r]) => `<option value="${id}" ${id === choisi ? "selected" : ""}>${esc(r.nom)}</option>`).join("");
  $("#choix-raccourcis").innerHTML = i.raccourcis.map((id, n) => `<label>Raccourci ${n + 1}<select data-raccourci-choix="${n}">${options(id)}</select></label>`).join("");
}

$("#vue-parametres").addEventListener("change", (ev) => {
  const c = ev.target;
  const i = structuredClone(reglagesInterface);
  if (c.name === "theme-interface") i.theme = c.value;
  else if (c.name === "mode-interface") i.mode = c.value;
  else if (c.name === "taille-interface") i.taille = c.value;
  else if (c.dataset.raccourciChoix !== undefined) {
    const n = Number(c.dataset.raccourciChoix);
    const ancien = i.raccourcis[n];
    const autre = i.raccourcis.indexOf(c.value);
    if (autre !== -1) i.raccourcis[autre] = ancien; // échange si déjà dans la barre
    i.raccourcis[n] = c.value;
  } else return;
  mettreInterface(i);
  rendreReglagesInterface();
});
$("#organiser-accueil").onclick = () => {
  persoAccueil = true;
  afficherVue("accueil");
};
rendreBarreDuBas();
$("#interface-origine").onclick = () => {
  mettreInterface(structuredClone(INTERFACE_DEFAUT));
  rendreReglagesInterface();
  notifier("Interface d'origine remise.");
};

// Molette de la souris : fait défiler les rangées horizontales (onglets, filtres) sur ordinateur.
document.addEventListener(
  "wheel",
  (ev) => {
    const rangee = ev.target.closest?.(".onglets-reglages, .filtres-docs");
    if (!rangee || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || rangee.scrollWidth <= rangee.clientWidth) return;
    ev.preventDefault();
    rangee.scrollLeft += ev.deltaY;
  },
  { passive: false },
);

// Réglages en onglets
for (const b of document.querySelectorAll(".onglets-reglages [data-onglet]")) {
  b.onclick = () => {
    if (b.dataset.onglet === "mail") afficherBoite();
    if (b.dataset.onglet === "comptable") afficherComptables();
    if (b.dataset.onglet === "interface") rendreReglagesInterface();
    if (b.dataset.onglet === "tarifs") requestAnimationFrame(ajusterNomsTarifs);
    for (const x of document.querySelectorAll(".onglets-reglages [data-onglet]")) x.classList.toggle("actif", x === b);
    for (const p of document.querySelectorAll("#vue-parametres [data-panneau]")) p.hidden = p.dataset.panneau !== b.dataset.onglet;
    $("#form-entreprise").hidden = !["entreprise", "perso"].includes(b.dataset.onglet);
  };
}

// ---------------------------------------------------------------------------
// Voix : dictée (reconnaissance vocale) et synthèse vocale
// ---------------------------------------------------------------------------
const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
let reco = null;
let texteAvantDictee = "";

// La zone de saisie grandit avec le texte (jusqu'à 40 % de l'écran).
function ajusterSaisie() {
  const t = $("#texte");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight + 2, Math.round(innerHeight * 0.4))}px`;
}
$("#texte").addEventListener("input", ajusterSaisie);
$("#texte").addEventListener("focus", ajusterSaisie);
for (const ev of ["change", "keyup"]) $("#texte").addEventListener(ev, ajusterSaisie);

function demarrerDictee({ envoiAuto = false, cible = $("#texte"), bouton = $("#micro"), apresTexte } = {}) {
  if (!Reconnaissance) {
    notifier("La dictée n'est pas disponible ici : utilise le micro de ton clavier.");
    return;
  }
  arreterParole();
  reco = new Reconnaissance();
  reco.lang = "fr-FR";
  reco.interimResults = true;
  reco.continuous = !envoiAuto; // mains libres : s'arrête tout seul au silence
  texteAvantDictee = cible.value ? `${cible.value.trimEnd()} ` : "";
  let final = "";

  reco.onresult = (e) => {
    let provisoire = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += `${e.results[i][0].transcript} `;
      else provisoire += e.results[i][0].transcript;
    }
    cible.value = texteAvantDictee + final + provisoire;
    if (cible.id === "texte") ajusterSaisie();
    apresTexte?.();
  };
  reco.onerror = (e) => {
    if (e.error === "not-allowed") erreur("Autorise l'accès au micro pour dicter.");
  };
  reco.onend = () => {
    bouton.classList.remove("ecoute");
    reco = null;
    if (envoiAuto && cible.value.trim()) envoyer();
  };
  bouton.classList.add("ecoute");
  reco.start();
}

function arreterDictee() {
  reco?.stop();
}

$("#micro").onclick = () => (reco ? arreterDictee() : demarrerDictee());

function parler(texte, ensuite) {
  if (!$("#voix").checked || !("speechSynthesis" in window)) return ensuite?.();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texte);
  u.lang = "fr-FR";
  const voixFr = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("fr"));
  if (voixFr) u.voice = voixFr;
  u.onend = () => ensuite?.();
  speechSynthesis.speak(u);
}
function arreterParole() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

const prefs = local.lire("prefs", { voix: true, mainsLibres: false });
$("#voix").checked = prefs.voix;
$("#mains-libres").checked = prefs.mainsLibres;
$("#voix").onchange = $("#mains-libres").onchange = () => {
  if ($("#mains-libres").checked) $("#voix").checked = true;
  local.ecrire("prefs", { voix: $("#voix").checked, mainsLibres: $("#mains-libres").checked });
};

// ---------------------------------------------------------------------------
// Photos de notes papier (redimensionnées pour alléger l'envoi)
// ---------------------------------------------------------------------------
let photosEnAttente = [];

class ErreurPhoto extends Error {}

function chargerImage(fichier) {
  return new Promise((ok, ko) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      ko(new Error("image illisible"));
    };
    img.src = url;
  });
}

// HEIC/HEIF : par le type, l'extension ou la signature du fichier (« ftypheic », « ftypmif1 »…).
async function estHeic(fichier) {
  if (/hei[cf]/i.test(`${fichier.type} ${fichier.name}`)) return true;
  const tete = new TextDecoder().decode(await fichier.slice(4, 12).arrayBuffer());
  return /^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(tete);
}

// Réduit une photo (max 1600 px) en JPEG. createImageBitmap d'abord (moins gourmand en
// mémoire avec les grosses photos des téléphones récents), sinon <img>.
async function redimensionner(fichier, max = 1600) {
  let source = null;
  try {
    source = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    source = await chargerImage(fichier).catch(() => null);
  }
  // Photo HEIC que le navigateur ne lit pas : conversion en JPEG sur le téléphone.
  if (!source && plateforme.decodeurHeic && (await estHeic(fichier))) {
    try {
      const { heicTo } = await import(plateforme.decodeurHeic);
      const jpeg = await heicTo({ blob: fichier, type: "image/jpeg", quality: 0.9 });
      source = await createImageBitmap(jpeg).catch(() => chargerImage(jpeg));
    } catch (err) {
      console.warn("[heic]", err);
    }
  }
  if (!source) {
    throw new ErreurPhoto(
      /hei[cf]/i.test(`${fichier.type} ${fichier.name}`)
        ? "Photo au format HEIC illisible ici : dans les réglages de l'appareil photo, choisis le format JPEG (ou envoie une capture d'écran de la photo)."
        : "Cette image est illisible (format non pris en charge).",
    );
  }
  const largeur = source.width;
  const hauteur = source.height;
  const r = Math.min(1, max / Math.max(largeur, hauteur));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(largeur * r));
  c.height = Math.max(1, Math.round(hauteur * r));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  source.close?.();
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  if (!dataUrl.startsWith("data:image/jpeg")) throw new ErreurPhoto("Photo trop grande pour ce téléphone, réessaie avec une photo plus petite.");
  return dataUrl;
}

// Réessaie une opération réseau (connexion de chantier instable).
async function avecRelance(action, essais = 3) {
  for (let n = 1; ; n++) {
    try {
      return await action();
    } catch (err) {
      if (n >= essais) throw err;
      await new Promise((r) => setTimeout(r, 1200 * n));
    }
  }
}

const estPdf = (dataUrl) => dataUrl.startsWith("data:application/pdf");
const vignette = (p) => (estPdf(p) ? `<span class="piece-pdf">📄 Plan PDF</span>` : `<img src="${p}" alt="note">`);

function afficherPhotosEnAttente() {
  $("#apercu-photos").innerHTML = photosEnAttente.map(vignette).join("");
}

// Scanner un plan : photo (gardée plus nette que les photos de notes) ou PDF.
$("#plan").onchange = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      if (f.size > 7_000_000) return notifier("PDF trop lourd (7 Mo maximum) : envoie plutôt une photo du plan.", "erreur");
      photosEnAttente.push(await blobVersDataUrl(new Blob([f], { type: "application/pdf" })));
    } else photosEnAttente.push(await redimensionner(f, 2400));
  } catch (err) {
    return erreur(err instanceof ErreurPhoto ? err.message : "Plan illisible.", err);
  }
  afficherPhotosEnAttente();
  if (!$("#texte").value.trim()) $("#texte").value = "Scanne ce plan : repère les pièces et propose le métré. ";
  $("#texte").focus();
  notifier("Plan ajouté : précise si besoin ce qu'il faut exclure (ex. garage), puis Envoyer.");
};

$("#photo").onchange = async (e) => {
  for (const f of e.target.files) photosEnAttente.push(await redimensionner(f));
  e.target.value = "";
  afficherPhotosEnAttente();
};

// Conversion locale (pas de fetch sur « data: », bloqué par la politique de sécurité du site).
function versBlob(dataUrl) {
  const [entete, base64] = dataUrl.split(",");
  const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([octets], { type: entete.match(/data:(.*?);/)?.[1] ?? "image/jpeg" });
}
const blobVersDataUrl = (blob) =>
  new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(lecteur.result);
    lecteur.onerror = ko;
    lecteur.readAsDataURL(blob);
  });

// ---------------------------------------------------------------------------
// Conversation avec l'IA
// ---------------------------------------------------------------------------
// Les photos restent en mémoire pendant la session mais ne sont pas sauvegardées (trop lourdes).
let conversation = { historique: [], docId: null };

const historiqueSansPhotos = (historique) =>
  historique.map(({ images, ...m }) =>
    images?.length ? { ...m, texte: `${m.texte}\n[${images.length} photo(s) ou plan(s) joint(s)]` } : m,
  );

// Le chantier ouvert est gardé sur le téléphone (reprise instantanée) et enregistré en
// ligne dans « Mes chantiers » (plusieurs chantiers, rien ne se perd en changeant d'appareil).
function sauverConversation({ enLigne = true } = {}) {
  if (!utilisateur) return;
  local.ecrire(`conversation.${utilisateur.id}`, {
    id: conversation.id ?? null,
    titre: conversation.titre ?? "",
    docId: conversation.docId,
    noteId: conversation.noteId ?? null,
    historique: historiqueSansPhotos(conversation.historique),
  });
  afficherTitreChantier();
  if (enLigne && conversation.historique.length) {
    const c = conversation;
    clearTimeout(c.minuterie);
    c.minuterie = setTimeout(() => {
      fileChantiers = fileChantiers.then(() => enregistrerChantier(c)).catch((err) => console.warn("[chantier]", err));
    }, 300);
  }
}

let fileChantiers = Promise.resolve();

function titreChantier(c) {
  if (c.titre) return c.titre;
  const premier = c.historique.find((m) => m.role === "user")?.texte ?? "";
  const ligne = premier.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return ligne.length > 60 ? `${ligne.slice(0, 57)}…` : ligne || "Chantier sans titre";
}

function afficherTitreChantier() {
  $("#titre-chantier").textContent = conversation.historique.length ? titreChantier(conversation) : "Nouveau chantier";
}

async function enregistrerChantier(c) {
  const ligne = {
    titre: titreChantier(c).slice(0, 200),
    historique: historiqueSansPhotos(c.historique),
    document_id: c.docId ?? null,
    note_id: c.noteId ?? null,
    updated_at: new Date().toISOString(),
  };
  if (c.id) {
    const { error } = await sb.from("chantiers").update(ligne).eq("id", c.id);
    if (error) throw error;
    return;
  }
  const { data, error } = await sb.from("chantiers").insert(ligne).select("id").single();
  if (error) throw error;
  c.id = data.id;
  if (c === conversation) sauverConversation({ enLigne: false });
}

function nouvelleConversation(extra = {}) {
  conversation = { historique: [], docId: null, ...extra };
  sauverConversation({ enLigne: false });
  reafficherConversation();
}

function ouvrirConversation(ch) {
  conversation = {
    id: ch.id,
    titre: ch.titre,
    historique: ch.historique ?? [],
    docId: ch.document_id ?? null,
    noteId: ch.note_id ?? null,
    clientId: ch.client_id ?? null,
  };
  sauverConversation({ enLigne: false });
  reafficherConversation();
}

function montrerListeChantiers(visible) {
  $("#liste-chantiers").hidden = !visible;
  $("#zone-conversation").hidden = visible;
  $("#mes-chantiers").classList.toggle("actif", visible);
  if (visible) afficherListeChantiers();
}

async function afficherListeChantiers() {
  const liste = $("#liste-chantiers");
  liste.innerHTML = `<p class="aide">Chargement…</p>`;
  await fileChantiers; // le chantier en cours est enregistré avant d'afficher la liste
  const { data, error } = await sb
    .from("chantiers")
    .select("id, titre, document_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    liste.innerHTML = `<p class="aide">Impossible de charger les chantiers (connexion ?).</p>`;
    return;
  }
  liste.innerHTML = data.length
    ? data
        .map(
          (ch) => `<div class="element-liste ${ch.id === conversation.id ? "courant" : ""}" data-chantier="${esc(ch.id)}">
            <div><strong>${esc(ch.titre || "Chantier sans titre")}</strong>
              <small>${dateFr(ch.updated_at)}${ch.id === conversation.id ? " · ouvert" : ""}</small></div>
            <div class="droite">${ch.document_id ? `<span class="pastille devis">devis</span>` : ""}
              <button type="button" class="suppr-chantier" data-suppr-chantier="${esc(ch.id)}" aria-label="Supprimer">✕</button></div>
          </div>`,
        )
        .join("")
    : `<p class="aide">Aucun chantier enregistré pour l'instant.</p>`;
  for (const el of liste.querySelectorAll("[data-chantier]")) {
    el.onclick = async (ev) => {
      if (ev.target.closest("[data-suppr-chantier]")) return;
      const { data: ch, error: err } = await sb.from("chantiers").select("*").eq("id", el.dataset.chantier).single();
      if (err) return erreur("Chantier introuvable.", err);
      ouvrirConversation(ch);
      montrerListeChantiers(false);
    };
  }
  for (const b of liste.querySelectorAll("[data-suppr-chantier]")) {
    b.onclick = async () => {
      if (!(await demander("Supprimer ce chantier ? La conversation sera effacée (le devis éventuel reste dans Documents).", { ok: "Supprimer", danger: true }))) return;
      const id = b.dataset.supprChantier;
      const { error: err } = await sb.from("chantiers").delete().eq("id", id);
      if (err) return erreur("Suppression impossible.", err);
      if (conversation.id === id) nouvelleConversation();
      afficherListeChantiers();
    };
  }
}

$("#mes-chantiers").onclick = () => montrerListeChantiers($("#liste-chantiers").hidden);

function bulle(classe, html) {
  const div = document.createElement("div");
  div.className = `bulle ${classe}`;
  div.innerHTML = html;
  $("#fil").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

function bulleIa(m) {
  const enAttente = m.questions?.length && conversation.historique.at(-1) === m;
  const questions = m.questions?.length && !enAttente ? `<ol>${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : "";
  const bouton = m.docId
    ? `<br><button class="btn-principal" data-doc="${esc(m.docId)}">Voir le devis</button> <button class="btn-secondaire" data-retour-fiche>← Chantier</button>`
    : "";
  const div = bulle("ia", esc(m.texte) + questions + bouton);
  div.querySelector("[data-doc]")?.addEventListener("click", () => {
    ficheCourante = conversation.id ?? ficheCourante;
    ouvrirDocument(m.docId);
  });
  div.querySelector("[data-retour-fiche]")?.addEventListener("click", async () => {
    await fileChantiers;
    if (conversation.id) ouvrirFiche(conversation.id);
  });
  if (enAttente) carteQuestions(m);
  if (m.metre?.length) carteMetre(m);
}

// Métré lu sur un plan : tableau à vérifier/corriger, puis à utiliser pour le devis.
const SOURCES_METRE = { plan: "écrit sur le plan", cotes: "calculé (cotes)", echelle: "mesuré à l'échelle", estime: "estimé ⚠️" };
function carteMetre(m) {
  const lignes = m.metre.map((p) => ({ ...p }));
  const zone = document.createElement("div");
  zone.className = "carte-metre";
  const rendre = () => {
    const totSol = lignes.reduce((t, p) => t + (Number(p.surface_sol_m2) || 0), 0);
    const totMurs = lignes.reduce((t, p) => t + (Number(p.surface_murs_m2) || 0), 0);
    zone.innerHTML = `
      <div class="metre-titre">📐 Métré à vérifier <small>${lignes.length} pièce${lignes.length > 1 ? "s" : ""}</small></div>
      <table class="table-metre"><thead><tr><th>Pièce</th><th>Sol m²</th><th>Murs m²</th><th></th></tr></thead><tbody>
      ${lignes
        .map(
          (p, i) => `<tr class="source-${esc(p.source)}">
          <td><input data-i="${i}" data-k="piece" value="${esc(p.piece)}"><small>${SOURCES_METRE[p.source] ?? ""}${p.hauteur_m ? ` · h ${nombre(p.hauteur_m)} m` : ""}${p.remarque ? ` · ${esc(p.remarque)}` : ""}</small></td>
          <td><input data-i="${i}" data-k="surface_sol_m2" inputmode="decimal" value="${nombre(p.surface_sol_m2)}"></td>
          <td><input data-i="${i}" data-k="surface_murs_m2" inputmode="decimal" value="${p.surface_murs_m2 ? nombre(p.surface_murs_m2) : ""}" placeholder="?"></td>
          <td><button type="button" class="suppr-ligne" data-retirer="${i}" aria-label="Retirer">✕</button></td></tr>`,
        )
        .join("")}
      </tbody><tfoot><tr><td>Total</td><td>${nombre(Math.round(totSol * 100) / 100)}</td><td>${totMurs ? nombre(Math.round(totMurs * 100) / 100) : ""}</td><td></td></tr></tfoot></table>
      <p class="aide">Les mesures viennent du plan : vérifie-les et corrige-les si besoin avant de faire le devis.</p>
      <div class="actions-doc">
        <button type="button" class="action-doc principal" data-utiliser>✅ Utiliser ce métré</button>
        <button type="button" class="action-doc" data-note-metre>🗒️ En faire une note</button>
      </div>`;
    for (const champ of zone.querySelectorAll("input[data-k]")) {
      champ.onchange = () => {
        const p = lignes[champ.dataset.i];
        p[champ.dataset.k] = champ.dataset.k === "piece" ? champ.value.trim() : lireNombre(champ.value);
        rendre();
      };
    }
    for (const b of zone.querySelectorAll("[data-retirer]")) {
      b.onclick = () => {
        lignes.splice(Number(b.dataset.retirer), 1);
        rendre();
      };
    }
    const texte = () =>
      "Métré validé (reprends ces surfaces telles quelles) :\n" +
      lignes
        .map((p) => `- ${p.piece} : sol ${nombre(p.surface_sol_m2)} m²${p.surface_murs_m2 ? `, murs ${nombre(p.surface_murs_m2)} m²` : ""}${p.hauteur_m ? ` (h ${nombre(p.hauteur_m)} m)` : ""}`)
        .join("\n");
    zone.querySelector("[data-utiliser]").onclick = () => {
      $("#texte").value = `${texte()}\n\nTravaux à chiffrer : `;
      ajusterSaisie();
      $("#texte").focus();
      $("#texte").setSelectionRange($("#texte").value.length, $("#texte").value.length);
      notifier("Écris maintenant les travaux pièce par pièce, puis Envoyer.");
    };
    zone.querySelector("[data-note-metre]").onclick = async () => {
      const { data, error } = await sb.from("notes").insert({ titre: `Métré ${conversation.titre || ""}`.trim().slice(0, 200), contenu: `${texte()}\n\n` }).select("*").single();
      if (error) return erreur("Note non créée.", error);
      afficherEditeurNote(data);
    };
  };
  rendre();
  $("#fil").appendChild(zone);
}

// Les questions de l'IA en cartes : une case réponse par question, réponses rapides à toucher.
function carteQuestions(m) {
  const total = m.questions.length;
  const reponses = new Array(total).fill("");
  const zone = document.createElement("div");
  zone.className = "cartes-questions";
  zone.innerHTML = `
    <div class="progression"><div class="barre-progression"><span></span></div><small class="compteur"></small></div>
    ${m.questions
      .map(
        (q, i) => `<div class="carte-question" data-i="${i}">
          <div class="q-entete"><span class="q-num">${i + 1}</span><span class="q-texte">${esc(q)}</span><span class="q-ok" aria-hidden="true">✓</span></div>
          <div class="q-choix">${[...(m.suggestions?.[i] ?? []).slice(0, 4), "Je ne sais pas"]
            .map((s) => `<button type="button" class="puce" data-val="${esc(s)}">${esc(s)}</button>`)
            .join("")}</div>
          <textarea rows="1" class="q-reponse" placeholder="Ta réponse…"></textarea>
        </div>`,
      )
      .join("")}
    <button type="button" class="btn-principal envoyer-reponses">Envoyer mes réponses</button>`;
  const maj = () => {
    const faites = reponses.filter((r) => r.trim()).length;
    zone.querySelector(".barre-progression span").style.width = `${(100 * faites) / total}%`;
    zone.querySelector(".compteur").textContent = faites === total ? "Tout est rempli 👍" : `${faites} / ${total} réponse${faites > 1 ? "s" : ""}`;
    zone.querySelectorAll(".carte-question").forEach((c, i) => c.classList.toggle("repondue", !!reponses[i].trim()));
    zone.querySelector(".envoyer-reponses").classList.toggle("pret", faites === total);
  };
  zone.querySelectorAll(".carte-question").forEach((carte, i) => {
    const champ = carte.querySelector(".q-reponse");
    const ajuster = () => {
      champ.style.height = "auto";
      champ.style.height = `${champ.scrollHeight}px`;
    };
    champ.oninput = () => {
      reponses[i] = champ.value;
      carte.querySelectorAll(".puce").forEach((p) => p.classList.toggle("choisie", p.dataset.val === champ.value));
      ajuster();
      maj();
    };
    carte.querySelectorAll(".puce").forEach((p) => {
      p.onclick = () => {
        champ.value = champ.value === p.dataset.val ? "" : p.dataset.val;
        champ.oninput();
        // Question suivante pas encore remplie
        if (champ.value) zone.querySelectorAll(".carte-question:not(.repondue)")[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
  });
  zone.querySelector(".envoyer-reponses").onclick = () => {
    if (!reponses.some((r) => r.trim())) return notifier("Réponds au moins à une question.");
    const texte = m.questions
      .map((q, i) => `${i + 1}. ${q}\n→ ${reponses[i].trim() || "Je ne sais pas (suppose au mieux et signale-le)"}`)
      .join("\n");
    const libre = $("#texte").value.trim();
    zone.remove();
    $("#texte").value = libre ? `${texte}\n\n${libre}` : texte;
    ajusterSaisie();
    envoyer();
  };
  $("#fil").appendChild(zone);
  maj();
}

function reafficherConversation() {
  $("#fil").querySelectorAll(".bulle:not(:first-child), .cartes-questions, .carte-metre").forEach((b) => b.remove());
  for (const m of conversation.historique) {
    if (m.role === "user") {
      bulle("moi", esc(m.texte) + (m.images ?? []).map(vignette).join(""));
    } else bulleIa(m);
  }
}

async function envoyer() {
  const texte = $("#texte").value.trim();
  if (!texte && photosEnAttente.length === 0) return;
  arreterDictee();
  arreterParole();

  $("#fil").querySelectorAll(".cartes-questions").forEach((z) => z.remove());
  const message = { role: "user", texte, images: photosEnAttente };
  conversation.historique.push(message);
  bulle("moi", esc(texte) + photosEnAttente.map((i) => `<img src="${i}" alt="note">`).join(""));
  $("#texte").value = "";
  ajusterSaisie();
  photosEnAttente = [];
  afficherPhotosEnAttente();
  $("#envoyer").disabled = true;
  const attente = bulle("ia attente", "Je réfléchis au chantier…");

  try {
    const data = await plateforme.appelerIA(
      {
        historique: await historiquePourIA(),
        entreprise: { nom: profil.infos.nom, metiers: profil.metiers, franchise_tva: !!profil.infos.franchise_tva },
        tarifs: tarifs
          .filter((t) => t.designation)
          .map((t) => ({ corps_etat: t.corps_etat, designation: t.designation, unite: t.unite, prix: Number(t.prix) })),
      },
      await jetonAcces(),
    );
    attente.remove();
    if (data.demo) $("#bandeau-demo").hidden = false;

    const reponse = { role: "assistant", texte: data.message, questions: data.questions, suggestions: data.suggestions ?? [], metre: data.metre ?? [], brut: data.brut };
    conversation.historique.push(reponse);
    if (data.statut === "devis" && data.devis) {
      reponse.docId = await enregistrerDevis(data.devis);
      if (conversation.noteId) {
        await sb.from("notes").update({ document_id: reponse.docId }).eq("id", conversation.noteId);
      }
    }
    sauverConversation();
    bulleIa(reponse);

    const aDire = [data.message, ...(data.questions ?? [])].join(" ");
    const relancer = $("#mains-libres").checked && data.statut === "questions";
    parler(aDire, relancer ? () => demarrerDictee({ envoiAuto: true }) : undefined);
  } catch (err) {
    attente.remove();
    if (conversation.historique.at(-1) === message) {
      conversation.historique.pop(); // on laisse l'artisan renvoyer le même message
      $("#texte").value = texte;
      ajusterSaisie();
    }
    bulle("erreur", esc(err.message));
  } finally {
    $("#envoyer").disabled = false;
  }
}

$("#saisie").onsubmit = (e) => {
  e.preventDefault();
  envoyer();
};

// Nouveau chantier : l'actuel reste dans « Mes chantiers ».
$("#nouveau").onclick = () => {
  nouvelleConversation();
  montrerListeChantiers(false);
  $("#texte").focus();
};

// Devis déjà fait et retouché à la main : l'IA reçoit la version à jour (avec les
// modifications de l'artisan) jointe au dernier message, pour ne pas repartir de son ancienne version.
async function historiquePourIA() {
  const h = conversation.historique.map(({ role, texte, brut, images }) => ({ role, texte, brut, images }));
  if (!conversation.docId) return h;
  const { data: doc } = await sb.from("documents").select("contenu").eq("id", conversation.docId).eq("type", "devis").maybeSingle();
  if (!doc) return h;
  const { suivi, hypotheses, total_ht, montant_tva, total_ttc, ...actuel } = doc.contenu;
  actuel.sections = (actuel.sections ?? []).map(({ sous_total_ht, ...sec }) => ({
    ...sec,
    lignes: (sec.lignes ?? []).map(({ total_ht: _t, ...l }) => ({ ...l, prix_source: l.prix_source === "artisan" ? "grille" : l.prix_source })),
  }));
  let json = JSON.stringify(actuel);
  if (json.length > 40000) json = JSON.stringify({ ...actuel, sections: actuel.sections.map((s) => ({ ...s, lignes: s.lignes.map(({ calcul, ...l }) => l) })) });
  const dernier = h.at(-1);
  dernier.texte = `${dernier.texte}\n\n[DEVIS ACTUEL – version à jour, avec les modifications faites à la main par l'artisan. Pars de CE devis : garde à l'identique tout ce que je ne demande pas de changer (lignes, quantités, prix, textes).]\n${json}`.slice(0, 49000);
  return h;
}

async function enregistrerDevis(devis) {
  for (const l of (devis.sections ?? []).flatMap((s) => s.lignes ?? [])) {
    if (!l.option) delete l.option;
    else if (l.option_retenue === undefined) l.option_retenue = true; // option proposée par l'IA : incluse dans le prix envoyé
  }
  // Chantier créé depuis la fiche d'un client : ses coordonnées vont directement dans le devis.
  const lie = await clientParId(conversation.clientId);
  if (lie) {
    devis.client_nom = lie.nom;
    for (const k of ["adresse", "email", "telephone"]) if (lie[k]) devis[`client_${k}`] = lie[k];
  }
  await completerDepuisCarnet(devis);
  memoriserClient(devis);
  conversation.titre ||= [devis.titre, devis.client_nom].filter(Boolean).join(" – ").slice(0, 200);
  const histo = historiqueSansPhotos(conversation.historique);
  if (conversation.docId) {
    const { data: existant } = await sb.from("documents").select("contenu").eq("id", conversation.docId).eq("type", "devis").maybeSingle();
    if (existant) {
      const ancien = existant.contenu;
      // Les prix saisis à la main restent marqués « artisan » s'ils n'ont pas changé.
      const prixArtisan = new Map(
        (ancien.sections ?? []).flatMap((s) => s.lignes ?? []).filter((l) => l.prix_source === "artisan").map((l) => [normaliser(l.designation), l.prix_unitaire_ht]),
      );
      for (const l of (devis.sections ?? []).flatMap((s) => s.lignes ?? [])) {
        if (prixArtisan.get(normaliser(l.designation)) === l.prix_unitaire_ht) l.prix_source = "artisan";
      }
      const contenu = {
        ...devis,
        client_nom: devis.client_nom || ancien.client_nom,
        client_adresse: devis.client_adresse || ancien.client_adresse,
        client_email: devis.client_email || ancien.client_email || "",
        client_telephone: devis.client_telephone || ancien.client_telephone || "",
        ...(ancien.suivi ? { suivi: ancien.suivi } : {}),
      };
      // Les choix légaux faits à la main restent (type de client, rétractation, dates, autoliquidation).
      for (const k of ["client_type", "client_siren", "hors_etablissement", "date_debut", "autoliquidation", "taux_tva_avant"]) {
        if (ancien[k] !== undefined && contenu[k] === undefined) contenu[k] = ancien[k];
      }
      if (!contenu.adresse_chantier && ancien.adresse_chantier) contenu.adresse_chantier = ancien.adresse_chantier;
      if (contenu.autoliquidation) Object.assign(contenu, calculerTotaux({ ...contenu, taux_tva: 0 }));
      const { error } = await sb.from("documents").update({ contenu, conversation: histo }).eq("id", conversation.docId);
      if (error) throw new Error("Le devis n'a pas pu être enregistré.");
      return conversation.docId;
    }
  }
  const { data, error } = await sb
    .from("documents")
    .insert({ type: "devis", contenu: devis, conversation: histo })
    .select("id")
    .single();
  if (error) throw new Error("Le devis n'a pas pu être enregistré.");
  conversation.docId = data.id;
  return data.id;
}

// ---------------------------------------------------------------------------
// Notes de chantier (bloc-notes plein écran, enregistrement automatique)
// ---------------------------------------------------------------------------
// Chaque frappe est gardée tout de suite sur le téléphone (réseau faible sur chantier),
// puis envoyée en ligne après une courte pause.
let noteCourante = null;
let minuterieNote = null;
let enregistrementNote = Promise.resolve();

const cleNoteLocale = (id) => `note.${utilisateur?.id}.${id}`;
const titreAuto = (contenu) => contenu.trim().split("\n")[0].slice(0, 80) || "Note sans titre";
const heureFr = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function etatNote(texte) {
  $("#etat-note").textContent = texte;
}

async function afficherNotes() {
  $("#liste-notes").innerHTML = `<p class="aide">Chargement…</p>`;
  const { data: notes, error } = await sb.from("notes").select("*").order("updated_at", { ascending: false }).limit(300);
  if (error) {
    $("#liste-notes").innerHTML = `<p class="aide">Impossible de charger les notes (connexion ?).</p>`;
    return;
  }
  $("#liste-notes").innerHTML = notes.length
    ? notes
        .map(
          (n) => `<div class="element-liste" data-note="${esc(n.id)}">
            <div><strong>${esc(n.titre || titreAuto(n.contenu))}</strong>
              <small>${dateFr(n.updated_at)} à ${heureFr(n.updated_at)}</small>
              <span class="extrait">${esc(n.contenu.slice(0, 200))}</span>
              ${n.photos?.length ? `<small>📷 ${n.photos.length} photo${n.photos.length > 1 ? "s" : ""}</small>` : ""}</div>
            <div class="droite">${n.envoyee_at ? `<span class="pastille envoyee">${n.document_id ? "devis fait" : "envoyée"}</span>` : ""}</div>
          </div>`,
        )
        .join("")
    : `<p class="aide">Aucune note pour l'instant.</p>`;
  for (const el of document.querySelectorAll("[data-note]")) el.onclick = () => ouvrirNote(el.dataset.note);
}

function afficherEditeurNote(note) {
  noteCourante = note;
  // Une copie locale plus récente (enregistrement en ligne raté) l'emporte.
  const copie = local.lire(cleNoteLocale(note.id), null);
  if (copie && copie.updated_at > note.updated_at) Object.assign(noteCourante, copie);
  noteCourante.photos ??= [];
  $("#titre-note").value = noteCourante.titre;
  $("#contenu-note").value = noteCourante.contenu;
  if (plateforme.stockagePhotos) photosEnAttente = []; // les photos de la note sont rangées avec elle
  afficherPhotosNote();
  afficherClientNote(note);
  etatNote(copie && copie.updated_at > note.updated_at ? "Modifications locales à enregistrer" : "Enregistrée");
  afficherVue("note");
  if (copie && copie.updated_at > note.updated_at) programmerEnregistrementNote(0);
}

// Client lié au chantier de la note : rappelé au-dessus de la note (pas besoin de le réécrire).
async function afficherClientNote(note) {
  const zone = $("#client-note");
  zone.hidden = true;
  const { data } = await sb.from("chantiers").select("client_id").eq("note_id", note.id).not("client_id", "is", null).limit(1);
  const c = await clientParId(data?.[0]?.client_id);
  if (!c || noteCourante?.id !== note.id) return;
  zone.textContent = `👤 ${[c.nom, c.adresse?.replace(/\n/g, ", "), c.telephone].filter(Boolean).join(" · ")}`;
  zone.title = "Coordonnées reprises automatiquement dans le devis";
  zone.hidden = false;
}

async function ouvrirNote(id) {
  const { data, error } = await sb.from("notes").select("*").eq("id", id).maybeSingle();
  if (error || !data) return erreur("Note introuvable.", error);
  afficherEditeurNote(data);
}

$("#nouvelle-note").onclick = async () => {
  const { data, error } = await sb.from("notes").insert({ titre: "", contenu: "" }).select("*").single();
  if (error) return erreur("Impossible de créer la note (connexion ?).", error);
  afficherEditeurNote(data);
  $("#contenu-note").focus();
};

function programmerEnregistrementNote(delai = 800) {
  if (!noteCourante) return;
  noteCourante.titre = $("#titre-note").value;
  noteCourante.contenu = $("#contenu-note").value;
  noteCourante.updated_at = new Date().toISOString();
  local.ecrire(cleNoteLocale(noteCourante.id), { titre: noteCourante.titre, contenu: noteCourante.contenu, updated_at: noteCourante.updated_at });
  etatNote("Enregistrement…");
  clearTimeout(minuterieNote);
  minuterieNote = setTimeout(enregistrerNote, delai);
}

function enregistrerNote() {
  clearTimeout(minuterieNote);
  if (!noteCourante) return enregistrementNote;
  const { id, titre, contenu } = noteCourante;
  enregistrementNote = enregistrementNote.then(async () => {
    const { error } = await sb.from("notes").update({ titre, contenu, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      etatNote("Pas de réseau : gardée sur le téléphone");
      return;
    }
    local.effacer(cleNoteLocale(id));
    if (noteCourante?.id === id)
      etatNote(plateforme.horsLigne?.enAttente() ? "📴 Gardée sur le téléphone · envoi au retour du réseau" : `Enregistrée à ${heureFr(new Date().toISOString())}`);
  });
  return enregistrementNote;
}

function quitterNote() {
  if (!noteCourante) return;
  arreterDictee();
  enregistrerNote();
  noteCourante = null;
}

$("#titre-note").oninput = $("#contenu-note").oninput = () => programmerEnregistrementNote();
// Enregistrer tout de suite si l'artisan quitte l'appli (écran verrouillé, autre appli).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && noteCourante) enregistrerNote();
});

$("#retour-notes").onclick = () => (ficheCourante ? ouvrirFiche(ficheCourante) : afficherVue("notes"));

$("#micro-note").onclick = () =>
  reco
    ? arreterDictee()
    : demarrerDictee({ cible: $("#contenu-note"), bouton: $("#micro-note"), apresTexte: () => programmerEnregistrementNote() });

$("#supprimer-note").onclick = async () => {
  if (!(await demander("Supprimer cette note ?", { ok: "Supprimer", danger: true }))) return;
  const { id, photos = [] } = noteCourante;
  clearTimeout(minuterieNote);
  noteCourante = null;
  const { error } = await sb.from("notes").delete().eq("id", id);
  if (error) return erreur("Suppression impossible.", error);
  local.effacer(cleNoteLocale(id));
  plateforme.stockagePhotos?.supprimer(photos).catch((err) => console.error(err));
  afficherVue("notes");
};

$("#envoyer-note").onclick = async () => {
  if (!navigator.onLine) return notifier("📴 L'IA a besoin du réseau. Ta note et tes photos sont bien gardées : relance dès que tu as du réseau.", "erreur");
  const contenu = $("#contenu-note").value.trim();
  const nbPhotos = (noteCourante.photos?.length ?? 0) + photosEnAttente.length;
  if (!contenu && nbPhotos === 0) return notifier("La note est vide.");
  const note = noteCourante;
  await enregistrerNote();
  if (plateforme.stockagePhotos && note.photos?.length) {
    etatNote("Préparation des photos…");
    try {
      photosEnAttente = await Promise.all(
        note.photos.slice(0, 10).map(async (chemin) => blobVersDataUrl(await chargerPhoto(chemin))),
      );
    } catch (err) {
      return erreur("Impossible de récupérer les photos de la note (connexion ?).", err);
    }
  }
  await sb.from("notes").update({ envoyee_at: new Date().toISOString() }).eq("id", note.id);
  // Le chantier de cette note (créé avec elle), sinon un nouveau chantier
  const { data: lies } = await sb.from("chantiers").select("*").eq("note_id", note.id).order("updated_at", { ascending: false }).limit(1);
  if (lies?.length) ouvrirConversation(lies[0]);
  else nouvelleConversation({ noteId: note.id, titre: note.titre || "" });
  montrerListeChantiers(false);
  afficherVue("chantier");
  ficheCourante = conversation.id ?? null;
  const lie = await clientParId(lies?.[0]?.client_id);
  const rappel = lie && !normaliser(contenu).includes(normaliser(lie.nom)) ? `Client : ${lie.nom}` : "";
  const debut = [rappel && normaliser(note.titre) === normaliser(lie.nom) ? "" : note.titre, rappel].filter(Boolean).join("\n");
  $("#texte").value = [debut, contenu].filter(Boolean).join("\n\n");
  ajusterSaisie();
  envoyer();
};

// --- Photos de la note (enregistrées en ligne avec elle) ---
const urlsPhotos = new Map(); // chemin -> aperçu déjà chargé
const photosEnCours = new Map(); // id temporaire -> aperçu pendant l'envoi
const nouvelIdLocal = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function chargerPhoto(chemin) {
  const blob = await plateforme.stockagePhotos.telecharger(chemin);
  return blob.type.startsWith("image/") ? blob : new Blob([blob], { type: "image/jpeg" });
}

async function urlPhoto(chemin) {
  if (!urlsPhotos.has(chemin)) urlsPhotos.set(chemin, URL.createObjectURL(await chargerPhoto(chemin)));
  return urlsPhotos.get(chemin);
}

async function afficherPhotosNote() {
  const zone = $("#photos-note");
  if (!plateforme.stockagePhotos) {
    // Version d'essai : photos gardées le temps de la session, envoyées avec la note.
    zone.innerHTML = photosEnAttente.map((p) => `<div class="photo-note"><img src="${p}" alt="Photo de la note"></div>`).join("");
    return;
  }
  const note = noteCourante;
  if (!note) return;
  const cartes = await Promise.all(
    note.photos.map(async (chemin) => {
      const bouton = `<button type="button" data-suppr-photo="${esc(chemin)}" aria-label="Retirer la photo">✕</button>`;
      try {
        return `<div class="photo-note"><img src="${await urlPhoto(chemin)}" alt="Photo de la note">${bouton}</div>`;
      } catch {
        return `<div class="photo-note">${bouton}</div>`;
      }
    }),
  );
  if (noteCourante !== note) return;
  const enCours = [...photosEnCours.values()].map((p) => `<div class="photo-note envoi"><img src="${p}" alt="Envoi en cours"></div>`);
  zone.innerHTML = [...cartes, ...enCours].join("");
  for (const b of zone.querySelectorAll("[data-suppr-photo]")) {
    b.onclick = async () => {
      if (!(await demander("Retirer cette photo de la note ?", { ok: "Retirer", danger: true }))) return;
      const chemin = b.dataset.supprPhoto;
      note.photos = note.photos.filter((c) => c !== chemin);
      const { error } = await sb.from("notes").update({ photos: note.photos }).eq("id", note.id);
      if (error) return erreur("Photo non retirée (connexion ?).", error);
      plateforme.stockagePhotos.supprimer([chemin]).catch((err) => console.error(err));
      afficherPhotosNote();
    };
  }
}

// Ajoute des images à une note : redimensionnées, puis rangées en ligne.
async function ajouterPhotosNote(note, fichiers) {
  const images = [...fichiers].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  if (!plateforme.stockagePhotos) {
    for (const f of images) photosEnAttente.push(await redimensionner(f));
    if (noteCourante === note) afficherPhotosNote();
    return;
  }
  const place = 20 - note.photos.length;
  if (place <= 0) return notifier("20 photos maximum par note.", "erreur");
  if (images.length > place) notifier(`Seules ${place} photo(s) ajoutée(s) : 20 maximum par note.`);
  for (const f of images.slice(0, place)) {
    const idTemp = nouvelIdLocal();
    try {
      const dataUrl = await redimensionner(f);
      photosEnCours.set(idTemp, dataUrl);
      if (noteCourante === note) afficherPhotosNote();
      const chemin = `${utilisateur.id}/${note.id}/${nouvelIdLocal()}.jpg`;
      await avecRelance(() => plateforme.stockagePhotos.televerser(chemin, versBlob(dataUrl)));
      note.photos = [...note.photos, chemin];
      urlsPhotos.set(chemin, dataUrl);
      await avecRelance(async () => {
        const { error } = await sb.from("notes").update({ photos: note.photos }).eq("id", note.id);
        if (error) throw error;
      });
    } catch (err) {
      if (err instanceof ErreurPhoto) erreur(err.message, err);
      else erreur(`Une photo n'a pas pu être enregistrée (${String(err?.message || err).slice(0, 80)}). Vérifie la connexion et réessaie.`, err);
    } finally {
      photosEnCours.delete(idTemp);
      if (noteCourante === note) afficherPhotosNote();
    }
  }
}

$("#photo-note").onchange = $("#galerie-note").onchange = async (e) => {
  const fichiers = [...e.target.files];
  e.target.value = "";
  if (noteCourante) await ajouterPhotosNote(noteCourante, fichiers);
};

// --- Importer des notes : coller, fichier texte/photos, ou « Partager → Cagot » ---
// Lecture des fichiers Word (.docx) : un .docx est une archive ZIP contenant le texte
// (word/document.xml) et les images (word/media/*). Décompression native du navigateur.
async function lireZip(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const vue = new DataView(octets.buffer);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("archive illisible");
  const nb = vue.getUint16(fin + 10, true);
  let pos = vue.getUint32(fin + 16, true);
  const entrees = new Map();
  const decodeur = new TextDecoder();
  for (let k = 0; k < nb && vue.getUint32(pos, true) === 0x02014b50; k++) {
    const methode = vue.getUint16(pos + 10, true);
    const taille = vue.getUint32(pos + 20, true);
    const lNom = vue.getUint16(pos + 28, true), lExtra = vue.getUint16(pos + 30, true), lComm = vue.getUint16(pos + 32, true);
    const debutLocal = vue.getUint32(pos + 42, true);
    const nom = decodeur.decode(octets.subarray(pos + 46, pos + 46 + lNom));
    entrees.set(nom, async () => {
      const debut = debutLocal + 30 + vue.getUint16(debutLocal + 26, true) + vue.getUint16(debutLocal + 28, true);
      const brut = octets.subarray(debut, debut + taille);
      if (methode === 0) return new Blob([brut]);
      if (methode !== 8) throw new Error("compression non gérée");
      return new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    });
    pos += 46 + lNom + lExtra + lComm;
  }
  return entrees;
}

const decoderEntites = (t) =>
  t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

async function lireDocx(fichier) {
  const zip = await lireZip(fichier);
  const doc = zip.get("word/document.xml");
  if (!doc) throw new Error("pas un document Word");
  const xml = (await (await doc()).text()).replace(/\r?\n/g, "");
  const texte = decoderEntites(
    xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const images = [];
  for (const [nom, lire] of zip) {
    const ext = nom.match(/^word\/media\/.+\.(\w+)$/i)?.[1]?.toLowerCase();
    if (ext && types[ext]) images.push(new File([await lire()], nom.split("/").pop(), { type: types[ext] }));
  }
  return { texte, images };
}

const estDocx = (f) => /\.docx$/i.test(f.name ?? "") || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const estTexte = (f) => f.type.startsWith("text/") || /\.(txt|md|html?)$/i.test(f.name ?? "");
const texteSansBalises = (html) =>
  decoderEntites(html.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")).trim();

async function creerNoteImportee({ titre = "", contenu = "", fichiers = [] }) {
  const textes = [];
  const images = fichiers.filter((f) => f.type.startsWith("image/"));
  const ignores = [];
  for (const f of fichiers) {
    if (f.type.startsWith("image/")) continue;
    try {
      if (estDocx(f)) {
        const docx = await lireDocx(f);
        textes.push(docx.texte);
        images.push(...docx.images);
      } else if (estTexte(f)) {
        const t = await f.text();
        textes.push(/html?$/i.test(f.type + f.name) ? texteSansBalises(t) : t);
      } else ignores.push(f.name || f.type || "fichier");
    } catch (err) {
      console.error(err);
      ignores.push(f.name || "fichier");
    }
  }
  if (ignores.length) notifier(`Format non pris en charge : ${ignores.join(", ")}. Partage plutôt en texte, image ou Word.`, "erreur");
  const texteComplet = [contenu, ...textes].map((t) => t.trim()).filter(Boolean).join("\n\n").slice(0, 50000);
  if (!texteComplet && !images.length && !titre.trim()) {
    if (!ignores.length) notifier("Rien n'a été reçu. Partage la note en texte, en image ou en fichier Word.", "erreur");
    return null;
  }
  if (!titre.trim() && texteComplet) {
    // Première ligne courte comme titre (ex. « Devis pascal violland »)
    const premiere = texteComplet.split("\n")[0].trim();
    if (premiere.length <= 80 && texteComplet.includes("\n")) titre = premiere;
  }
  const { data: note, error } = await sb
    .from("notes")
    .insert({ titre: titre.trim().slice(0, 200), contenu: texteComplet })
    .select("*")
    .single();
  if (error) {
    erreur("Impossible de créer la note (connexion ?).", error);
    return null;
  }
  afficherEditeurNote(note);
  await ajouterPhotosNote(note, images);
  if (!ignores.length) notifier("Note importée : vérifie-la puis fais le devis.");
  return note;
}

$("#coller-note").onclick = async () => {
  let texte = "";
  try {
    texte = await navigator.clipboard.readText();
  } catch {
    /* lecture du presse-papiers refusée : on ouvre une note vide */
  }
  if (!texte.trim()) {
    $("#nouvelle-note").click();
    notifier("Appuie longuement dans la note puis choisis « Coller ».");
    return;
  }
  creerNoteImportee({ contenu: texte });
};

$("#importer-note").onchange = async (e) => {
  const fichiers = [...e.target.files];
  e.target.value = "";
  if (fichiers.length) creerNoteImportee({ fichiers });
};

// Contenu reçu par « Partager → Cagot » : le service worker l'a rangé dans un cache.
async function importerPartage() {
  if (!new URLSearchParams(location.search).has("partage")) return;
  history.replaceState(null, "", location.pathname);
  if (!("caches" in window)) return;
  const cache = await caches.open("cagot-partage");
  const reponse = await cache.match("/partage/contenu.json");
  if (!reponse) return;
  const { titre, texte, url, fichiers: descriptions = [] } = await reponse.json();
  const fichiers = [];
  for (const d of descriptions) {
    const r = await cache.match(d.cle);
    if (r) fichiers.push(new File([await r.blob()], d.nom, { type: d.type }));
  }
  for (const cle of await cache.keys()) await cache.delete(cle);
  await creerNoteImportee({ titre, contenu: [texte, url].filter(Boolean).join("\n"), fichiers });
}

// ---------------------------------------------------------------------------
// Chantiers : liste et fiche en 4 étapes (notes → devis → envoi → facture)
// ---------------------------------------------------------------------------
async function etatsChantiers(chantiers) {
  const ids = chantiers.map((c) => c.document_id).filter(Boolean);
  const { data: docs } = ids.length
    ? await sb.from("documents").select("id, type, statut, numero, contenu, devis_id, updated_at, created_at, date_document").limit(1000)
    : { data: [] };
  const parId = new Map((docs ?? []).map((d) => [d.id, d]));
  const factureDe = new Map((docs ?? []).filter((d) => d.type === "facture" && d.devis_id).map((f) => [f.devis_id, f]));
  return (c) => {
    const devis = parId.get(c.document_id) ?? null;
    const facture = devis ? factureDe.get(devis.id) ?? null : null;
    let etape = 1;
    let libelle = "Notes en cours";
    if (devis) [etape, libelle] = [3, "Devis à envoyer"];
    if (devis && devis.statut === "envoye") [etape, libelle] = [3, "Devis envoyé · en attente"];
    if (devis && devis.statut === "refuse") [etape, libelle] = [3, "Devis refusé"];
    if (devis && devis.statut === "accepte") [etape, libelle] = [4, "Accepté · à facturer"];
    if (facture) [etape, libelle] = [4, facture.statut === "payee" ? "Payé ✓" : facture.statut === "emise" ? "Facture à encaisser" : "Facture à émettre"];
    const cle = !devis
      ? "notes"
      : facture
        ? { payee: "paye", emise: "a-encaisser" }[facture.statut] ?? "a-facturer"
        : { brouillon: "a-envoyer", envoye: "envoye", refuse: "refuse", accepte: "a-facturer" }[devis.statut] ?? "a-envoyer";
    return { devis, facture, etape, libelle, cle, fini: facture?.statut === "payee" };
  };
}

// Liste des chantiers : rangée par étape (ce qu'il y a à faire d'abord), avec filtres, tri et recherche.
const ETAPES_CHANTIER = [
  { id: "a-envoyer", nom: "Devis à envoyer", icone: "📤" },
  { id: "envoye", nom: "Devis envoyés", icone: "⏳" },
  { id: "a-facturer", nom: "Acceptés · à facturer", icone: "✅" },
  { id: "a-encaisser", nom: "Factures à encaisser", icone: "💶" },
  { id: "notes", nom: "Notes en cours (pas de devis)", icone: "🗒️" },
  { id: "paye", nom: "Payés", icone: "🏦" },
  { id: "refuse", nom: "Devis refusés", icone: "❌" },
];
const TRIS_CHANTIER = {
  etape: "Par étape",
  recent: "Activité récente",
  ancien: "Plus anciens d'abord",
  "date-devis": "Date du devis",
  montant: "Montant (du plus gros)",
  client: "Client (A → Z)",
};
let vueChantiers = { filtre: "tout", tri: "etape", recherche: "", ...local.lire("vue-chantiers", {}) };
if (!(vueChantiers.tri in TRIS_CHANTIER)) vueChantiers.tri = "etape";

async function afficherFiches() {
  const zone = $("#liste-fiches");
  if (!zone.innerHTML.trim()) zone.innerHTML = `<p class="aide">Chargement…</p>`;
  await fileChantiers;
  const { data, error } = await sb.from("chantiers").select("id, titre, document_id, note_id, updated_at, created_at").order("updated_at", { ascending: false }).limit(300);
  if (error) {
    zone.innerHTML = `<p class="aide">Impossible de charger les chantiers (connexion ?).</p>`;
    return;
  }
  if (!data.length) {
    $("#outils-chantiers").hidden = true;
    zone.innerHTML = `<div class="vide-clients"><p><strong>Aucun chantier pour l'instant.</strong></p><p class="aide">Appuie sur « ＋ Nouveau » : tu notes le chantier, l'IA fait le devis, tu l'envoies, puis tu factures.</p></div>`;
    return;
  }
  $("#outils-chantiers").hidden = false;
  const etat = await etatsChantiers(data);
  // Un devis = un seul chantier affiché (on garde le plus ancien, s'il y a eu un doublon).
  const vus = new Set();
  const tous = [...data]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .filter((c) => !c.document_id || (!vus.has(c.document_id) && vus.add(c.document_id)))
    .map((c) => ({ c, e: etat(c) }));
  rendreChantiers(tous);
}

function rendreChantiers(tous) {
  const zone = $("#liste-fiches");
  local.ecrire("vue-chantiers", { filtre: vueChantiers.filtre, tri: vueChantiers.tri });
  const client = (x) => x.e.devis?.contenu.client_nom || x.e.facture?.contenu.client_nom || "";
  const cherche = normaliser(vueChantiers.recherche);
  const trouves = tous.filter((x) => !cherche || normaliser(`${x.c.titre} ${client(x)} ${x.e.devis?.numero ?? ""} ${x.e.facture?.numero ?? ""}`).includes(cherche));
  const compte = (id) => trouves.filter((x) => x.e.cle === id).length;
  const puces = [{ id: "tout", nom: "Tous", icone: "" }, ...ETAPES_CHANTIER]
    .map((f) => {
      const n = f.id === "tout" ? trouves.length : compte(f.id);
      if (f.id !== "tout" && !n && vueChantiers.filtre !== f.id) return "";
      return `<button type="button" class="puce ${vueChantiers.filtre === f.id ? "choisie" : ""}" data-filtre-chantier="${f.id}">${f.icone} ${esc(f.id === "tout" ? f.nom : f.nom.replace(/ \(.*\)/, ""))} <b>${n}</b></button>`;
    })
    .join("");
  $("#filtres-chantiers").innerHTML = puces;
  $("#tri-chantiers").value = vueChantiers.tri;

  const liste = trouves.filter((x) => vueChantiers.filtre === "tout" || x.e.cle === vueChantiers.filtre);
  const dateDevis = (x) => new Date(x.e.devis?.date_document ?? x.c.created_at ?? x.c.updated_at).getTime();
  const activite = (x) => Math.max(...[x.c.updated_at, x.e.devis?.updated_at, x.e.facture?.updated_at].filter(Boolean).map((t) => new Date(t).getTime()));
  const tri = {
    recent: (a, b) => activite(b) - activite(a),
    etape: (a, b) => activite(b) - activite(a),
    ancien: (a, b) => activite(a) - activite(b),
    "date-devis": (a, b) => dateDevis(b) - dateDevis(a),
    montant: (a, b) => (b.e.devis ? montantDoc(b.e.devis) : 0) - (a.e.devis ? montantDoc(a.e.devis) : 0),
    client: (a, b) => (client(a) || a.c.titre || "").localeCompare(client(b) || b.c.titre || "", "fr"),
  }[vueChantiers.tri];
  liste.sort(tri);

  // Date de ce qui s'est passé à cette étape (envoi, acceptation, facture…), pas la dernière retouche du chantier.
  const quand = ({ c, e }) => {
    const d = e.devis;
    const f = e.facture;
    if (e.cle === "paye") return ["Payé", dateSuivi(f, "payee") || f.updated_at];
    if (e.cle === "a-encaisser") return ["Facture émise", f.date_document];
    if (e.cle === "a-facturer") return ["Accepté", dateSuivi(d, "accepte") || d.updated_at];
    if (e.cle === "envoye") return ["Envoyé", dateSuivi(d, "envoye") || d.updated_at];
    if (e.cle === "refuse") return ["Refusé", dateSuivi(d, "refuse") || d.updated_at];
    if (e.cle === "a-envoyer") return ["Devis fait", d.created_at];
    return ["Modifié", c.updated_at];
  };
  const carte = ({ c, e }) => {
    const [quoi, date] = quand({ c, e });
    const nomClient = e.devis?.contenu.client_nom;
    const docs = [e.devis && `Devis ${e.devis.numero} du ${dateFr(e.devis.date_document)}`, e.facture?.numero && `Facture ${e.facture.numero}`].filter(Boolean).join(" · ");
    return `<div class="glisse"><span class="fond-glisse fond-raccourcis" aria-hidden="true">⚡ Raccourcis</span><span class="fond-glisse fond-supprimer" aria-hidden="true">Supprimer 🗑️</span><button type="button" class="carte-fiche ${e.fini ? "fini" : ""}" data-fiche="${esc(c.id)}">
        <span class="ligne-fiche"><strong>${esc(c.titre || "Chantier sans titre")}</strong><b>${e.devis ? euros(montantDoc(e.devis)) : ""}</b></span>
        ${nomClient && !(c.titre || "").includes(nomClient) ? `<span class="client-fiche">👤 ${esc(nomClient)}</span>` : ""}
        <span class="progression-fiche">${[1, 2, 3, 4].map((n) => `<i class="${e.fini || n < e.etape ? "fait" : n === e.etape ? "en-cours" : ""}"></i>`).join("")}</span>
        <small>${esc(e.libelle)} · ${esc(quoi.toLowerCase())} ${ilYa(date)}${docs ? `<br>${esc(docs)}` : ""}</small>
      </button></div>`;
  };

  if (!liste.length) zone.innerHTML = `<p class="aide">Aucun chantier ne correspond.</p>`;
  else if (vueChantiers.tri === "etape" && vueChantiers.filtre === "tout") {
    zone.innerHTML = ETAPES_CHANTIER.map((g) => {
      const l = liste.filter((x) => x.e.cle === g.id);
      if (!l.length) return "";
      const total = l.reduce((t, x) => t + (x.e.devis ? montantDoc(x.e.devis) : 0), 0);
      return `<h3 class="groupe-chantiers">${g.icone} ${esc(g.nom)} <span>${l.length}${total ? ` · ${euros(total)}` : ""}</span></h3>${l.map(carte).join("")}`;
    }).join("");
  } else zone.innerHTML = liste.map(carte).join("");

  for (const b of zone.querySelectorAll("[data-fiche]")) {
    const x = tous.find((t) => t.c.id === b.dataset.fiche);
    b.onclick = () => ouvrirFiche(b.dataset.fiche);
    activerGlissement(b, { gauche: () => supprimerChantierListe(x), droite: () => raccourcisChantier(x) });
  }
  for (const b of $("#filtres-chantiers").querySelectorAll("[data-filtre-chantier]")) {
    b.onclick = () => {
      vueChantiers.filtre = b.dataset.filtreChantier;
      rendreChantiers(tous);
    };
  }
  $("#tri-chantiers").onchange = (ev) => {
    vueChantiers.tri = ev.target.value;
    rendreChantiers(tous);
  };
  $("#recherche-chantiers").oninput = (ev) => {
    vueChantiers.recherche = ev.target.value;
    rendreChantiers(tous);
    $("#recherche-chantiers").focus();
  };
}

// Glisser une carte du doigt : vers la gauche → supprimer, vers la droite → raccourcis.
function activerGlissement(carte, { gauche, droite }) {
  const conteneur = carte.parentElement;
  let depart = null;
  let dx = 0;
  let horizontal = null;
  let glisseA = 0;
  carte.addEventListener("click", (ev) => {
    if (Date.now() - glisseA < 500) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  }, { capture: true });
  const seuil = () => Math.min(120, carte.offsetWidth * 0.3);
  const remettre = () => {
    carte.style.transition = "transform .2s";
    carte.style.transform = "";
    conteneur.classList.remove("vers-gauche", "vers-droite", "pret");
  };
  carte.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    depart = [ev.clientX, ev.clientY];
    dx = 0;
    horizontal = null;
    carte.style.transition = "none";
  });
  carte.addEventListener("pointermove", (ev) => {
    if (!depart) return;
    const ddx = ev.clientX - depart[0];
    const ddy = ev.clientY - depart[1];
    if (horizontal === null && Math.hypot(ddx, ddy) > 10) {
      horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.3;
      if (horizontal) carte.setPointerCapture(ev.pointerId);
    }
    if (!horizontal) return;
    dx = ddx;
    carte.style.transform = `translateX(${dx}px)`;
    conteneur.classList.toggle("vers-gauche", dx < 0);
    conteneur.classList.toggle("vers-droite", dx > 0);
    conteneur.classList.toggle("pret", Math.abs(dx) > seuil());
  });
  const fin = () => {
    if (!depart) return;
    const action = horizontal && Math.abs(dx) > seuil() ? (dx < 0 ? gauche : droite) : null;
    if (horizontal) glisseA = Date.now(); // pas d'ouverture du chantier juste après un glissement
    depart = null;
    remettre();
    if (action) action();
  };
  carte.addEventListener("pointerup", fin);
  carte.addEventListener("pointercancel", () => {
    depart = null;
    remettre();
  });
}

// Suppression depuis la liste : le chantier et son devis (une facture émise ne se supprime jamais).
async function supprimerChantierListe({ c, e }) {
  const f = e.facture;
  if (f && f.statut !== "brouillon") {
    return demander(`Impossible de supprimer : la facture ${f.numero} est émise. La loi interdit de supprimer une facture ; pour l'annuler, ouvre-la et fais un avoir.`, { ok: "Compris" });
  }
  const d = e.devis;
  const quoi = d ? `le devis ${d.numero || "brouillon"}${f ? " et la facture brouillon" : ""} (« ${c.titre || "sans titre"} »)` : `le chantier « ${c.titre || "sans titre"} »`;
  const signe = d?.statut === "accepte" ? " Attention : ce devis a été accepté par le client." : "";
  if (!(await demander(`Supprimer définitivement ${quoi} ?${signe}`, { ok: "Supprimer", danger: true }))) return;
  for (const doc of [f, d].filter(Boolean)) {
    const { error } = await sb.from("documents").delete().eq("id", doc.id);
    if (error) return erreur("Suppression impossible.", error);
    if (conversation.docId === doc.id) {
      conversation.docId = null;
      sauverConversation();
    }
  }
  const { error } = await sb.from("chantiers").delete().eq("id", c.id);
  if (error) return erreur("Suppression impossible.", error);
  if (conversation.id === c.id) nouvelleConversation();
  notifier("Supprimé.");
  afficherFiches();
}

// Raccourcis d'un chantier (glisser vers la droite).
function raccourcisChantier({ c, e }) {
  const d = e.devis;
  const f = e.facture;
  const actions = [
    ["🗒️ Ouvrir le chantier", () => ouvrirFiche(c.id)],
    d && ["📝 Voir le devis", () => ouvrirDocument(d.id)],
    d && ["brouillon", "envoye"].includes(d.statut) && ["📤 Envoyer le devis", async () => (await ouvrirDocument(d.id), $("#partager").click())],
    d && !f && ["envoye", "accepte"].includes(d.statut) && ["🧾 Faire la facture", async () => (await ouvrirDocument(d.id), $("#en-facture").click())],
    f && ["💶 Voir la facture", () => ouvrirDocument(f.id)],
    f?.statut === "emise" && ["✅ Enregistrer un paiement", async () => (await ouvrirDocument(f.id), $("#payee").click())],
    d?.contenu.client_telephone && ["📞 Appeler le client", () => (location.href = `tel:${d.contenu.client_telephone.replace(/[^\d+]/g, "")}`)],
  ].filter(Boolean);
  const fond = document.createElement("div");
  fond.className = "dialogue-fond";
  fond.innerHTML = `<div class="dialogue raccourcis-chantier"><h3></h3>${actions.map((a, i) => `<button type="button" class="btn-secondaire" data-i="${i}">${a[0]}</button>`).join("")}<button type="button" class="annuler lien">Fermer</button></div>`;
  fond.querySelector("h3").textContent = c.titre || "Chantier";
  const fermer = () => fond.remove();
  fond.onclick = (ev) => {
    if (ev.target === fond) fermer();
  };
  fond.querySelector(".annuler").onclick = fermer;
  for (const b of fond.querySelectorAll("[data-i]")) {
    b.onclick = () => {
      fermer();
      actions[Number(b.dataset.i)][1]();
    };
  }
  document.body.appendChild(fond);
}

function demanderTexte(titre, placeholder, valeur = "") {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<form class="dialogue fiche-client"><h3></h3><input maxlength="200" required><div class="dialogue-actions"><button type="button" class="annuler">Annuler</button><button class="valider btn-principal">OK</button></div></form>`;
    fond.querySelector("h3").textContent = titre;
    const champ = fond.querySelector("input");
    champ.placeholder = placeholder;
    champ.value = valeur;
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      fermer(champ.value.trim() || null);
    };
    document.body.appendChild(fond);
    champ.focus();
  });
}

// Nouveau chantier : un nom (souvent le client), puis directement la note pour écrire.
async function nouveauChantier(client = null) {
  const titre = client ? client.nom : await demanderTexte("Nouveau chantier", "Ex. : Flora – peinture séjour");
  if (!titre) return;
  // Les coordonnées du client ne sont pas recopiées dans la note : le chantier est lié à sa fiche.
  const { data: note, error } = await sb.from("notes").insert({ titre: titre.slice(0, 200), contenu: "" }).select("*").single();
  if (error) return erreur("Chantier non créé (connexion ?).", error);
  const { data: ch, error: err2 } = await sb.from("chantiers").insert({ titre: titre.slice(0, 200), note_id: note.id, historique: [], ...(client ? { client_id: client.id } : {}) }).select("*").single();
  if (err2) return erreur("Chantier non créé (connexion ?).", err2);
  ficheCourante = ch.id;
  afficherEditeurNote(note);
  $("#contenu-note").focus();
  notifier("Écris tes notes et ajoute tes photos, puis « Faire le devis avec l'IA ».");
}
$("#nouveau-chantier").onclick = () => nouveauChantier();

let ficheDonnees = null;

async function ouvrirFiche(id) {
  await fileChantiers;
  const { data: ch, error } = await sb.from("chantiers").select("*").eq("id", id).maybeSingle();
  if (error || !ch) return erreur("Chantier introuvable.", error);
  const [note, devis] = await Promise.all([
    ch.note_id ? sb.from("notes").select("*").eq("id", ch.note_id).maybeSingle().then((r) => r.data) : null,
    ch.document_id ? sb.from("documents").select("*").eq("id", ch.document_id).maybeSingle().then((r) => r.data) : null,
  ]);
  let facture = null;
  if (devis) {
    const { data: f } = await sb.from("documents").select("*").eq("devis_id", devis.id).eq("type", "facture").limit(1);
    facture = f?.[0] ?? null;
  }
  ficheDonnees = { ch, note, devis, facture };
  afficherVue("fiche");
  ficheCourante = ch.id;
  rendreFiche();
  $("#rdv-fiche").innerHTML = "";
  afficherRdvFiche(ch).catch(console.error);
}

function rendreFiche() {
  const { ch, note, devis, facture } = ficheDonnees;
  $("#titre-fiche").textContent = ch.titre || "Chantier sans titre";
  $("#client-fiche").textContent = devis?.contenu.client_nom || "";
  $("#vue-fiche .menu-plus").open = false;
  const nbPhotos = note?.photos?.length ?? 0;
  const extrait = (note?.contenu ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" · ");
  const s1 = !!(note && (note.contenu.trim() || nbPhotos));
  const envoye = devis && ["envoye", "accepte", "refuse"].includes(devis.statut);
  const accepte = devis?.statut === "accepte";
  const paye = facture?.statut === "payee";
  const etat = (fait, encours) => (fait ? "fait" : encours ? "en-cours" : "a-venir");
  const bouton = (a, texte, principal = false, actif = true) =>
    `<button type="button" class="action-doc ${principal ? "principal" : ""}" data-a="${a}" ${actif ? "" : "disabled"}>${texte}</button>`;
  const etapes = [
    {
      n: 1, titre: "Notes et photos", etat: etat(s1, !s1),
      detail: s1 ? `${esc(extrait.slice(0, 100))}${nbPhotos ? ` · 📷 ${nbPhotos}` : ""}` : "Décris le chantier : pièces, surfaces, travaux, photos.",
      actions: bouton("note", s1 ? "Ouvrir mes notes" : "✍️ Écrire mes notes", !s1),
    },
    {
      n: 2, titre: "Devis", etat: etat(!!devis, s1 && !devis),
      detail: devis ? `${esc(devis.numero || "brouillon")} · <strong>${euros(montantDoc(devis))}</strong>` : "L'IA rédige le devis à partir de tes notes.",
      actions: devis ? bouton("devis", "Voir / modifier") + bouton("ia", "💬 Modif par l'IA") : bouton("faire-devis", "🤖 Faire le devis avec l'IA", s1, s1),
    },
    {
      n: 3, titre: "Envoi au client", etat: etat(accepte || !!facture, !!devis && !accepte),
      detail: !devis ? "Après le devis." : devis.statut === "brouillon" ? "Pas encore envoyé." : devis.statut === "envoye" ? `Envoyé ${ilYa(dateSuivi(devis, "envoye") || devis.updated_at)} · en attente de réponse` : accepte ? "Accepté par le client 🎉" : "Refusé par le client",
      actions: !devis ? "" : devis.statut === "brouillon" ? bouton("envoyer", "📤 Envoyer", true) + bouton("statut-envoye", "Déjà envoyé")
        : devis.statut === "envoye" ? bouton("statut-accepte", "✅ Accepté", true) + bouton("statut-refuse", "❌ Refusé")
        : devis.statut === "refuse" ? bouton("statut-envoye", "↩️ Remettre en attente") : "",
    },
    {
      n: 4, titre: "Facture", etat: etat(paye, accepte && !paye),
      detail: facture ? `${esc(facture.numero || "brouillon")} · ${LIBELLES_STATUT[facture.statut]} · <strong>${euros(montantDoc(facture))}</strong>` : accepte ? "Devis accepté : tu peux facturer." : "Une fois le devis accepté.",
      actions: facture
        ? bouton("facture", facture.statut === "brouillon" ? "Vérifier et émettre" : "Voir la facture", facture.statut === "brouillon") + (facture.statut === "emise" ? bouton("payee", "💶 Payée", true) : "")
        : accepte ? bouton("facturer", "🧾 Créer la facture", true) : "",
    },
  ];
  $("#etapes-fiche").innerHTML = etapes
    .map((e) => `<li class="etape ${e.etat}"><span class="pastille-etape">${e.etat === "fait" ? "✓" : e.n}</span>
      <div class="corps-etape"><strong>${e.titre}</strong><p>${e.detail}</p>${e.actions ? `<div class="actions-doc">${e.actions}</div>` : ""}</div></li>`)
    .join("");
  const suivante = !s1 ? ["✍️ Écrire mes notes", "note"]
    : !devis ? ["🤖 Faire le devis avec l'IA", "faire-devis"]
    : devis.statut === "brouillon" ? ["📤 Envoyer le devis", "envoyer"]
    : devis.statut === "envoye" ? ["✅ Le client a accepté", "statut-accepte"]
    : accepte && !facture ? ["🧾 Créer la facture", "facturer"]
    : facture?.statut === "brouillon" ? ["✅ Vérifier et émettre la facture", "facture"]
    : facture?.statut === "emise" ? ["💶 Marquer la facture payée", "payee"]
    : null;
  const gros = $("#etape-suivante");
  gros.hidden = !suivante;
  if (suivante) {
    gros.textContent = suivante[0];
    gros.dataset.a = suivante[1];
  }
}

async function actionFiche(a) {
  const { ch, note, devis, facture } = ficheDonnees;
  ficheCourante = ch.id;
  if (a === "note") {
    if (note) return afficherEditeurNote(note);
    const { data, error } = await sb.from("notes").insert({ titre: ch.titre, contenu: "" }).select("*").single();
    if (error) return erreur("Note non créée.", error);
    await sb.from("chantiers").update({ note_id: data.id }).eq("id", ch.id);
    return afficherEditeurNote(data);
  }
  if (a === "faire-devis") {
    afficherEditeurNote(note);
    return $("#envoyer-note").click();
  }
  if (a === "ia") {
    ouvrirConversation(ch);
    montrerListeChantiers(false);
    afficherVue("chantier");
    ficheCourante = ch.id;
    return $("#texte").focus();
  }
  if (a === "devis") return ouvrirDocument(devis.id);
  if (a === "facture") return ouvrirDocument(facture.id);
  if (a === "envoyer") {
    await ouvrirDocument(devis.id);
    return $("#partager").click();
  }
  if (a === "facturer") {
    await ouvrirDocument(devis.id);
    return $("#en-facture").click();
  }
  if (a === "payee") {
    if (!(await demander(`Marquer ${facture.numero} comme payée (${euros(montantDoc(facture))}) ?`, { ok: "Payée 💶" }))) return;
    if (await mettreStatut(facture, "payee")) notifier("Facture payée 💶");
    return ouvrirFiche(ch.id);
  }
  if (a.startsWith("statut-")) {
    const statut = a.slice(7);
    if (await mettreStatut(devis, statut)) notifier({ accepte: "Devis accepté 🎉", refuse: "Devis marqué refusé", envoye: "Marqué comme envoyé" }[statut]);
    return ouvrirFiche(ch.id);
  }
}

$("#etapes-fiche").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-a]");
  if (b && !b.disabled) actionFiche(b.dataset.a);
});
$("#etape-suivante").onclick = (ev) => actionFiche(ev.currentTarget.dataset.a);
$("#retour-fiche").onclick = () => afficherVue("chantiers");
$("#retour-conversation").onclick = () => (conversation.id ? ouvrirFiche(conversation.id) : afficherVue("chantiers"));
$("#discuter-fiche").onclick = () => actionFiche("ia");
$("#renommer-fiche").onclick = async () => {
  const { ch } = ficheDonnees;
  const titre = await demanderTexte("Renommer le chantier", "Nom du chantier", ch.titre);
  if (!titre) return;
  const { error } = await sb.from("chantiers").update({ titre: titre.slice(0, 200) }).eq("id", ch.id);
  if (error) return erreur("Nom non modifié.", error);
  if (conversation.id === ch.id) conversation.titre = titre;
  ouvrirFiche(ch.id);
};
$("#supprimer-fiche").onclick = async () => {
  const { ch } = ficheDonnees;
  if (!(await demander("Supprimer ce chantier ? La conversation avec l'IA est effacée ; le devis, la facture et les notes restent enregistrés.", { ok: "Supprimer", danger: true }))) return;
  const { error } = await sb.from("chantiers").delete().eq("id", ch.id);
  if (error) return erreur("Suppression impossible.", error);
  if (conversation.id === ch.id) nouvelleConversation();
  afficherVue("chantiers");
};

// Choix de l'unité d'une ligne du devis (forfait, m², ml…).
// Taux de TVA d'une ligne (bâtiment : 20 %, 10 % rénovation, 5,5 % rénovation énergétique, 0 %).
const TAUX_TVA = [
  [20, "20 % – neuf, logement de moins de 2 ans, locaux professionnels"],
  [10, "10 % – rénovation, entretien d'un logement de plus de 2 ans"],
  [5.5, "5,5 % – rénovation énergétique (isolation, chauffage…) d'un logement de plus de 2 ans"],
  [0, "0 % – exonéré"],
];
function choisirTauxTva(ligne, devis) {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    const actuel = tauxLigne(ligne, devis);
    fond.innerHTML = `<div class="dialogue choix-unites" role="dialog" aria-modal="true">
      <h3>TVA de la ligne</h3>
      <p class="aide"></p>
      <div class="liste-taux">${TAUX_TVA.map(([t, nom]) => `<button type="button" class="puce ${t === actuel ? "choisie" : ""}" data-t="${t}">${esc(nom)}</button>`).join("")}</div>
      <p class="aide">Le taux du devis est ${nombre(devis.taux_tva)} % : les lignes sans taux particulier le suivent.</p>
      <div class="dialogue-actions"><button type="button" class="annuler">Annuler</button><button type="button" class="valider">Comme le devis (${nombre(devis.taux_tva)} %)</button></div>
    </div>`;
    fond.querySelector(".aide").textContent = `« ${ligne.designation} »`;
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    for (const b of fond.querySelectorAll("[data-t]")) b.onclick = () => fermer(Number(b.dataset.t));
    fond.querySelector(".annuler").onclick = () => fermer(undefined);
    fond.querySelector(".valider").onclick = () => fermer(null);
    fond.onclick = (e) => {
      if (e.target === fond) fermer(undefined);
    };
    document.body.appendChild(fond);
  });
}

function choisirUnite(ligne) {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<div class="dialogue choix-unites" role="dialog" aria-modal="true">
      <h3>Unité</h3>
      <p class="aide"></p>
      <div class="grille-unites">${[...new Set([...UNITES, ligne.unite])]
        .map((u) => `<button type="button" class="puce ${u === ligne.unite ? "choisie" : ""}" data-u="${esc(u)}">${esc(u)}</button>`)
        .join("")}</div>
      <label class="unite-libre">Autre <input maxlength="20" placeholder="ex : lot, pièce"></label>
      <div class="dialogue-actions"><button type="button" class="annuler">Annuler</button><button type="button" class="valider btn-principal">OK</button></div>
    </div>`;
    fond.querySelector(".aide").textContent = `« ${ligne.designation} » · ${nombre(ligne.quantite)} ${ligne.unite} × ${euros(ligne.prix_unitaire_ht)}. En forfait, le montant total reste le même.`;
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    for (const b of fond.querySelectorAll("[data-u]")) b.onclick = () => fermer(b.dataset.u);
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.querySelector(".valider").onclick = () => fermer(fond.querySelector(".unite-libre input").value.trim() || null);
    fond.onclick = (e) => {
      if (e.target === fond) fermer(null);
    };
    document.body.appendChild(fond);
  });
}

// ---------------------------------------------------------------------------
// Carnet de clients
// ---------------------------------------------------------------------------
let clients = null; // chargés à la demande
const telValide = (t) => /^[+\d][\d\s.()-]{5,}$/.test(String(t ?? "").trim());

async function clientParId(id) {
  if (!id) return null;
  try {
    if (!clients) await chargerClients();
  } catch {
    return null;
  }
  return clients.find((c) => c.id === id) ?? null;
}

async function chargerClients() {
  const { data, error } = await sb.from("clients").select("*").order("nom").limit(2000);
  if (error) throw error;
  clients = data;
  return clients;
}

// Retrouve un client du carnet : même e-mail, sinon même nom.
function trouverClient({ nom, email }) {
  if (!clients) return null;
  const e = normaliser(email);
  const n = normaliser(nom);
  return (e && clients.find((c) => normaliser(c.email) === e)) || (n && clients.find((c) => normaliser(c.nom) === n)) || null;
}

// Devis de l'IA pour un client connu : on complète ses coordonnées depuis le carnet.
async function completerDepuisCarnet(devis) {
  if (!devis.client_nom && !devis.client_email) return;
  try {
    if (!clients) await chargerClients();
  } catch {
    return;
  }
  const c = trouverClient({ nom: devis.client_nom, email: devis.client_email });
  if (!c) return;
  devis.client_adresse ||= c.adresse;
  devis.client_email ||= c.email;
  devis.client_telephone ||= c.telephone;
}

// Ajoute (ou complète) le client d'un devis dans le carnet, sans bloquer l'appli.
async function memoriserClient(v) {
  const nom = (v.client_nom ?? "").trim();
  if (!nom) return;
  try {
    if (!clients) await chargerClients();
    const fiche = {
      nom: nom.slice(0, 200),
      adresse: (v.client_adresse ?? "").trim().slice(0, 500),
      email: (v.client_email ?? "").trim().slice(0, 200),
      telephone: (v.client_telephone ?? "").trim().slice(0, 40),
    };
    const existant = trouverClient(fiche);
    if (!existant) {
      const { data, error } = await sb.from("clients").insert(fiche).select("*").single();
      if (!error) clients.push(data);
      return;
    }
    const manquants = Object.fromEntries(Object.entries(fiche).filter(([k, val]) => val && !existant[k]));
    if (!Object.keys(manquants).length) return;
    const { data, error } = await sb.from("clients").update(manquants).eq("id", existant.id).select("*").single();
    if (!error) clients = clients.map((c) => (c.id === data.id ? data : c));
  } catch (err) {
    console.warn("[clients]", err);
  }
}

let rechercheClients = "";

async function afficherClients() {
  const zone = $("#liste-clients");
  $("#contact-telephone").hidden = !("contacts" in navigator && "select" in navigator.contacts);
  if (!clients) zone.innerHTML = `<p class="aide">Chargement…</p>`;
  let docs = [];
  try {
    const [, res] = await Promise.all([chargerClients(), sb.from("documents").select("type, statut, contenu").limit(1000)]);
    docs = res.data ?? [];
  } catch (err) {
    zone.innerHTML = `<p class="aide">Impossible de charger les clients (connexion ?).</p>`;
    console.warn(err);
    return;
  }
  const stats = (c) => {
    const siens = docs.filter((d) => {
      const v = d.contenu ?? {};
      return (c.email && normaliser(v.client_email) === normaliser(c.email)) || normaliser(v.client_nom) === normaliser(c.nom);
    });
    const devis = siens.filter((d) => d.type === "devis");
    const payees = siens.filter((d) => d.type === "facture" && d.statut === "payee");
    return { devis: devis.length, acceptes: devis.filter((d) => d.statut === "accepte").length, encaisse: payees.reduce((t, d) => t + montantDoc(d), 0) };
  };
  const filtre = normaliser(rechercheClients);
  const liste = clients.filter((c) => !filtre || [c.nom, c.telephone, c.email, c.adresse].some((x) => normaliser(x).includes(filtre)));
  zone.innerHTML = !clients.length
    ? `<div class="vide-clients"><p><strong>Ton carnet de clients est vide.</strong></p><p class="aide">Ajoute un client avec « + Client ». Les clients de tes devis s'y ajoutent aussi tout seuls.</p></div>`
    : liste.length
      ? `<p class="aide">${clients.length} client${clients.length > 1 ? "s" : ""}</p>` +
        liste
          .map((c) => {
            const st = stats(c);
            const carte = encodeURIComponent(c.adresse.replace(/\n/g, " "));
            return `<div class="carte-client" data-client="${esc(c.id)}">
          <div class="client-entete"><span class="avatar">${esc((c.nom.trim()[0] || "?").toUpperCase())}</span>
            <div><strong>${esc(c.nom || "Sans nom")}</strong>
            <small>${st.devis ? `${st.devis} devis${st.acceptes ? ` · ${st.acceptes} accepté${st.acceptes > 1 ? "s" : ""}` : ""}${st.encaisse ? ` · ${euros(st.encaisse)} encaissés` : ""}` : "Pas encore de devis"}</small></div></div>
          <div class="client-coordonnees">
            ${c.telephone ? `<a href="tel:${esc(c.telephone.replace(/[^\d+]/g, ""))}">📞 ${esc(c.telephone)}</a>` : ""}
            ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ""}
            ${c.adresse ? `<a href="https://www.google.com/maps/search/?api=1&query=${carte}" target="_blank" rel="noopener">📍 ${esc(c.adresse).replace(/\n/g, ", ")}</a>` : ""}
            ${c.notes ? `<p class="client-notes">${esc(c.notes)}</p>` : ""}
          </div>
          <div class="actions-doc">
            <button type="button" class="action-doc principal" data-devis-client="${esc(c.id)}">🏗️ Nouveau chantier</button>
            <button type="button" class="action-doc" data-modifier-client="${esc(c.id)}">✏️ Modifier</button>
          </div>
        </div>`;
          })
          .join("")
      : `<p class="aide">Aucun client ne correspond à « ${esc(rechercheClients)} ».</p>`;

  for (const b of zone.querySelectorAll("[data-modifier-client]")) {
    b.onclick = () => editerClient(clients.find((c) => c.id === b.dataset.modifierClient));
  }
  for (const b of zone.querySelectorAll("[data-devis-client]")) {
    b.onclick = () => {
      return nouveauChantier(clients.find((x) => x.id === b.dataset.devisClient));
    };
  }
}

$("#recherche-clients").oninput = (e) => {
  rechercheClients = e.target.value;
  afficherClients();
};
$("#nouveau-client").onclick = () => editerClient(null);

// Fiche client (création / modification) dans une fenêtre.
function editerClient(client, valeurs = {}) {
  return new Promise((resolve) => {
    const c = { nom: "", telephone: "", email: "", adresse: "", notes: "", ...(client ?? {}), ...valeurs };
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<form class="dialogue fiche-client" role="dialog" aria-modal="true">
      <h3>${client ? "Modifier le client" : "Nouveau client"}</h3>
      <label>Nom <input name="nom" maxlength="200" required autocomplete="name"></label>
      <label>Téléphone <input name="telephone" type="tel" maxlength="40" autocomplete="tel" inputmode="tel"></label>
      <label>E-mail <input name="email" type="email" maxlength="200" autocomplete="email" inputmode="email"></label>
      <label>Adresse postale <textarea name="adresse" rows="2" maxlength="500" autocomplete="street-address"></textarea></label>
      <label>Notes (code d'accès, étage, préférences…) <textarea name="notes" rows="2" maxlength="2000"></textarea></label>
      <div class="dialogue-actions">
        ${client ? `<button type="button" class="supprimer-client danger-texte">Supprimer</button>` : ""}
        <button type="button" class="annuler">Annuler</button>
        <button type="submit" class="valider btn-principal">Enregistrer</button>
      </div></form>`;
    const form = fond.querySelector("form");
    for (const k of ["nom", "telephone", "email", "adresse", "notes"]) form.elements[k].value = c[k] ?? "";
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.querySelector(".supprimer-client")?.addEventListener("click", async () => {
      if (!(await demander(`Supprimer ${client.nom} du carnet ? (ses devis restent enregistrés)`, { ok: "Supprimer", danger: true }))) return;
      const { error } = await sb.from("clients").delete().eq("id", client.id);
      if (error) return erreur("Suppression impossible.", error);
      clients = clients.filter((x) => x.id !== client.id);
      fermer(null);
      afficherClients();
    });
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fiche = Object.fromEntries(["nom", "telephone", "email", "adresse", "notes"].map((k) => [k, form.elements[k].value.trim()]));
      if (fiche.email && !emailValide(fiche.email)) return notifier("Adresse e-mail incorrecte.", "erreur");
      if (fiche.telephone && !telValide(fiche.telephone)) return notifier("Numéro de téléphone incorrect.", "erreur");
      const requete = client ? sb.from("clients").update(fiche).eq("id", client.id) : sb.from("clients").insert(fiche);
      const { data, error } = await requete.select("*").single();
      if (error) return erreur("Client non enregistré.", error);
      clients = client ? clients.map((x) => (x.id === data.id ? data : x)) : [...(clients ?? []), data];
      clients.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
      notifier(client ? "Client mis à jour ✓" : "Client ajouté ✓");
      fermer(data);
      if (!$("#vue-clients").hidden) afficherClients();
    };
    document.body.appendChild(fond);
    if (!client) form.elements.nom.focus();
  });
}

// Contacts du téléphone (Android / Chrome) : on préremplit une fiche client.
$("#contact-telephone").onclick = async () => {
  try {
    const [contact] = await navigator.contacts.select(["name", "tel", "email", "address"], { multiple: false });
    if (!contact) return;
    const a = contact.address?.[0];
    const adresse = a ? [...(a.addressLine ?? []), [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join("\n") : "";
    editerClient(null, { nom: contact.name?.[0] ?? "", telephone: contact.tel?.[0] ?? "", email: contact.email?.[0] ?? "", adresse });
  } catch (err) {
    erreur("Impossible d'ouvrir les contacts.", err);
  }
};

// Choisir un client du carnet (pour un devis).
async function choisirClient() {
  try {
    await chargerClients();
  } catch (err) {
    erreur("Impossible de charger les clients.", err);
    return null;
  }
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<div class="dialogue choix-client" role="dialog" aria-modal="true">
      <h3>Choisir un client</h3>
      <input type="search" placeholder="🔍 Nom, téléphone…" class="recherche-choix">
      <div class="liste-choix"></div>
      <div class="dialogue-actions">
        <button type="button" class="nouveau">+ Nouveau client</button>
        <button type="button" class="annuler">Annuler</button>
      </div></div>`;
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    const rendre = () => {
      const f = normaliser(fond.querySelector(".recherche-choix").value);
      const l = clients.filter((c) => !f || [c.nom, c.telephone, c.email].some((x) => normaliser(x).includes(f)));
      fond.querySelector(".liste-choix").innerHTML = l.length
        ? l.map((c) => `<button type="button" data-id="${esc(c.id)}"><strong>${esc(c.nom)}</strong><small>${esc([c.telephone, c.email].filter(Boolean).join(" · "))}</small></button>`).join("")
        : `<p class="aide">Aucun client.</p>`;
      for (const b of fond.querySelectorAll(".liste-choix [data-id]")) b.onclick = () => fermer(clients.find((c) => c.id === b.dataset.id));
    };
    fond.querySelector(".recherche-choix").oninput = rendre;
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.querySelector(".nouveau").onclick = async () => {
      fond.remove();
      resolve(await editerClient(null));
    };
    document.body.appendChild(fond);
    rendre();
  });
}

// ---------------------------------------------------------------------------
// Liste des documents
// ---------------------------------------------------------------------------
const nomDoc = (d) => (d.type === "devis" ? "Devis" : d.contenu?.avoir ? "Avoir" : "Facture");
const LIBELLES_STATUT = {
  brouillon: "brouillon",
  envoye: "envoyé",
  accepte: "accepté",
  refuse: "refusé",
  emise: "émise",
  payee: "payée",
};

// Suivi : dates de changement de statut des devis (contenu.suivi) ; pour une facture,
// émise = date du document, payée = dernière modification (seul changement permis).
const dateSuivi = (d, statut) => d.contenu?.suivi?.[statut] ?? (["envoye", "accepte", "refuse", "payee"].includes(statut) && d.statut === statut ? d.updated_at : null);
const joursDepuis = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86_400_000));
const ilYa = (iso) => {
  const j = joursDepuis(iso);
  return j === 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} jours`;
};
const montantDoc = (d) => (profil.infos.franchise_tva ? d.contenu.total_ht : d.contenu.total_ttc) || 0;

const FILTRES_DOCS = [
  { id: "tout", nom: "Tous", test: () => true },
  { id: "a-envoyer", type: "devis", nom: "À envoyer", test: (d) => d.type === "devis" && d.statut === "brouillon" },
  { id: "envoye", type: "devis", nom: "En attente", test: (d) => d.type === "devis" && d.statut === "envoye" },
  { id: "accepte", type: "devis", nom: "Acceptés", test: (d) => d.type === "devis" && d.statut === "accepte" },
  { id: "refuse", type: "devis", nom: "Refusés", test: (d) => d.type === "devis" && d.statut === "refuse" },
  { id: "facture-brouillon", type: "facture", nom: "À émettre", test: (d) => d.type === "facture" && d.statut === "brouillon" },
  { id: "a-encaisser", type: "facture", nom: "À encaisser", test: (d) => d.type === "facture" && d.statut === "emise" },
  { id: "payee", type: "facture", nom: "Payées", test: (d) => d.type === "facture" && d.statut === "payee" },
];

// Les 4 indicateurs d'activité (accueil, Devis, Factures).
function indicateurs(docs) {
  const factureDe = new Map(docs.filter((d) => d.type === "facture" && d.devis_id).map((f) => [f.devis_id, f]));
  const somme = (liste) => liste.reduce((t, d) => t + montantDoc(d), 0);
  const par = Object.fromEntries(FILTRES_DOCS.map((f) => [f.id, docs.filter(f.test)]));
  const relances = par.envoye.filter((d) => joursDepuis(dateSuivi(d, "envoye") || d.updated_at) >= 7).length;
  const aFacturer = par.accepte.filter((d) => !factureDe.has(d.id)).length;
  const retard = par["a-encaisser"].filter((d) => joursDepuis(d.date_document) > Number(profil.infos.delai_paiement || 30)).length;
  const decides = par.accepte.length + par.refuse.length;
  const taux = decides ? Math.round((100 * par.accepte.length) / decides) : null;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  return {
    factureDe,
    par,
    tuiles: {
      envoye: { type: "devis", icone: "⏳", titre: "Devis en attente", valeur: euros(somme(par.envoye)), detail: `${pluriel(par.envoye.length, "devis").replace("deviss", "devis")}${relances ? ` · ${relances} à relancer` : ""}` },
      accepte: { type: "devis", icone: "✅", titre: "Devis acceptés", valeur: euros(somme(par.accepte)), detail: `${pluriel(par.accepte.length, "devis").replace("deviss", "devis")}${aFacturer ? ` · ${aFacturer} à facturer` : ""}${taux !== null ? ` · ${taux} %` : ""}` },
      "a-encaisser": { type: "facture", icone: "💶", titre: "À encaisser", valeur: euros(somme(par["a-encaisser"])), detail: `${pluriel(par["a-encaisser"].length, "facture")}${retard ? ` · ${retard} en retard` : ""}`, alerte: retard > 0 },
      payee: { type: "facture", icone: "🏦", titre: "Encaissé", valeur: euros(somme(par.payee)), detail: `${pluriel(par.payee.length, "facture")} payée${par.payee.length > 1 ? "s" : ""}` },
    },
  };
}

const htmlTuile = (id, t, actif = false) =>
  `<button type="button" class="tuile ${t.alerte ? "alerte" : ""} ${actif ? "actif" : ""}" data-filtre="${id}" data-type="${t.type}">
    <small>${t.icone} ${t.titre}</small><strong>${t.valeur}</strong><span>${t.detail}</span></button>`;

async function afficherListe() {
  const zone = $("#liste-documents");
  if (!zone.innerHTML.trim()) zone.innerHTML = `<p class="aide">Chargement…</p>`;
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, type, statut, numero, date_document, contenu, devis_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    zone.innerHTML = `<p class="aide">Impossible de charger les documents (connexion ?).</p>`;
    return;
  }
  if (!docs.length) {
    zone.innerHTML = `<p class="aide">Aucun document pour l'instant. Va dans « Chantier » pour créer ton premier devis.</p>`;
    return;
  }
  const { factureDe, par: parFiltre, tuiles } = indicateurs(docs);
  const filtres = FILTRES_DOCS.filter((f) => !f.type || f.type === typeDocs);
  if (!filtres.some((f) => f.id === filtreDocs)) filtreDocs = "tout";
  const liste = (parFiltre[filtreDocs] ?? docs).filter((d) => d.type === typeDocs);
  $("#titre-documents").textContent = typeDocs === "facture" ? "Factures" : "Devis";
  zone.innerHTML = `
    <div class="tuiles">${Object.entries(tuiles)
      .filter(([, t]) => t.type === typeDocs)
      .map(([id, t]) => htmlTuile(id, t, filtreDocs === id))
      .join("")}</div>
    <div class="filtres-docs">${filtres
      .filter((f) => f.id === "tout" || parFiltre[f.id].length)
      .map((f) => {
        const n = f.id === "tout" ? docs.filter((d) => d.type === typeDocs).length : parFiltre[f.id].length;
        return `<button type="button" class="puce ${filtreDocs === f.id ? "choisie" : ""}" data-filtre="${f.id}">${f.nom} <b>${n}</b></button>`;
      })
      .join("")}</div>
    ${liste.length ? liste.map((d) => carteDocument(d, factureDe)).join("") : `<p class="aide">${typeDocs === "facture" ? "Aucune facture ici. Une facture se crée depuis un devis accepté, ou avec « + Nouveau »." : "Aucun devis ici. Appuie sur « + Nouveau » pour en faire un."}</p>`}`;

  for (const b of zone.querySelectorAll("[data-filtre]")) {
    b.onclick = () => {
      filtreDocs = filtreDocs === b.dataset.filtre && b.classList.contains("tuile") ? "tout" : b.dataset.filtre;
      afficherListe();
    };
  }
  for (const el of zone.querySelectorAll(".element-liste")) el.onclick = () => ouvrirDocument(el.dataset.id);
  for (const b of zone.querySelectorAll("[data-action]")) {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const d = docs.find((x) => x.id === b.dataset.doc);
      const action = b.dataset.action;
      if (action === "ouvrir") return ouvrirDocument(d.id);
      if (action === "facturer") {
        await ouvrirDocument(d.id);
        return $("#en-facture").click();
      }
      if (action === "envoyer") {
        await ouvrirDocument(d.id);
        return $("#partager").click();
      }
      const ok = action === "payee" ? await enregistrerPaiement(d) : await mettreStatut(d, action);
      if (ok) {
        notifier({ accepte: "Devis accepté 🎉", refuse: "Devis marqué refusé", payee: "Facture payée 💶", envoye: "Marqué comme envoyé" }[action] ?? "Statut mis à jour");
        afficherListe();
      }
    };
  }
}

function carteDocument(d, factureDe) {
  const c = d.contenu;
  const action = (a, libelle, classe = "") => `<button type="button" class="action-doc ${classe}" data-action="${a}" data-doc="${esc(d.id)}">${libelle}</button>`;
  let etat = "";
  let actions = "";
  if (d.type === "devis") {
    if (d.statut === "brouillon") {
      etat = `Créé ${ilYa(d.created_at)}`;
      actions = action("envoyer", "📤 Envoyer", "principal") + action("envoye", "Déjà envoyé");
    } else if (d.statut === "envoye") {
      const quand = dateSuivi(d, "envoye") || d.updated_at;
      const relance = joursDepuis(quand) >= 7;
      etat = `Envoyé ${ilYa(quand)}${relance ? ` · <span class="a-relancer">⏰ à relancer</span>` : ""}`;
      actions = action("accepte", "✅ Accepté", "principal") + action("refuse", "❌ Refusé");
    } else if (d.statut === "accepte") {
      const f = factureDe.get(d.id);
      etat = `Accepté ${ilYa(dateSuivi(d, "accepte") || d.updated_at)}${f ? ` · facture ${esc(f.numero || "brouillon")}` : ""}`;
      actions = f ? action("ouvrir", "Voir le devis") : action("facturer", "🧾 Faire la facture", "principal") + action("envoye", "↩️ Pas encore accepté");
    } else if (d.statut === "refuse") {
      etat = `Refusé ${ilYa(dateSuivi(d, "refuse") || d.updated_at)}`;
      actions = action("envoye", "↩️ Remettre en attente");
    }
  } else if (d.statut === "brouillon") {
    etat = "Facture pas encore émise";
    actions = action("ouvrir", "Vérifier et émettre", "principal");
  } else if (d.statut === "emise") {
    const delai = Number(profil.infos.delai_paiement || 30);
    const echeance = ajouterJours(d.date_document, delai);
    const enRetard = joursDepuis(d.date_document) > delai;
    etat = `Émise ${ilYa(d.date_document)} · échéance ${dateFr(echeance)}${enRetard ? ` · <span class="a-relancer">⚠️ en retard</span>` : ""}`;
    actions = action("payee", "💶 Payée", "principal");
  } else {
    etat = `Payée ${ilYa(d.updated_at)}`;
  }
  return `<div class="element-liste carte-doc statut-${d.statut}" data-id="${esc(d.id)}">
    <div class="ligne-doc">
      <div><strong>${esc(c.client_nom || c.titre || "Sans titre")}</strong>
        <small>${esc(nomDoc(d))} ${esc(d.numero || "brouillon")}${c.client_nom ? ` · ${esc(c.titre)}` : ""}</small></div>
      <div class="droite"><strong>${euros(montantDoc(d))}</strong><br><span class="pastille ${d.type} statut-${d.statut}">${LIBELLES_STATUT[d.statut]}</span></div>
    </div>
    <div class="etat-doc">${etat}</div>
    ${actions ? `<div class="actions-doc">${actions}</div>` : ""}
  </div>`;
}

// Change le statut d'un document ; pour un devis, garde la date du changement (suivi).
async function mettreStatut(d, statut) {
  const maj = { statut };
  if (d.type === "devis") {
    const suivi = { ...(d.contenu.suivi ?? {}) };
    const ordre = ["brouillon", "envoye", "accepte", "refuse"];
    const retour = ordre.indexOf(statut) < ordre.indexOf(d.statut) || (d.statut === "refuse" && statut !== "refuse");
    if (retour) delete suivi[d.statut]; // étape annulée (ex. accepté par erreur)
    if (!(retour && suivi[statut])) suivi[statut] = new Date().toISOString(); // on garde la vraie date d'envoi
    delete suivi.brouillon;
    maj.contenu = { ...d.contenu, suivi };
  }
  const { data, error } = await sb.from("documents").update(maj).eq("id", d.id).select("*").single();
  if (error) {
    erreur("Statut non modifié.", error);
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Affichage et édition d'un devis / d'une facture
// ---------------------------------------------------------------------------
let docCourant = null;

async function ouvrirDocument(id) {
  const { data, error } = await sb.from("documents").select("*").eq("id", id).maybeSingle();
  if (error || !data) return erreur("Document introuvable.", error);
  docCourant = data;
  typeDocs = data.type;
  afficherVue("document");
  rendreDocument();
}

const estVerrouille = (d) => d.type === "facture" && d.statut !== "brouillon";

async function majDocument(modif) {
  const contenu = structuredClone(docCourant.contenu);
  modif(contenu);
  const avant = docCourant.contenu;
  if (["client_nom", "client_adresse", "client_email", "client_telephone"].some((k) => (contenu[k] ?? "") !== (avant[k] ?? ""))) memoriserClient(contenu);
  const recalcule = calculerTotaux(contenu);
  const { data, error } = await sb.from("documents").update({ contenu: recalcule }).eq("id", docCourant.id).select("*").single();
  if (error) {
    erreur("Modification non enregistrée.", error);
  } else docCourant = data;
  rendreDocument();
}

async function changerStatut(statut) {
  const data = await mettreStatut(docCourant, statut);
  if (!data) return;
  docCourant = data;
  rendreDocument();
}

// Personnalisation : logo (image enregistrée dans les infos de l'entreprise) et couleur.
const logoValide = (logo) => typeof logo === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo);
const couleurValide = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const COULEUR_DEFAUT = "#1f3b63";

function teinteClaire(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (c) => Math.round(c + (255 - c) * 0.88).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

function appliquerCouleur(el, couleur) {
  const c = couleurValide(couleur) ? couleur : COULEUR_DEFAUT;
  el.style.setProperty("--bleu", c);
  el.style.setProperty("--bleu-clair", teinteClaire(c));
}

// Prépare le logo : fond retiré, recadré au plus près, réduit (max 600 × 240 px),
// et couleur principale proposée pour les documents.
async function preparerLogo(fichier, { largeur = 600, hauteur = 240 } = {}) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("Image illisible"));
      i.src = url;
    });
    // Travail sur une copie de taille raisonnable
    const e1 = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const source = document.createElement("canvas");
    source.width = Math.max(1, Math.round(img.naturalWidth * e1));
    source.height = Math.max(1, Math.round(img.naturalHeight * e1));
    const sctx = source.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, source.width, source.height);
    const pixels = sctx.getImageData(0, 0, source.width, source.height);
    const cadre = nettoyerLogo(pixels);
    sctx.putImageData(pixels, 0, 0);
    const couleur = couleurDominante(pixels);

    const echelle = Math.min(1, largeur / cadre.w, hauteur / cadre.h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cadre.w * echelle));
    canvas.height = Math.max(1, Math.round(cadre.h * echelle));
    canvas.getContext("2d").drawImage(source, cadre.x, cadre.y, cadre.w, cadre.h, 0, 0, canvas.width, canvas.height);
    return { donnees: canvas.toDataURL("image/png"), couleur };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Montants affichés et mentions légales d'un devis / d'une facture (écran et PDF).
function elementsDocument(d, e = profil.infos) {
  const v = d.contenu;
  const facture = d.type === "facture";
  const franchise = !!e.franchise_tva;
  const tauxTva = franchise ? 0 : v.taux_tva;
  const tva = franchise ? 0 : v.montant_tva;
  const ttc = franchise ? v.total_ht : v.total_ttc;
  const acompte = Number(e.acompte || 0);
  const avoir = facture && !!v.avoir;

  const mentions = avoir
    ? []
    : facture
    ? [
        d.statut !== "brouillon" ? `Date d'échéance : ${dateFr(ajouterJours(d.date_document, e.delai_paiement || 30))}.` : "",
        v.devis_numero ? `Facture établie selon le devis n° ${v.devis_numero}.` : "",
        "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.",
        e.iban ? `Règlement par virement : IBAN ${e.iban}` : "",
      ]
    : [
        `Devis valable ${e.validite || 30} jours à compter du ${dateFr(d.date_document)}. Devis gratuit.`,
        texteAcompte(v, acompte, euros((ttc * acompte) / 100)),
        v.duree_estimee ? `Durée estimée des travaux : ${v.duree_estimee}.` : "",
      ];
  mentions.push(...mentionsClient(d, e, dateFr));
  if (franchise) mentions.push("TVA non applicable, art. 293 B du CGI.");
  else if (autoliquidation(v)) {
    // mention d'autoliquidation déjà ajoutée
  } else mentions.push(...mentionsTvaReduite(v, d.type));
  if (e.assurance) mentions.push(`Assurance décennale : ${e.assurance}.`);
  const conditions = conditionsDe(e, d.type);
  if (conditions) mentions.push(conditions);

  const nom = avoir ? "AVOIR" : "FACTURE";
  const titre = facture ? (d.numero ? `${nom} n° ${d.numero}` : `${nom} (brouillon, non numéroté${avoir ? "" : "e"})`) : `DEVIS n° ${d.numero}`;
  return { franchise, tauxTva, tva, ttc, mentions: mentions.filter(Boolean), titre };
}

function rendreDocument() {
  const d = docCourant;
  const v = d.contenu;
  const e = profil.infos;
  const facture = d.type === "facture";
  const verrouille = estVerrouille(d);
  const editable = verrouille ? "" : "contenteditable";
  const franchise = e.franchise_tva;

  $("#en-facture").hidden = facture;
  $("#lien-signature").hidden = facture || !["brouillon", "envoye"].includes(d.statut);
  $("#modifier-ia").hidden = facture;
  $("#emettre").hidden = !(facture && d.statut === "brouillon");
  $("#payee").hidden = !(facture && d.statut === "emise");
  $("#faire-avoir").hidden = !(facture && !v.avoir && d.statut !== "brouillon");
  $("#supprimer").hidden = verrouille;
  $(".menu-plus").open = false;
  $("#numero-document").textContent = `${nomDoc(d)} ${d.numero || "brouillon"}`;
  const badge = $("#badge-statut");
  badge.textContent = LIBELLES_STATUT[d.statut];
  badge.className = `badge-statut statut-${d.statut}`;
  const principale = {
    "devis-brouillon": ["📤 Envoyer le devis", () => $("#partager").click()],
    "devis-envoye": ["✓ Marquer comme accepté", () => changerStatut("accepte").then(() => notifier("Devis accepté 🎉"))],
    "devis-accepte": ["🧾 Créer la facture", () => $("#en-facture").click()],
    "devis-refuse": ["↩️ Remettre en attente", () => changerStatut("envoye")],
    "facture-brouillon": ["✅ Émettre la facture", () => $("#emettre").click()],
    "facture-emise": ["💶 Marquer payée", () => $("#payee").click()],
  }[`${d.type}-${d.statut}`];
  const bouton = $("#action-principale");
  bouton.hidden = !principale;
  if (principale) {
    bouton.textContent = principale[0];
    bouton.onclick = principale[1];
  }

  const info = $("#info-statut");
  if (facture) {
    info.hidden = false;
    info.innerHTML =
      d.statut === "brouillon"
        ? "Facture en <strong>brouillon</strong> : vérifie-la puis clique « Émettre la facture ». Elle recevra alors son numéro définitif et ne pourra plus être modifiée."
        : `Facture <strong>${LIBELLES_STATUT[d.statut]}</strong> : elle est verrouillée (obligation légale). Pour corriger, fais un avoir.<br>📄 Le PDF est une <strong>facture électronique Factur-X</strong> (EN 16931), lisible par les logiciels comptables et les plateformes agréées.`;
  } else {
    // Le statut se lit dans le badge en haut et se change avec le gros bouton (ou ici, pour revenir en arrière)
    info.hidden = false;
    if (v.signature_client) {
      signatureDuDevis(d).then((sig) => {
        if (docCourant !== d || !sig) return;
        info.innerHTML = `✍️ <strong>Signé en ligne par ${esc(sig.signataire_nom)}</strong> le ${dateFr(sig.signe_at)} à ${heureFr(sig.signe_at)}${v.signature_client?.execution_anticipee ? `<br>⏩ <strong>Le client demande que les travaux commencent avant la fin des 14 jours</strong> (s'il se rétracte, il paie les travaux déjà faits).` : ""}<br><img class="signature-client" src="${esc(sig.signature)}" alt="Signature du client">`;
      });
      info.innerHTML = `✍️ Signé en ligne par ${esc(v.signature_client.nom)}`;
    } else {
      info.innerHTML = `Statut du devis (pour corriger une erreur) : <select id="statut-devis">${["brouillon", "envoye", "accepte", "refuse"]
        .map((s) => `<option value="${s}" ${s === d.statut ? "selected" : ""}>${LIBELLES_STATUT[s]}</option>`)
        .join("")}</select>`;
      $("#statut-devis").onchange = async (ev) => {
        await changerStatut(ev.target.value);
        notifier(`Devis passé en « ${LIBELLES_STATUT[ev.target.value]} ».`);
      };
    }
  }

  if ($("#historique-envois").dataset.doc !== d.id) {
    $("#historique-envois").dataset.doc = d.id;
    $("#historique-envois").hidden = true;
    afficherHistoriqueEnvois(d);
  }
  const estimes = v.sections.flatMap((s) => s.lignes).filter((l) => l.prix_source === "estime").length;
  const hyp = [...(v.hypotheses ?? [])];
  if (estimes && !verrouille) hyp.unshift(`${estimes} prix estimé(s) par l'IA (surlignés en jaune) : vérifie-les et ajoute-les à ta grille.`);
  if (estParticulier(v) && !e.mediateur?.trim()) hyp.push("Médiateur de la consommation non renseigné (Réglages → Entreprise) : obligatoire quand le client est un particulier.");
  if (facture && !v.avoir && !v.date_travaux?.trim()) hyp.push("Indique la date (ou la période) des travaux réalisés, en bas de la facture.");
  if (!estParticulier(v) && !v.client_siren?.trim()) hyp.push("Client professionnel : ajoute son SIREN dans le cadre « Client » (obligatoire pour la facture électronique).");
  if (facture && !e.siret?.trim()) hyp.push("Renseigne ton SIRET (Réglages → Entreprise) : indispensable pour la facture électronique.");
  if (facture && !e.franchise_tva && !e.tva_intra?.trim()) hyp.push("Renseigne ton n° de TVA intracommunautaire (Réglages → Entreprise) : obligatoire sur les factures avec TVA.");
  $("#hypotheses").hidden = hyp.length === 0 || verrouille;
  $("#hypotheses").innerHTML = `<strong>À vérifier avant d'envoyer :</strong><ul>${hyp.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;

  const lignes = v.sections
    .map(
      (s, si) => `
      <tr class="section"><td colspan="5" ${editable} data-champ="section" data-s="${si}">${esc(s.titre)}</td></tr>
      ${s.lignes
        .map((l, li) => {
          const estime = l.prix_source === "estime" && !verrouille;
          const option = !!l.option;
          const nonRetenue = option && l.option_retenue !== true;
          return `<tr class="${estime ? "estime" : ""} ${option ? "ligne-option" : ""} ${nonRetenue ? "non-retenue" : ""}">
            <td><div ${editable} data-champ="designation" data-s="${si}" data-l="${li}">${esc(l.designation)}</div>
              ${l.detail ? `<div class="detail" ${editable} data-champ="detail" data-s="${si}" data-l="${li}">${esc(l.detail)}</div>` : ""}
              ${l.calcul ? `<div class="calcul">${esc(l.calcul)}</div>` : ""}
              ${option ? (!verrouille && !facture
                ? `<button type="button" class="badge-option" data-inclure="${si}-${li}" title="Appuie pour changer">${l.option_retenue ? "Option incluse · le client peut l'enlever" : "Option non incluse · le client peut l'ajouter"} ⇄</button>`
                : `<span class="badge-option">${l.option_retenue ? "Option incluse" : "Option non incluse"}</span>`) : ""}
              ${!verrouille && !facture ? `<button type="button" class="lien no-print bascule-option" data-option="${si}-${li}">${option ? "Ne plus proposer en option" : "Proposer en option"}</button>` : ""}
              ${
                franchise || autoliquidation(v)
                  ? ""
                  : verrouille
                    ? tauxLigne(l, v) !== Number(v.taux_tva) ? `<span class="badge-tva">TVA ${nombre(tauxLigne(l, v))} %</span>` : ""
                    : `<button type="button" class="choix-tva no-print ${tauxLigne(l, v) !== Number(v.taux_tva) ? "differente" : ""}" data-tva="${si}-${li}">TVA ${nombre(tauxLigne(l, v))} % ▾</button>`
              }
              ${estime ? `<div class="no-print"><span class="badge-estime">prix estimé</span> <button class="lien" data-grille="${si}-${li}">+ ajouter à ma grille</button></div>` : ""}</td>
            <td class="num" ${editable} data-champ="quantite" data-s="${si}" data-l="${li}">${nombre(l.quantite)}</td>
            <td>${verrouille ? esc(l.unite) : `<button type="button" class="choix-unite" data-unite="${si}-${li}" title="Changer l'unité">${esc(l.unite)} ▾</button>`}</td>
            <td class="num" ${editable} data-champ="prix_unitaire_ht" data-s="${si}" data-l="${li}">${nombre(l.prix_unitaire_ht)}</td>
            <td class="num">${nonRetenue ? `<s>${euros(l.total_ht)}</s>` : euros(l.total_ht)}${verrouille ? "" : ` <button class="suppr-ligne" data-suppr="${si}-${li}" title="Supprimer la ligne">✕</button>`}</td>
          </tr>`;
        })
        .join("")}
      ${verrouille ? "" : `<tr class="ajout-ligne"><td colspan="5"><button class="lien" data-ajout="${si}">+ ajouter une ligne</button></td></tr>`}`,
    )
    .join("");

  const { tauxTva, tva, ttc, mentions, titre } = elementsDocument(d, e);

  const perso = htmlPersonnalisation(e, d.type, esc);
  const titreDoc = esc(titre);
  const pro = !estParticulier(v);
  const cadreLegal = verrouille || v.avoir
    ? ""
    : `<div class="cadre-legal no-print">
      <div class="choix-client">Client :
        <label><input type="radio" name="type-client" value="particulier" ${pro ? "" : "checked"}> Particulier</label>
        <label><input type="radio" name="type-client" value="pro" ${pro ? "checked" : ""}> Professionnel</label>
      </div>
      ${!pro && !facture ? `<label class="case-legal"><input type="checkbox" id="hors-etablissement" ${horsEtablissement(v) ? "checked" : ""}> Devis signé chez le client ou à distance → droit de rétractation de 14 jours (formulaire joint au PDF)</label>` : ""}
      ${pro ? `<label class="case-legal"><input type="checkbox" id="autoliquidation" ${v.autoliquidation ? "checked" : ""}> Sous-traitance pour une entreprise du bâtiment → autoliquidation (pas de TVA facturée)</label>` : ""}
      ${facture ? `<label class="case-legal">Nature de l'opération <select id="nature-operation">${Object.entries(NATURES).map(([k, n]) => `<option value="${k}" ${(v.nature ?? "services") === k ? "selected" : ""}>${n.charAt(0).toUpperCase() + n.slice(1)}</option>`).join("")}</select></label>` : ""}
    </div>`;

  $("#document").innerHTML = `
    ${cadreLegal}
    <div class="doc-entete">
      <div class="entreprise">
        ${logoValide(e.logo) ? `<img class="doc-logo" src="${esc(e.logo)}" alt="">` : ""}
        <strong>${esc(e.nom || "Mon entreprise (à compléter dans Réglages)")}</strong><br>
        ${esc(e.adresse || "").replace(/\n/g, "<br>")}<br>
        ${e.telephone ? `Tél. ${esc(e.telephone)}<br>` : ""}${e.email ? `${esc(e.email)}<br>` : ""}
        ${e.siret ? `SIRET ${esc(e.siret)}<br>` : ""}${e.tva_intra && !franchise ? `TVA ${esc(e.tva_intra)}` : ""}
      </div>
      <div class="client">
        <strong>Client</strong><br>
        <div ${editable} data-champ="client_nom">${esc(v.client_nom) || "<em>Nom du client</em>"}</div>
        <div ${editable} data-champ="client_adresse">${esc(v.client_adresse) || "<em>Adresse du client</em>"}</div>
        <div ${editable} inputmode="tel" data-champ="client_telephone">${esc(v.client_telephone) || (verrouille ? "" : "<em>Téléphone du client</em>")}</div>
        <div ${editable} inputmode="email" data-champ="client_email" class="champ-email">${esc(v.client_email) || (verrouille ? "" : "<em>E-mail du client</em>")}</div>
        ${pro ? `<div>SIREN : <span ${editable} inputmode="numeric" data-champ="client_siren">${esc(v.client_siren) || (verrouille ? "" : "<em>à compléter</em>")}</span></div>` : ""}
        ${verrouille ? "" : `<button type="button" id="choisir-client" class="lien no-print">👤 Choisir dans mes clients</button>`}
        ${v.adresse_chantier || !verrouille ? `<small>Adresse du chantier : <span ${editable} data-champ="adresse_chantier">${esc(v.adresse_chantier) || "<em>si différente</em>"}</span></small>` : ""}
      </div>
    </div>
    <h2 class="doc-titre">${titreDoc}</h2>
    <div class="doc-meta">Date : ${dateFr(d.date_document)} · Objet : <span ${editable} data-champ="titre">${esc(v.titre)}</span></div>
    <p ${editable} data-champ="description">${esc(v.description)}</p>
    ${perso.intro}
    <table class="doc-table">
      <thead><tr><th>Désignation</th><th class="num">Qté</th><th>Unité</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
    <table class="doc-totaux">
      <tr><td>Total HT</td><td class="num">${euros(v.total_ht)}</td></tr>
      ${
        franchise
          ? ""
          : autoliquidation(v)
            ? `<tr><td>TVA autoliquidée</td><td class="num">${euros(0)}</td></tr>`
            : ventilationTva(v).length > 1
              ? ventilationTva(v).map((t) => `<tr><td>TVA ${nombre(t.taux)} % <small>sur ${euros(t.base_ht)}</small></td><td class="num">${euros(t.montant_tva)}</td></tr>`).join("")
              : `<tr><td>TVA <span ${editable} data-champ="taux_tva">${nombre(tauxTva)}</span> %</td><td class="num">${euros(tva)}</td></tr>`
      }
      <tr class="ttc"><td>${franchise ? "Net à payer" : "Total TTC"}</td><td class="num">${euros(ttc)}</td></tr>
    </table>
    ${perso.fin}
    <div class="doc-mentions">${
      facture || (verrouille && !v.date_debut)
        ? ""
        : `<p>Date de début prévue des travaux : <span ${editable} data-champ="date_debut" class="champ-duree">${esc(v.date_debut) || "<em>à préciser (ex. 15 janvier 2027)</em>"}</span>.</p>`
    }${
      !facture || v.avoir || (verrouille && !v.date_travaux)
        ? ""
        : `<p>Date d'exécution des travaux : <span ${editable} data-champ="date_travaux" class="champ-duree">${esc(v.date_travaux) || "<em>à préciser (ex. du 3 au 7 novembre 2026)</em>"}</span>.</p>`
    }${mentions
      .filter((m) => !m.startsWith("Durée estimée") && !m.startsWith("Date de début prévue") && !m.startsWith("Date d'exécution"))
      .map((m) => `<p>${esc(m)}</p>`)
      .join("")}${
      facture || (verrouille && !v.duree_estimee)
        ? ""
        : `<p>Durée estimée des travaux : <span ${editable} data-champ="duree_estimee" class="champ-duree">${esc(v.duree_estimee) || "<em>à préciser (ex. 3 jours)</em>"}</span>.</p>`
    }${!facture && horsEtablissement(v) ? `<p class="no-print aide">📄 Le formulaire de rétractation est ajouté automatiquement à la fin du PDF.</p>` : ""}</div>
    ${facture ? "" : `<div class="doc-signature"><div>L'entreprise</div><div>Le client<br><small>Date, signature et mention « Bon pour accord »</small></div></div>`}
    ${perso.labels}${perso.pied}
  `;

  appliquerCouleur($("#document"), e.couleur);
  $("#document").dataset.modele = modeleDe(e);
  if (verrouille) return;
  $("#choisir-client").onclick = async () => {
    const c = await choisirClient();
    if (!c) return;
    await majDocument((dv) => Object.assign(dv, { client_nom: c.nom, client_adresse: c.adresse, client_email: c.email, client_telephone: c.telephone }));
    notifier(`Client « ${c.nom} » ajouté au devis.`);
  };

  // Type de client, rétractation, autoliquidation
  for (const r of $("#document").querySelectorAll("[name=type-client]")) {
    r.onchange = () =>
      majDocument((dv) => {
        dv.client_type = r.value;
        if (r.value === "particulier" && dv.autoliquidation) {
          dv.autoliquidation = false;
          dv.taux_tva = dv.taux_tva_avant ?? 10;
        }
      });
  }
  const nature = $("#nature-operation");
  if (nature) nature.onchange = () => majDocument((dv) => (dv.nature = nature.value));
  const caseHors = $("#hors-etablissement");
  if (caseHors) caseHors.onchange = () => majDocument((dv) => (dv.hors_etablissement = caseHors.checked));
  const caseAuto = $("#autoliquidation");
  if (caseAuto) {
    caseAuto.onchange = () =>
      majDocument((dv) => {
        if (caseAuto.checked) {
          dv.taux_tva_avant = dv.taux_tva;
          dv.taux_tva = 0;
        } else dv.taux_tva = dv.taux_tva_avant ?? 20;
        dv.autoliquidation = caseAuto.checked;
      });
  }

  // Édition directe dans le document
  for (const el of $("#document").querySelectorAll("[contenteditable]")) {
    el.addEventListener("focus", () => {
      if (!el.querySelector("em")) return;
      el.textContent = "";
      // Curseur remis dans le champ vidé (sinon la saisie peut partir dans le vide)
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    el.addEventListener("blur", () => {
      const { champ, s, l } = el.dataset;
      const val = el.innerText.trim();
      majDocument((dv) => {
        if (champ === "section") dv.sections[s].titre = val;
        else if (l !== undefined) {
          const ligne = dv.sections[s].lignes[l];
          const numerique = ["quantite", "prix_unitaire_ht"].includes(champ);
          ligne[champ] = numerique ? lireNombre(val) : val;
          if (champ === "prix_unitaire_ht") ligne.prix_source = "artisan";
        } else if (champ === "client_email") dv.client_email = val.replace(/\s+/g, "").toLowerCase();
        else dv[champ] = champ === "taux_tva" ? lireNombre(val) : val;
      });
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        el.blur();
      }
    });
  }
  for (const b of $("#document").querySelectorAll("[data-option]")) {
    b.onclick = () => {
      const [si, li] = b.dataset.option.split("-").map(Number);
      majDocument((dv) => {
        const l = dv.sections[si].lignes[li];
        if (l.option) {
          delete l.option;
          delete l.option_retenue;
        } else Object.assign(l, { option: true, option_retenue: true }); // comptée dans le prix ; le client peut l'enlever
      });
    };
  }
  for (const b of $("#document").querySelectorAll("[data-inclure]")) {
    b.onclick = () => {
      const [si, li] = b.dataset.inclure.split("-").map(Number);
      majDocument((dv) => {
        const l = dv.sections[si].lignes[li];
        l.option_retenue = !l.option_retenue;
      });
    };
  }
  for (const b of $("#document").querySelectorAll("[data-tva]")) {
    b.onclick = async () => {
      const [si, li] = b.dataset.tva.split("-").map(Number);
      const ligne = docCourant.contenu.sections[si].lignes[li];
      const taux = await choisirTauxTva(ligne, docCourant.contenu);
      if (taux === undefined) return;
      await majDocument((dv) => {
        const l = dv.sections[si].lignes[li];
        if (taux === null || taux === Number(dv.taux_tva)) delete l.taux_tva;
        else l.taux_tva = taux;
      });
    };
  }
  for (const b of $("#document").querySelectorAll("[data-unite]")) {
    b.onclick = async () => {
      const [si, li] = b.dataset.unite.split("-").map(Number);
      const ligne = docCourant.contenu.sections[si].lignes[li];
      const unite = await choisirUnite(ligne);
      if (!unite || unite === ligne.unite) return;
      await majDocument((dv) => {
        const l = dv.sections[si].lignes[li];
        if (unite === "forfait" && l.quantite !== 1) {
          // Même montant, présenté en forfait : 1 × total
          l.prix_unitaire_ht = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100;
          l.quantite = 1;
          l.calcul = "";
        }
        l.unite = unite;
        l.prix_source = "artisan";
      });
      notifier(unite === "forfait" ? "Ligne passée au forfait (même montant)." : `Unité : ${unite}`);
    };
  }
  for (const b of $("#document").querySelectorAll("[data-suppr]")) {
    b.onclick = () => {
      const [s, l] = b.dataset.suppr.split("-").map(Number);
      majDocument((dv) => dv.sections[s].lignes.splice(l, 1));
    };
  }
  for (const b of $("#document").querySelectorAll("[data-ajout]")) {
    b.onclick = () =>
      majDocument((dv) =>
        dv.sections[b.dataset.ajout].lignes.push({ designation: "Nouvelle prestation", detail: "", quantite: 1, unite: "u", prix_unitaire_ht: 0, prix_source: "artisan", calcul: "" }),
      );
  }
  for (const b of $("#document").querySelectorAll("[data-grille]")) {
    b.onclick = async () => {
      const [s, l] = b.dataset.grille.split("-").map(Number);
      const ligne = docCourant.contenu.sections[s].lignes[l];
      // Déjà dans la grille (même nom, même unité) : on met à jour son prix au lieu de créer un doublon.
      const existant = tarifs.find((t) => normaliser(t.designation) === normaliser(ligne.designation) && t.unite === ligne.unite);
      const requete = existant
        ? sb.from("tarifs").update({ prix: ligne.prix_unitaire_ht }).eq("id", existant.id)
        : sb.from("tarifs").insert({ corps_etat: "", designation: ligne.designation.slice(0, 300), unite: ligne.unite.slice(0, 20), prix: ligne.prix_unitaire_ht });
      const { data, error } = await requete.select("*").single();
      if (error) return erreur("Prix non ajouté à la grille.", error);
      tarifs = existant ? tarifs.map((t) => (t.id === data.id ? data : t)) : [...tarifs, data];
      notifier(existant ? "Prix mis à jour dans ta grille ✓" : "Ajouté à ta grille ✓");
      majDocument((dv) => (dv.sections[s].lignes[l].prix_source = "grille"));
    };
  }
}

$("#retour").onclick = () => (ficheCourante ? ouvrirFiche(ficheCourante) : afficherVue("documents"));
const chargerScript = (src) =>
  new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = Object.assign(document.createElement("script"), { src, onload: ok, onerror: () => ko(new Error(`Chargement impossible : ${src}`)) });
    document.head.appendChild(s);
  });

// PDF du document (null si la plateforme ne sait pas en fabriquer, ex. version d'essai).
async function pdfDocument(d) {
  if (!plateforme.scriptsPdf) return null;
  for (const src of plateforme.scriptsPdf) await chargerScript(src);
  await preparerPolices();
  const elements = elementsDocument(d);
  const sig = await signatureDuDevis(d);
  if (sig) elements.signature = { image: sig.signature, nom: sig.signataire_nom, date: dateFr(sig.signe_at) };
  const pdf = genererPdf({ d, entreprise: profil.infos, elements, euros, nombre, dateFr });
  // Facture ou avoir émis : facture électronique Factur-X (PDF/A-3 + XML EN 16931 attaché).
  if (d.type === "facture" && d.numero && d.statut !== "brouillon") {
    try {
      await chargerScript("/vendor/pdf-lib.min.js");
      const xml = xmlFacturX({ d, e: profil.infos, mentions: elements.mentions, echeance: ajouterJours(d.date_document, profil.infos.delai_paiement || 30) });
      return await pdfFacturX(pdf, xml, { titre: `${nomDoc(d)} ${d.numero}`, auteur: profil.infos.nom || "Cagot", avoir: !!d.contenu.avoir });
    } catch (err) {
      console.error("Factur-X", err); // repli : PDF simple
    }
  }
  return pdf;
}

// --- Devis interactif : lien secret pour que le client choisisse ses options et signe ---
function jetonAleatoire() {
  const o = new Uint8Array(32);
  crypto.getRandomValues(o);
  return btoa(String.fromCharCode(...o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function lienSignature(d) {
  const { data: existants, error } = await sb.from("partages_devis").select("jeton, signe_at, revoque, expire_at").eq("document_id", d.id).order("created_at", { ascending: false }).limit(5);
  if (error) throw error;
  let p = existants.find((x) => !x.revoque && !x.signe_at && new Date(x.expire_at) > new Date());
  if (!p) {
    p = { jeton: jetonAleatoire() };
    const { error: err } = await sb.from("partages_devis").insert({ document_id: d.id, jeton: p.jeton });
    if (err) throw err;
  }
  return `${ORIGINE_PUBLIQUE}/devis.html#${p.jeton}`;
}

async function signatureDuDevis(d) {
  if (d.type !== "devis" || !d.contenu.signature_client) return null;
  const { data } = await sb.from("partages_devis").select("signataire_nom, signe_at, signature, options_retenues, preuve").eq("document_id", d.id).not("signe_at", "is", null).limit(1);
  return data?.[0] ?? null;
}

$("#lien-signature").onclick = async () => {
  const d = docCourant;
  try {
    const url = await lienSignature(d);
    if (navigator.share) await navigator.share({ title: `Devis ${d.numero}`, text: "Consultez, choisissez vos options et signez votre devis :", url }).catch(() => {});
    else {
      await navigator.clipboard.writeText(url);
      notifier("Lien copié : colle-le dans ton message au client.");
    }
  } catch (err) {
    erreur("Lien de signature indisponible (mise à jour du serveur à faire ?).", err);
  }
};

const titreFichier = (d) => `${nomDoc(d)} ${d.numero || "brouillon"} ${d.contenu.client_nom || ""}`.trim();

$("#imprimer").onclick = async () => {
  try {
    await plateforme.exporterPdf({ titre: titreFichier(docCourant), pdf: await pdfDocument(docCourant), document: $("#document") });
  } catch (err) {
    erreur("Export impossible.", err);
  }
};

// ---------------------------------------------------------------------------
// Journal des ventes : factures émises sur une période, TVA par taux, encaissé, impayés, export
// ---------------------------------------------------------------------------
let periodeJournal = local.lire("periode-journal", "mois");
let facturesJournal = [];
const PERIODES_JOURNAL = [["mois", "Ce mois"], ["mois-1", "Mois dernier"], ["trim", "Ce trimestre"], ["trim-1", "Trimestre dernier"], ["annee", "Cette année"], ["annee-1", "Année dernière"], ["perso", "Dates…"]];

function bornesJournal(p) {
  const n = new Date();
  const [a, m] = [n.getFullYear(), n.getMonth()];
  const t = Math.floor(m / 3) * 3;
  const de = (y, mo) => new Date(y, mo, 1);
  if (p === "mois-1") return [de(a, m - 1), de(a, m)];
  if (p === "trim") return [de(a, t), de(a, t + 3)];
  if (p === "trim-1") return [de(a, t - 3), de(a, t)];
  if (p === "annee") return [de(a, 0), de(a + 1, 0)];
  if (p === "annee-1") return [de(a - 1, 0), de(a, 0)];
  if (p === "perso") {
    const d = $("#journal-debut").value ? new Date(`${$("#journal-debut").value}T00:00:00`) : de(a, 0);
    const f = $("#journal-fin").value ? new Date(`${$("#journal-fin").value}T00:00:00`) : n;
    f.setDate(f.getDate() + 1);
    return [d, f];
  }
  return [de(a, m), de(a, m + 1)];
}

const montantsFacture = (f) => {
  const c = f.contenu;
  const franchise = !!profil.infos.franchise_tva;
  const ht = Number(c.total_ht || 0);
  const tva = franchise ? 0 : Number(c.montant_tva || 0);
  return { ht, tva, ttc: franchise ? ht : Number(c.total_ttc || 0), taux: franchise || autoliquidation(c) ? 0 : Number(c.taux_tva ?? 0) };
};

async function afficherJournal() {
  const { data, error } = await sb.from("documents").select("id, numero, statut, date_document, updated_at, contenu").eq("type", "facture").in("statut", ["emise", "payee"]).limit(5000);
  if (error) {
    $("#table-journal").innerHTML = `<p class="aide">Impossible de charger les factures (connexion ?).</p>`;
    return;
  }
  facturesJournal = data;
  const pai = await sb.from("paiements").select("document_id, montant, date_paiement, mode").limit(10000);
  paiementsJournal = pai.error ? null : pai.data;
  rendreJournal();
  verifierIntegrite();
}

let paiementsJournal = null;

// Éditeur du logiciel (attestation individuelle anti-fraude TVA). À compléter avec le SIREN
// de la micro-entreprise qui commercialise Cagot dès son immatriculation.
const EDITEUR = {
  nom: "Cagot",
  logiciel: "Cagot",
  representant: "Yoann Halter",
  qualite: "éditeur et représentant légal",
  siren: "",
  adresse: "France",
  ville: "Paris",
  mise_sur_le_marche: "24/09/2026",
};

async function telechargerAttestation() {
  if (!plateforme.scriptsPdf) return erreur("Attestation disponible dans l'application en ligne.");
  for (const src of plateforme.scriptsPdf) await chargerScript(src);
  await preparerPolices();
  const blob = pdfAttestation({ editeur: EDITEUR, entreprise: profil.infos, version: VERSION_APPLI, dateFr });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "Attestation_conformite_Cagot.pdf" });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Clôtures mensuelles et annuelles scellées (créées automatiquement pour les périodes terminées).
async function afficherClotures() {
  const zone = $("#clotures-journal");
  await sb.rpc("cloturer_periodes");
  const { data, error } = await sb.from("journal_factures").select("id, donnees").eq("evenement", "cloture").order("id", { ascending: false }).limit(240);
  if (error || !data?.length) {
    zone.innerHTML = "";
    return;
  }
  const mois = (p) => (p.length === 4 ? `Année ${p}` : new Date(`${p}-15T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  zone.innerHTML = `<details><summary>🗄️ Clôtures scellées (${data.length})</summary>
    <p class="aide">Chaque fin de mois et d'année, les totaux sont figés dans le journal sécurisé : ils ne peuvent plus être modifiés.</p>
    <div class="defilement-table"><table class="table-journal"><thead><tr><th>Période</th><th class="num">Factures</th><th class="num">HT</th><th class="num">TVA</th><th class="num">TTC</th><th class="num">Encaissé</th><th class="num">Cumul TTC</th></tr></thead><tbody>${data
      .map(({ donnees: c }) => `<tr class="${c.type === "annuelle" ? "cloture-annuelle" : ""}"><td>${esc(mois(c.periode))}</td><td class="num">${c.nb_factures}${c.nb_avoirs ? ` + ${c.nb_avoirs} avoir${c.nb_avoirs > 1 ? "s" : ""}` : ""}</td><td class="num">${euros(c.total_ht)}</td><td class="num">${euros(c.total_tva)}</td><td class="num">${euros(c.total_ttc)}</td><td class="num">${euros(c.encaisse)}</td><td class="num">${euros(c.cumul_perpetuel_ttc)}</td></tr>`)
      .join("")}</tbody></table></div></details>`;
}

async function verifierIntegrite() {
  const zone = $("#integrite-journal");
  await afficherClotures().catch(console.error);
  const { data, error } = await sb.rpc("verifier_journal");
  if (error) {
    zone.innerHTML = "";
    return;
  }
  zone.className = `integrite-journal ${data.ok ? "ok" : "alerte"}`;
  zone.innerHTML = data.ok
    ? `🔒 <b>Factures intègres</b> : ${data.nb} enregistrement${data.nb > 1 ? "s" : ""} scellé${data.nb > 1 ? "s" : ""} (émissions, avoirs, paiements, clôtures), aucune modification détectée.
       <button type="button" class="lien" id="exporter-archive">Télécharger l'archive scellée</button>
       <button type="button" class="lien" id="attestation-conformite">Attestation de conformité (loi anti-fraude TVA)</button>`
    : `⚠️ <b>Anomalie détectée</b> sur ${esc(data.numero || "un enregistrement")} : ${data.probleme === "facture_modifiee" ? "la facture ne correspond plus à celle émise" : "la chaîne du journal est rompue"}. Contacte le support Cagot.`;
  const b = $("#exporter-archive");
  if (b) b.onclick = exporterArchive;
  const att = $("#attestation-conformite");
  if (att) att.onclick = () => telechargerAttestation().catch((e) => erreur(`Attestation impossible : ${e.message}`));
}

async function exporterArchive() {
  const [docs, journal, pai, verif] = await Promise.all([
    sb.from("documents").select("id, type, numero, statut, date_document, devis_id, contenu, created_at, updated_at").eq("type", "facture").neq("statut", "brouillon").limit(10000),
    sb.from("journal_factures").select("*").order("id").limit(100000),
    sb.from("paiements").select("*").limit(100000),
    sb.rpc("verifier_journal"),
  ]);
  if (docs.error || journal.error) return erreur("Archive impossible (connexion ?).");
  const archive = {
    logiciel: "Cagot",
    version: VERSION_APPLI,
    entreprise: { nom: profil.infos.nom, siret: profil.infos.siret, tva_intra: profil.infos.tva_intra },
    genere_le: new Date().toISOString(),
    verification: verif.data,
    factures: docs.data,
    paiements: pai.data ?? [],
    journal: journal.data,
  };
  const texte = JSON.stringify(archive, null, 1);
  const empreinte = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)))].map((o) => o.toString(16).padStart(2, "0")).join("");
  const nom = `Archive_factures_${(profil.infos.nom || "Cagot").replace(/[^\p{L}\p{N}]+/gu, "_")}_${new Date().toISOString().slice(0, 10)}`;
  for (const [contenu, ext, type] of [[texte, "json", "application/json"], [`SHA-256 (${nom}.json) = ${empreinte}\n`, "sha256.txt", "text/plain"]]) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([contenu], { type })), download: `${nom}.${ext}` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  notifier("Archive téléchargée : garde-la précieusement (10 ans).");
}

function rendreJournal() {
  local.ecrire("periode-journal", periodeJournal);
  $("#periodes-journal").innerHTML = PERIODES_JOURNAL.map(([id, nom]) => `<button type="button" class="puce ${periodeJournal === id ? "choisie" : ""}" data-periode-journal="${id}">${nom}</button>`).join("");
  for (const b of $("#periodes-journal").querySelectorAll("[data-periode-journal]")) {
    b.onclick = () => {
      periodeJournal = b.dataset.periodeJournal;
      rendreJournal();
    };
  }
  $("#dates-journal").hidden = periodeJournal !== "perso";
  const [debut, fin] = bornesJournal(periodeJournal);
  const finAffichee = new Date(fin);
  finAffichee.setDate(finAffichee.getDate() - 1);
  $("#periode-journal-texte").textContent = `du ${dateFr(debut.toISOString())} au ${dateFr(finAffichee.toISOString())}`;
  const liste = facturesJournal
    .filter((f) => new Date(f.date_document) >= debut && new Date(f.date_document) < fin)
    .sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  const somme = (l, k) => l.reduce((t, f) => t + montantsFacture(f)[k], 0);
  const payees = liste.filter((f) => f.statut === "payee");
  const encaisse = paiementsJournal
    ? paiementsJournal.filter((p) => new Date(`${p.date_paiement}T12:00:00`) >= debut && new Date(`${p.date_paiement}T12:00:00`) < fin)
    : null;
  const delai = Number(profil.infos.delai_paiement || 30);
  const impayes = facturesJournal.filter((f) => f.statut === "emise");
  const enRetard = impayes.filter((f) => joursDepuis(f.date_document) > delai);
  $("#resume-journal").innerHTML = [
    ["🧾 Facturé HT", euros(somme(liste, "ht")), `${liste.length} facture${liste.length > 1 ? "s" : ""} sur la période`],
    ["🏛️ TVA collectée", euros(somme(liste, "tva")), profil.infos.franchise_tva ? "Franchise (art. 293 B)" : "sur les factures de la période"],
    encaisse
      ? ["🏦 Encaissé TTC", euros(encaisse.reduce((t, p) => t + Number(p.montant), 0)), `${encaisse.length} paiement${encaisse.length > 1 ? "s" : ""} reçu${encaisse.length > 1 ? "s" : ""} sur la période`]
      : ["🏦 Encaissé TTC", euros(somme(payees, "ttc")), `${payees.length} payée${payees.length > 1 ? "s" : ""} sur la période`],
    [`⚠️ Impayés (toutes périodes)`, euros(somme(impayes, "ttc")), `${impayes.length} facture${impayes.length > 1 ? "s" : ""}${enRetard.length ? ` · ${enRetard.length} en retard` : ""}`],
  ]
    .map(([t, v, d], i) => `<div class="tuile tuile-info ${i === 3 && enRetard.length ? "alerte" : ""}"><small>${t}</small><strong>${v}</strong><span>${esc(d)}</span></div>`)
    .join("");
  const parTaux = new Map();
  for (const f of liste) {
    const autoliq = autoliquidation(f.contenu);
    for (const v of autoliq ? [{ taux: 0, base_ht: Number(f.contenu.total_ht || 0), montant_tva: 0 }] : ventilationTva(f.contenu)) {
      const t = parTaux.get(Number(v.taux)) ?? { ht: 0, tva: 0 };
      parTaux.set(Number(v.taux), { ht: t.ht + Number(v.base_ht), tva: t.tva + Number(v.montant_tva) });
    }
  }
  $("#tva-journal").innerHTML = parTaux.size && !profil.infos.franchise_tva
    ? `<table class="table-tva"><thead><tr><th>Taux de TVA</th><th class="num">Base HT</th><th class="num">TVA</th></tr></thead><tbody>${[...parTaux]
        .sort((a, b) => b[0] - a[0])
        .map(([taux, t]) => `<tr><td>${taux ? `${nombre(taux)} %` : "0 % (autoliquidation / exonéré)"}</td><td class="num">${euros(t.ht)}</td><td class="num">${euros(t.tva)}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  $("#journal-csv").disabled = !liste.length;
  $("#table-journal").innerHTML = liste.length
    ? `<div class="defilement-table"><table class="table-journal"><thead><tr><th>Date</th><th>N°</th><th>Client</th><th class="num">HT</th><th class="num">TVA</th><th class="num">TTC</th><th>Statut</th></tr></thead><tbody>${liste
        .map((f) => {
          const m = montantsFacture(f);
          return `<tr data-ouvrir-doc="${esc(f.id)}"><td>${dateFr(f.date_document)}</td><td>${esc(f.numero)}${f.contenu.avoir ? " (avoir)" : ""}</td><td>${esc(f.contenu.client_nom || "")}</td><td class="num">${euros(m.ht)}</td><td class="num">${euros(m.tva)}</td><td class="num">${euros(m.ttc)}</td><td>${f.statut === "payee" ? "Payée" : joursDepuis(f.date_document) > delai ? "⚠️ En retard" : "À encaisser"}</td></tr>`;
        })
        .join("")}</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">${euros(somme(liste, "ht"))}</td><td class="num">${euros(somme(liste, "tva"))}</td><td class="num">${euros(somme(liste, "ttc"))}</td><td></td></tr></tfoot></table></div>`
    : `<p class="aide">Aucune facture émise sur cette période.</p>`;
  for (const tr of $("#table-journal").querySelectorAll("[data-ouvrir-doc]")) tr.onclick = () => ouvrirDocument(tr.dataset.ouvrirDoc);
  $("#journal-csv").onclick = () => {
    const nb = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
    const cellule = (t) => {
      const x = String(t ?? "").replace(/\r?\n/g, " ");
      return /[";]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const lignes = [
      ["Date", "Numéro", "Client", "Objet", "Total HT", "Taux TVA", "TVA", "Total TTC", "Statut", "Échéance"],
      ...liste.map((f) => {
        const m = montantsFacture(f);
        const taux = profil.infos.franchise_tva || autoliquidation(f.contenu) ? "0 %" : ventilationTva(f.contenu).map((v) => `${nombre(v.taux)} %`).join(" + ");
        return [dateFr(f.date_document), f.numero, f.contenu.client_nom, f.contenu.titre, nb(m.ht), taux, nb(m.tva), nb(m.ttc), f.statut === "payee" ? "Payée" : "À encaisser", dateFr(ajouterJours(f.date_document, delai))];
      }),
    ];
    const csv = `﻿${lignes.map((l) => l.map(cellule).join(";")).join("\r\n")}\r\n`;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `Journal_des_ventes_${$("#periode-journal-texte").textContent.replace(/\//g, "-").replace(/\s+/g, "_")}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
}
$("#journal-debut").onchange = () => rendreJournal();
$("#journal-fin").onchange = () => rendreJournal();
$("#journal-imprimer").onclick = () => window.print();

// ---------------------------------------------------------------------------
// Agenda : rendez-vous, visites et jours de chantier (+ échéances de factures et fins de
// délai de rétractation calculées automatiquement). Abonnement possible depuis le téléphone.
// ---------------------------------------------------------------------------
// (fonctions classiques : l'accueil peut les utiliser avant la fin du chargement du module)
function typesRdv() {
  return {
    visite: { nom: "Visite", icone: "👀" },
    travaux: { nom: "Chantier", icone: "🔨" },
    rdv: { nom: "RDV", icone: "📅" },
    autre: { nom: "Autre", icone: "📌" },
  };
}
let vueAgenda = { mode: local.lire("agenda-mode", "semaine"), date: new Date() };
let donneesAgenda = { rdv: [], auto: [], chantiers: [] };

function jourSeul(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function ajouterJoursDate(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function lundi(d) {
  return ajouterJoursDate(jourSeul(d), -((d.getDay() + 6) % 7));
}
function memeJour(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isoJour(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function heure(d) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function nomJour(d, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return d.toLocaleDateString("fr-FR", opts);
}

function bornesAgenda() {
  if (vueAgenda.mode === "mois") {
    const premier = new Date(vueAgenda.date.getFullYear(), vueAgenda.date.getMonth(), 1);
    const debut = lundi(premier);
    const dernier = new Date(vueAgenda.date.getFullYear(), vueAgenda.date.getMonth() + 1, 0);
    return [debut, ajouterJoursDate(lundi(dernier), 7)];
  }
  const debut = lundi(vueAgenda.date);
  return [debut, ajouterJoursDate(debut, 7)];
}

// Éléments calculés : échéances des factures à encaisser, fin du délai de 14 jours des devis signés.
function elementsAuto(docs) {
  const delai = Number(profil.infos.delai_paiement || 30);
  const auto = [];
  for (const d of docs) {
    const c = d.contenu ?? {};
    if (d.type === "facture" && d.statut === "emise" && !c.avoir) {
      const j = jourSeul(new Date(ajouterJours(d.date_document, delai)));
      auto.push({ auto: "echeance", doc: d.id, type: "autre", titre: `💶 Échéance ${d.numero} – ${c.client_nom || "client"} (${euros(profil.infos.franchise_tva ? c.total_ht : c.total_ttc)})`, debut: j, fin: j, journee: true });
    }
    const signe = c.signature_client?.date;
    if (d.type === "devis" && d.statut === "accepte" && signe && horsEtablissement(c) && !c.signature_client.execution_anticipee) {
      const j = ajouterJoursDate(jourSeul(new Date(signe)), 14);
      if (j >= ajouterJoursDate(jourSeul(new Date()), -1)) auto.push({ auto: "retractation", doc: d.id, type: "autre", titre: `⚖️ Fin du délai de rétractation – ${c.client_nom || d.numero}`, debut: j, fin: j, journee: true });
    }
  }
  return auto;
}

async function chargerAgenda() {
  const [debut, fin] = bornesAgenda();
  const [rdv, docs, chantiers] = await Promise.all([
    sb.from("rendez_vous").select("*").lt("debut", fin.toISOString()).gte("fin", debut.toISOString()).order("debut").limit(2000),
    sb.from("documents").select("id, type, statut, numero, date_document, contenu").in("statut", ["emise", "accepte"]).limit(1000),
    sb.from("chantiers").select("id, titre, client_id").limit(500),
  ]);
  if (rdv.error) throw rdv.error;
  if (!clients) await chargerClients().catch(() => {});
  donneesAgenda = {
    rdv: rdv.data.map((r) => ({ ...r, debut: new Date(r.debut), fin: new Date(r.fin) })),
    auto: elementsAuto(docs.data ?? []).filter((x) => x.debut < fin && x.fin >= debut),
    chantiers: chantiers.data ?? [],
  };
}

async function afficherAgenda() {
  rendreAgenda();
  try {
    await chargerAgenda();
  } catch (err) {
    $("#grille-agenda").innerHTML = `<p class="aide">Agenda indisponible (connexion ?).</p>`;
    return console.error(err);
  }
  rendreAgenda();
}

const elementsDuJour = (j) =>
  [...donneesAgenda.rdv, ...donneesAgenda.auto]
    .filter((x) => jourSeul(x.debut) <= j && jourSeul(x.fin) >= j)
    .sort((a, b) => (a.journee === b.journee ? a.debut - b.debut : a.journee ? -1 : 1));

function htmlElementAgenda(x, j) {
  const t = typesRdv()[x.type] ?? typesRdv().rdv;
  const quand = x.journee
    ? jourSeul(x.debut) < jourSeul(x.fin) ? `jour ${Math.round((j - jourSeul(x.debut)) / 864e5) + 1}/${Math.round((jourSeul(x.fin) - jourSeul(x.debut)) / 864e5) + 1}` : "journée"
    : `${heure(x.debut)}–${heure(x.fin)}`;
  const attr = x.auto ? `data-ouvrir-doc="${esc(x.doc)}"` : `data-rdv="${esc(x.id)}"`;
  return `<button type="button" class="rdv-agenda type-${esc(x.auto ? x.auto : x.type)}" ${attr}>
      <span class="heure-rdv">${esc(quand)}</span>
      <span><strong>${x.auto ? "" : `${t.icone} `}${esc(x.titre)}</strong>${x.lieu ? `<small>📍 ${esc(x.lieu)}</small>` : ""}${(() => {
        const c = x.client_id && clients?.find((k) => k.id === x.client_id);
        return c ? `<small>👤 ${esc([c.nom, c.telephone].filter(Boolean).join(" · "))}</small>` : "";
      })()}</span>
    </button>`;
}

function rendreAgenda() {
  local.ecrire("agenda-mode", vueAgenda.mode);
  for (const b of document.querySelectorAll("[data-mode-agenda]")) b.classList.toggle("choisie", b.dataset.modeAgenda === vueAgenda.mode);
  const [debut, fin] = bornesAgenda();
  const auj = jourSeul(new Date());
  const zone = $("#grille-agenda");
  if (vueAgenda.mode === "mois") {
    $("#agenda-periode").textContent = vueAgenda.date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const jours = [];
    for (let j = debut; j < fin; j = ajouterJoursDate(j, 1)) jours.push(j);
    zone.innerHTML = `<div class="mois-agenda">${["L", "M", "M", "J", "V", "S", "D"].map((x) => `<span class="entete-mois">${x}</span>`).join("")}${jours
      .map((j) => {
        const l = elementsDuJour(j);
        return `<button type="button" class="case-mois ${j.getMonth() !== vueAgenda.date.getMonth() ? "hors-mois" : ""} ${memeJour(j, auj) ? "aujourdhui" : ""}" data-jour="${isoJour(j)}">
          <b>${j.getDate()}</b>${l.slice(0, 2).map((x) => `<i class="type-${esc(x.auto ? x.auto : x.type)}">${esc(x.titre.replace(/^\S+\s/, (m) => (x.auto ? "" : m)).slice(0, 14))}</i>`).join("")}${l.length > 2 ? `<small>+${l.length - 2}</small>` : ""}</button>`;
      })
      .join("")}</div>`;
    for (const b of zone.querySelectorAll("[data-jour]")) {
      b.onclick = () => {
        vueAgenda = { mode: "semaine", date: new Date(`${b.dataset.jour}T12:00:00`) };
        afficherAgenda();
      };
    }
    return;
  }
  const dernier = ajouterJoursDate(fin, -1);
  $("#agenda-periode").textContent = `${nomJour(debut, { day: "numeric", month: debut.getMonth() === dernier.getMonth() ? undefined : "short" })} – ${nomJour(dernier, { day: "numeric", month: "long", year: "numeric" })}`;
  const jours = [];
  for (let j = debut; j < fin; j = ajouterJoursDate(j, 1)) jours.push(j);
  zone.innerHTML = jours
    .map((j) => {
      const l = elementsDuJour(j);
      return `<section class="jour-agenda ${memeJour(j, auj) ? "aujourdhui" : ""} ${j < auj ? "passe" : ""}">
        <h4><span>${esc(nomJour(j, { weekday: "long", day: "numeric", month: "short" }))}</span><button type="button" class="lien ajout-jour" data-ajout-jour="${isoJour(j)}" aria-label="Ajouter ce jour-là">＋</button></h4>
        ${l.length ? l.map((x) => htmlElementAgenda(x, j)).join("") : `<p class="aide vide-jour">—</p>`}
      </section>`;
    })
    .join("");
  for (const b of zone.querySelectorAll("[data-ajout-jour]")) b.onclick = () => editerRdv(null, { jour: b.dataset.ajoutJour });
  for (const b of zone.querySelectorAll("[data-rdv]")) b.onclick = () => editerRdv(donneesAgenda.rdv.find((r) => r.id === b.dataset.rdv));
  for (const b of zone.querySelectorAll("[data-ouvrir-doc]")) b.onclick = () => ouvrirDocument(b.dataset.ouvrirDoc);
}

$("#agenda-avant").onclick = () => {
  const d = vueAgenda.date;
  vueAgenda.date = vueAgenda.mode === "mois" ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : ajouterJoursDate(d, -7);
  afficherAgenda();
};
$("#agenda-apres").onclick = () => {
  const d = vueAgenda.date;
  vueAgenda.date = vueAgenda.mode === "mois" ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : ajouterJoursDate(d, 7);
  afficherAgenda();
};
$("#agenda-aujourdhui").onclick = () => {
  vueAgenda.date = new Date();
  afficherAgenda();
};
for (const b of document.querySelectorAll("[data-mode-agenda]")) {
  b.onclick = () => {
    vueAgenda.mode = b.dataset.modeAgenda;
    afficherAgenda();
  };
}
$("#nouveau-rdv").onclick = () => editerRdv(null, { jour: isoJour(vueAgenda.mode === "semaine" && lundi(vueAgenda.date) > new Date() ? lundi(vueAgenda.date) : new Date()) });

// Fenêtre d'un rendez-vous (création / modification / suppression).
function editerRdv(rdv, { jour, chantier = null } = {}) {
  return new Promise((resolve) => {
    const r = rdv ?? { type: chantier ? "travaux" : "rdv", titre: chantier?.titre ?? "", journee: !!chantier, lieu: chantier?.lieu ?? "", notes: "", chantier_id: chantier?.id ?? null, client_id: chantier?.client_id ?? null };
    const carnet = [...(clients ?? [])].sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    const d1 = rdv ? rdv.debut : new Date(`${jour ?? isoJour(new Date())}T08:00:00`);
    const d2 = rdv ? rdv.fin : new Date(`${jour ?? isoJour(new Date())}T10:00:00`);
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    fond.innerHTML = `<form class="dialogue dialogue-rdv">
      <h3>${rdv ? "Rendez-vous" : "Nouveau rendez-vous"}</h3>
      <div class="types-rdv">${Object.entries(typesRdv()).map(([id, t]) => `<button type="button" class="puce" data-type-rdv="${id}">${t.icone} ${t.nom}</button>`).join("")}</div>
      <label>Quoi <input name="titre" maxlength="200" required placeholder="Ex. : Visite Mme Martin, peinture séjour"></label>
      <label>Client <select name="client"><option value="">— aucun —</option>${carnet.map((c) => `<option value="${esc(c.id)}">${esc(c.nom || "Sans nom")}</option>`).join("")}</select></label>
      <p class="coord-client aide" hidden></p>
      <label>Chantier <select name="chantier"><option value="">— aucun —</option>${donneesAgenda.chantiers.map((c) => `<option value="${esc(c.id)}">${esc(c.titre || "Chantier sans titre")}</option>`).join("")}</select></label>
      <div class="ligne-rdv"><label>Le <input type="date" name="jour" required></label><label class="case-accord"><input type="checkbox" name="journee"><span>Journée(s) entière(s)</span></label></div>
      <div class="ligne-rdv heures-rdv"><label>De <input type="time" name="h1" step="900"></label><label>à <input type="time" name="h2" step="900"></label></div>
      <div class="ligne-rdv jusqua-rdv"><label>Jusqu'au <input type="date" name="jusqua"></label></div>
      <label>Lieu <input name="lieu" maxlength="300" placeholder="Adresse du chantier"></label>
      <label>Notes <textarea name="notes" maxlength="2000" rows="2"></textarea></label>
      <div class="dialogue-actions">
        ${rdv ? `<button type="button" class="supprimer-rdv danger-texte">Supprimer</button>` : ""}
        <button type="button" class="annuler">Annuler</button>
        <button class="valider btn-principal">Enregistrer</button>
      </div></form>`;
    const f = fond.querySelector("form");
    const champs = f.elements;
    let type = r.type;
    const majType = () => {
      for (const b of f.querySelectorAll("[data-type-rdv]")) b.classList.toggle("choisie", b.dataset.typeRdv === type);
    };
    const majJournee = () => {
      f.querySelector(".heures-rdv").hidden = champs.journee.checked;
      f.querySelector(".jusqua-rdv").hidden = !champs.journee.checked;
    };
    for (const b of f.querySelectorAll("[data-type-rdv]")) {
      b.onclick = () => {
        type = b.dataset.typeRdv;
        if (type === "travaux" && !rdv) champs.journee.checked = true;
        majType();
        majJournee();
      };
    }
    champs.titre.value = r.titre;
    champs.chantier.value = r.chantier_id ?? "";
    champs.client.value = r.client_id ?? "";
    // Client du carnet : ses coordonnées sont rappelées et son adresse remplit le lieu.
    const zoneCoord = f.querySelector(".coord-client");
    let lieuAuto = "";
    let titreAuto = "";
    const majClient = (remplir) => {
      const c = carnet.find((x) => x.id === champs.client.value);
      zoneCoord.hidden = !c;
      zoneCoord.innerHTML = c
        ? [c.telephone && `📞 <a href="tel:${esc(c.telephone.replace(/[^\d+]/g, ""))}">${esc(c.telephone)}</a>`, c.email && `✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, c.adresse && `📍 ${esc(c.adresse.replace(/\n/g, ", "))}`].filter(Boolean).join("<br>") || "Pas de coordonnées dans sa fiche."
        : "";
      if (!remplir || !c) return;
      const adresse = (c.adresse || "").replace(/\n/g, ", ");
      if (adresse && (!champs.lieu.value.trim() || champs.lieu.value === lieuAuto)) {
        champs.lieu.value = adresse;
        lieuAuto = adresse;
      }
      if (!champs.titre.value.trim() || champs.titre.value === titreAuto) {
        titreAuto = `${typesRdv()[type]?.nom ?? "RDV"} – ${c.nom}`;
        champs.titre.value = titreAuto;
      }
    };
    champs.client.onchange = () => majClient(true);
    majClient(false);
    champs.jour.value = isoJour(d1);
    champs.journee.checked = !!r.journee;
    champs.h1.value = heure(d1);
    champs.h2.value = heure(d2);
    champs.jusqua.value = isoJour(d2);
    champs.lieu.value = r.lieu ?? "";
    champs.notes.value = r.notes ?? "";
    champs.journee.onchange = majJournee;
    champs.chantier.onchange = () => {
      const c = donneesAgenda.chantiers.find((x) => x.id === champs.chantier.value);
      if (c && !champs.titre.value.trim()) champs.titre.value = c.titre;
      if (c?.client_id && !champs.client.value) {
        champs.client.value = c.client_id;
        majClient(true);
      }
    };
    majType();
    majJournee();
    const fermer = (v) => {
      fond.remove();
      resolve(v);
    };
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.onclick = (e) => {
      if (e.target === fond) fermer(null);
    };
    fond.querySelector(".supprimer-rdv")?.addEventListener("click", async () => {
      if (!(await demander("Supprimer ce rendez-vous ?", { ok: "Supprimer", danger: true }))) return;
      const { error } = await sb.from("rendez_vous").delete().eq("id", rdv.id);
      if (error) return erreur("Suppression impossible.", error);
      fermer(true);
      apresChangementAgenda();
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const jourChoisi = champs.jour.value;
      let debut;
      let fin;
      if (champs.journee.checked) {
        debut = new Date(`${jourChoisi}T00:00:00`);
        fin = new Date(`${champs.jusqua.value && champs.jusqua.value >= jourChoisi ? champs.jusqua.value : jourChoisi}T23:59:00`);
      } else {
        debut = new Date(`${jourChoisi}T${champs.h1.value || "08:00"}:00`);
        fin = new Date(`${jourChoisi}T${champs.h2.value || "10:00"}:00`);
        if (fin <= debut) fin = new Date(debut.getTime() + 3600e3);
      }
      if (Number.isNaN(debut.getTime())) return notifier("Date incorrecte.", "erreur");
      const ligne = {
        type,
        titre: champs.titre.value.trim().slice(0, 200),
        chantier_id: champs.chantier.value || null,
        client_id: champs.client.value || null,
        journee: champs.journee.checked,
        debut: debut.toISOString(),
        fin: fin.toISOString(),
        lieu: champs.lieu.value.trim().slice(0, 300),
        notes: champs.notes.value.trim().slice(0, 2000),
        updated_at: new Date().toISOString(),
      };
      const { error } = rdv ? await sb.from("rendez_vous").update(ligne).eq("id", rdv.id) : await sb.from("rendez_vous").insert(ligne);
      if (error) return erreur("Rendez-vous non enregistré (connexion ?).", error);
      fermer(true);
      notifier("Rendez-vous enregistré.");
      vueAgenda.date = debut;
      apresChangementAgenda();
    };
    document.body.appendChild(fond);
    if (!rdv) champs.titre.focus();
  });
}

function apresChangementAgenda() {
  if (!$("#vue-agenda").hidden) afficherAgenda();
  if (!$("#vue-fiche").hidden && ficheDonnees) afficherRdvFiche(ficheDonnees.ch);
}

// Fiche chantier : ses prochains rendez-vous + bouton « Planifier ».
async function afficherRdvFiche(ch) {
  const zone = $("#rdv-fiche");
  const { data } = await sb.from("rendez_vous").select("*").eq("chantier_id", ch.id).gte("fin", jourSeul(new Date()).toISOString()).order("debut").limit(10);
  if (ficheDonnees?.ch.id !== ch.id) return;
  const l = (data ?? []).map((r) => ({ ...r, debut: new Date(r.debut), fin: new Date(r.fin) }));
  zone.innerHTML = l.length
    ? `<h3>📅 Prévu</h3>${l.map((x) => `<div class="ligne-rdv-fiche">${htmlElementAgenda(x, jourSeul(x.debut)).replace("<span class=\"heure-rdv\">", `<span class="heure-rdv">${esc(nomJour(x.debut))} · `)}</div>`).join("")}`
    : "";
  for (const b of zone.querySelectorAll("[data-rdv]")) {
    b.onclick = async () => {
      if (!donneesAgenda.chantiers.length) await chargerAgenda().catch(() => {});
      editerRdv(l.find((r) => r.id === b.dataset.rdv));
    };
  }
}

async function planifierChantier() {
  const { ch, devis } = ficheDonnees;
  if (!donneesAgenda.chantiers.length) await chargerAgenda().catch(() => {});
  if (!donneesAgenda.chantiers.some((c) => c.id === ch.id)) donneesAgenda.chantiers.unshift({ id: ch.id, titre: ch.titre, client_id: ch.client_id ?? null });
  const lie = await clientParId(ch.client_id);
  const lieu = (devis?.contenu.adresse_chantier || devis?.contenu.client_adresse || lie?.adresse || "").replace(/\n/g, ", ");
  if (!clients) await chargerClients().catch(() => {});
  const client = lie ?? (devis?.contenu.client_nom ? trouverClient({ nom: devis.contenu.client_nom, email: devis.contenu.client_email }) : null);
  editerRdv(null, { jour: isoJour(new Date()), chantier: { id: ch.id, titre: ch.titre, lieu, client_id: client?.id ?? null } });
}
$("#planifier-fiche").onclick = planifierChantier;
$("#planifier-fiche-menu").onclick = () => {
  $("#vue-fiche .menu-plus").open = false;
  planifierChantier();
};

// Abonnement : le planning Cagot dans Google Agenda / l'agenda de l'iPhone / Outlook.
async function abonnementAgenda(nouveau = false) {
  if (nouveau && !(await demander("Créer un nouveau lien ? L'ancien lien ne fonctionnera plus (à refaire sur chaque téléphone abonné).", { ok: "Nouveau lien", danger: true }))) return;
  const { data: jeton, error } = await sb.rpc("lien_agenda", { p_nouveau: nouveau });
  if (error || !jeton) return erreur("Lien d'agenda indisponible (connexion ?).", error);
  const https = `${plateforme.agendaUrl}?t=${jeton}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  const fond = document.createElement("div");
  fond.className = "dialogue-fond";
  fond.innerHTML = `<div class="dialogue dialogue-abonnement">
    <h3>📲 Mon planning dans mon téléphone</h3>
    <p class="aide">Tes rendez-vous, jours de chantier et échéances de factures apparaissent dans ton agenda habituel et se mettent à jour tout seuls (environ toutes les heures).</p>
    <a class="btn-principal bouton-large" target="_blank" rel="noopener" href="${esc(google)}">Google Agenda (Android)</a>
    <a class="btn-secondaire bouton-large" href="${esc(webcal)}">iPhone / iPad / Mac</a>
    <button type="button" class="btn-secondaire bouton-large copier-lien">📋 Copier le lien (Outlook, autre)</button>
    <p class="aide">Ce lien est personnel : ne le partage pas. Sur Google, l'ajout se fait une fois depuis le navigateur ; ensuite l'agenda apparaît dans l'appli Google Agenda (pense à le cocher dans la liste des agendas).</p>
    <div class="dialogue-actions"><button type="button" class="lien nouveau-lien">Changer le lien</button><button type="button" class="valider btn-principal">Fermer</button></div>
  </div>`;
  const fermer = () => fond.remove();
  fond.onclick = (e) => {
    if (e.target === fond) fermer();
  };
  fond.querySelector(".valider").onclick = fermer;
  fond.querySelector(".copier-lien").onclick = async () => {
    try {
      await navigator.clipboard.writeText(https);
      notifier("Lien copié : colle-le dans « Ajouter un agenda → À partir d'une URL ».");
    } catch {
      prompt("Copie ce lien :", https);
    }
  };
  fond.querySelector(".nouveau-lien").onclick = () => {
    fermer();
    abonnementAgenda(true);
  };
  document.body.appendChild(fond);
}
$("#abonnement-agenda").onclick = () => abonnementAgenda();

// --- Historique d'envoi : à qui, quand et comment chaque devis / facture est parti ---
async function noterEnvoi(d, destinataires, moyen) {
  const { error } = await sb.from("envois_documents").insert({ document_id: d.id, destinataires: destinataires.slice(0, 20), moyen });
  if (error) console.error(error);
  if (docCourant?.id === d.id) afficherHistoriqueEnvois(d);
}

async function afficherHistoriqueEnvois(d) {
  const zone = $("#historique-envois");
  const [envois, paiements] = await Promise.all([
    sb.from("envois_documents").select("destinataires, moyen, created_at").eq("document_id", d.id).order("created_at", { ascending: false }).limit(20),
    d.type === "facture" ? sb.from("paiements").select("montant, date_paiement, mode").eq("document_id", d.id).order("date_paiement") : { data: [] },
  ]);
  if (docCourant?.id !== d.id) return;
  const data = envois.error ? [] : envois.data ?? [];
  const regles = paiements.error ? [] : paiements.data ?? [];
  if (!data.length && !regles.length) {
    zone.hidden = true;
    return;
  }
  zone.hidden = false;
  zone.innerHTML = `${regles.length ? `<strong>💶 Paiements</strong><ul>${regles.map((p) => `<li>${euros(p.montant)} reçu le ${dateFr(p.date_paiement)} · ${esc(MODES_PAIEMENT[p.mode] ?? p.mode)}</li>`).join("")}</ul>` : ""}${data.length ? `<strong>📨 Historique d'envoi</strong>` : ""}<ul>${data
    .map((x) => {
      const quand = `${dateFr(x.created_at)} à ${heureFr(x.created_at)}`;
      const qui = x.destinataires.length ? esc(x.destinataires.join(", ")) : "";
      return x.moyen === "email"
        ? `<li>✉️ Envoyé par e-mail le ${quand}${qui ? ` à <b>${qui}</b>` : ""}</li>`
        : `<li>📤 Partagé depuis le téléphone (Gmail, WhatsApp…) le ${quand}${qui ? ` · adresse copiée : <b>${qui}</b>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

$("#partager").onclick = async () => {
  const d = docCourant;
  const e = profil.infos;
  const nom = d.type === "facture" ? (d.contenu.avoir ? "l'avoir" : "la facture") : "le devis";
  // Devis pas encore accepté : on ajoute le lien pour le signer en ligne (si le serveur le permet).
  let lien = "";
  if (d.type === "devis" && ["brouillon", "envoye"].includes(d.statut)) lien = await lienSignature(d).catch(() => "");
  const options = d.contenu.sections?.some((s) => s.lignes?.some((l) => l.option));
  const texte = `Bonjour,\n\nVeuillez trouver ci-joint ${nom} n° ${d.numero ?? "(brouillon)"} (${d.contenu.titre}) d'un montant de ${euros(e.franchise_tva ? d.contenu.total_ht : d.contenu.total_ttc)}${e.franchise_tva ? "" : " TTC"}.${lien ? `\n\nVous pouvez le consulter${options ? ", choisir les options" : ""} et le signer en ligne, directement sur votre téléphone :\n${lien}` : ""}\n\nCordialement,\n${e.nom || ""}${e.telephone ? `\n${e.telephone}` : ""}`;
  const sujet = `${nomDoc(d)} ${d.numero ?? ""} – ${d.contenu.titre}`;
  // Le PDF se prépare pendant qu'on choisit les destinataires.
  const pdfPret = pdfDocument(d).catch((err) => {
    erreur("PDF impossible à fabriquer, envoi du texte seul.", err);
    return null;
  });
  const initiales = emailValide(d.contenu.client_email || "") ? [d.contenu.client_email] : [];
  const destinataires = await demanderDestinataires(initiales);
  if (!destinataires) return;
  // Première adresse saisie alors que le devis n'en avait pas : on la garde comme e-mail du client.
  if (!initiales.length && destinataires.length && !estVerrouille(d)) {
    await majDocument((dv) => {
      dv.client_email = destinataires[0];
    });
  }
  const pdf = await pdfPret;
  // 1) Envoi direct par Cagot (PDF joint, adresses remplies)
  let directTente = false;
  if (plateforme.envoiDirect && pdf && destinataires.length) {
    directTente = true;
    const bouton = $("#partager");
    bouton.disabled = true;
    bouton.innerHTML = "<span>⏳</span>Envoi…";
    try {
      const envoi = await plateforme.envoyerEmail({ destinataires, sujet, texte, pdf, titre: titreFichier(d), copie: !!destinataires.copie }, await jetonAcces());
      if (envoi) {
        noterEnvoi(d, destinataires, "email");
        notifier(`${d.type === "facture" ? "Facture envoyée" : "Devis envoyé"} à ${destinataires.join(", ")}${envoi.copie ? ` · copie envoyée à ${envoi.copie}` : destinataires.copie ? " (la copie pour toi n'a pas pu partir)" : ""}.`);
        if (d.type === "devis" && docCourant.statut === "brouillon") changerStatut("envoye");
        return;
      }
    } catch (err) {
      return erreur(err.message, err);
    } finally {
      bouton.disabled = false;
      bouton.innerHTML = "<span>✉️</span>Mail";
    }
  }
  // 2) Sinon : partage du téléphone (Gmail, WhatsApp…). Après une attente, le téléphone exige
  // un nouvel appui pour ouvrir le partage : on le demande.
  if (directTente && !(await demander("Choisis l'appli pour envoyer le devis (Gmail, WhatsApp…). Le PDF est joint et les adresses sont copiées.", { ok: "📤 Choisir l'appli" }))) return;
  const envoye = await plateforme.partager({ sujet, texte, pdf, titre: titreFichier(d), destinataires, notifier });
  if (envoye) noterEnvoi(d, destinataires, "partage");
  if (envoye && d.type === "devis" && d.statut === "brouillon") changerStatut("envoye");
};

$("#partager-tel").onclick = async () => {
  const d = docCourant;
  try {
    const pdf = await pdfDocument(d);
    await plateforme.partager({ sujet: titreFichier(d), texte: titreFichier(d), pdf, titre: titreFichier(d), notifier });
  } catch (err) {
    erreur("Partage impossible.", err);
  }
};
for (const b of document.querySelectorAll(".menu-plus-liste button")) b.addEventListener("click", () => ($(".menu-plus").open = false));

$("#en-facture").onclick = async () => {
  if (!(await demander("Créer une facture (brouillon) à partir de ce devis ?", { ok: "Créer la facture" }))) return;
  const { suivi, signature_client, hors_etablissement, date_debut, ...base } = structuredClone(docCourant.contenu);
  const contenu = { ...base, hypotheses: [], devis_numero: docCourant.numero };
  const { data, error } = await sb
    .from("documents")
    .insert({ type: "facture", devis_id: docCourant.id, contenu })
    .select("id")
    .single();
  if (error) return erreur("Facture non créée.", error);
  if (docCourant.statut !== "accepte") await mettreStatut(docCourant, "accepte");
  ouvrirDocument(data.id);
};

$("#emettre").onclick = async () => {
  if (!docCourant.contenu.avoir && !docCourant.contenu.date_travaux?.trim()) {
    const quand = await demanderTexte("Date (ou période) des travaux réalisés — obligatoire sur la facture", "Ex. : du 3 au 7 novembre 2026", dateFr(new Date().toISOString()));
    if (!quand) return;
    await majDocument((dv) => (dv.date_travaux = quand));
  }
  if (!(await demander("Émettre la facture ? Elle recevra son numéro définitif et ne pourra plus être modifiée.", { ok: "Émettre" }))) return;
  const { data, error } = await sb.rpc("emettre_facture", { p_id: docCourant.id });
  if (error) return erreur("Émission impossible.", error);
  docCourant = data;
  rendreDocument();
};

// Paiement d'une facture : date, mode et montant, enregistrés pour toujours (journal infalsifiable).
const MODES_PAIEMENT = { virement: "Virement", cheque: "Chèque", especes: "Espèces", carte: "Carte bancaire", autre: "Autre" };
function demanderPaiement(d) {
  return new Promise((resolve) => {
    const fond = document.createElement("div");
    fond.className = "dialogue-fond";
    const aujourd = new Date();
    const iso = `${aujourd.getFullYear()}-${String(aujourd.getMonth() + 1).padStart(2, "0")}-${String(aujourd.getDate()).padStart(2, "0")}`;
    fond.innerHTML = `<form class="dialogue fiche-client"><h3>💶 Paiement de la facture ${esc(d.numero)}</h3>
      <label>Montant reçu (€ TTC) <input name="montant" inputmode="decimal" required value="${nombre(montantDoc(d))}"></label>
      <label>Date du paiement <input name="date" type="date" required value="${iso}" max="${iso}"></label>
      <label>Mode de paiement <select name="mode">${Object.entries(MODES_PAIEMENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <p class="aide">Une fois enregistré, un paiement ne peut plus être modifié (obligation légale). En cas d'erreur, on fait un avoir.</p>
      <div class="dialogue-actions"><button type="button" class="annuler">Annuler</button><button class="valider btn-principal">Enregistrer le paiement</button></div></form>`;
    const fermer = (r) => {
      fond.remove();
      resolve(r);
    };
    fond.querySelector(".annuler").onclick = () => fermer(null);
    fond.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const montant = lireNombre(f.montant.value);
      if (!montant) return notifier("Montant invalide.", "erreur");
      fermer({ montant, date_paiement: f.date.value, mode: f.mode.value });
    };
    document.body.appendChild(fond);
  });
}

async function enregistrerPaiement(d) {
  const p = await demanderPaiement(d);
  if (!p) return null;
  const { error } = await sb.from("paiements").insert({ document_id: d.id, ...p });
  if (error && !/paiements/.test(error.message ?? "")) return erreur("Paiement non enregistré.", error);
  return mettreStatut(d, "payee");
}

// Avoir : nouvelle facture (brouillon) aux montants négatifs, qui annule la facture émise.
$("#faire-avoir").onclick = async () => {
  const f = docCourant;
  if (!(await demander(`Faire un avoir qui annule la facture ${f.numero} (${euros(montantDoc(f))}) ? Tu pourras le vérifier avant de l'émettre.`, { ok: "Faire l'avoir" }))) return;
  const { suivi, date_travaux, hypotheses, ...base } = structuredClone(f.contenu);
  const contenu = calculerTotaux({
    ...base,
    hypotheses: [],
    avoir: true,
    facture_origine: f.numero,
    facture_origine_date: f.date_document,
    titre: `Avoir – ${base.titre}`,
    sections: (base.sections ?? []).map((s) => ({ ...s, lignes: (s.lignes ?? []).filter((l) => !l.option || l.option_retenue).map((l) => ({ ...l, quantite: -Math.abs(l.quantite) })) })),
  });
  const { data, error } = await sb.from("documents").insert({ type: "facture", devis_id: f.devis_id, contenu }).select("id").single();
  if (error) return erreur("Avoir non créé.", error);
  notifier("Avoir créé en brouillon : vérifie-le puis émets-le.");
  ouvrirDocument(data.id);
};

$("#payee").onclick = async () => {
  const data = await enregistrerPaiement(docCourant);
  if (!data) return;
  docCourant = data;
  rendreDocument();
  notifier("Paiement enregistré 💶");
};

$("#modifier-ia").onclick = async () => {
  const d = docCourant;
  if (conversation.docId !== d.id) {
    // Le chantier qui a produit ce devis, s'il existe encore
    const { data: existants } = await sb
      .from("chantiers")
      .select("*")
      .eq("document_id", d.id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (existants?.length) ouvrirConversation(existants[0]);
  }
  if (conversation.docId !== d.id) {
    conversation = {
      titre: [d.contenu.titre, d.contenu.client_nom].filter(Boolean).join(" – "),
      docId: d.id,
      historique: d.conversation?.length
        ? d.conversation
        : [
            { role: "user", texte: `Voici le devis actuel ${d.numero} à modifier :\n${JSON.stringify(d.contenu)}` },
            { role: "assistant", texte: "Ok, j'ai le devis sous les yeux. Qu'est-ce qu'on change ?", questions: [] },
          ],
    };
    sauverConversation();
    reafficherConversation();
  }
  montrerListeChantiers(false);
  afficherVue("chantier");
  $("#texte").focus();
};

$("#supprimer").onclick = async () => {
  if (!(await demander(`Supprimer définitivement ${docCourant.numero || "ce brouillon"} ?`, { ok: "Supprimer", danger: true }))) return;
  const { error } = await sb.from("documents").delete().eq("id", docCourant.id);
  if (error) return erreur("Suppression impossible.", error);
  if (conversation.docId === docCourant.id) {
    conversation.docId = null;
    sauverConversation();
  }
  afficherVue("documents");
};

// ---------------------------------------------------------------------------
// Réglages : entreprise, métiers et grille de prix
// ---------------------------------------------------------------------------
function afficherParametres() {
  const form = $("#form-entreprise");
  for (const champ of form.elements) {
    if (!champ.name || champ.name === "labels") continue;
    if (champ.type === "checkbox") champ.checked = !!profil.infos[champ.name];
    else if (champ.type === "radio") champ.checked = champ.value === modeleDe(profil.infos);
    else if (profil.infos[champ.name] !== undefined) champ.value = profil.infos[champ.name];
  }
  afficherLogo(profil.infos.logo);
  afficherLabels(labelsDe(profil.infos));
  afficherNumeros();
  $("#liste-metiers").innerHTML = CORPS_ETAT.map(
    (c) => `<label><input type="checkbox" value="${esc(c.id)}" ${profil.metiers.includes(c.id) ? "checked" : ""}> ${esc(c.nom)}</label>`,
  ).join("");
  rendreTarifs();
}

function afficherLogo(logo) {
  const ok = logoValide(logo);
  $("#form-entreprise [name=logo]").value = ok ? logo : "";
  $("#apercu-logo").hidden = !ok;
  if (ok) $("#apercu-logo").src = logo;
  else $("#apercu-logo").removeAttribute("src");
  $("#sans-logo").hidden = ok;
  $("#retirer-logo").hidden = !ok;
  $("#couleur-logo").hidden = !ok;
}

// Couleur principale d'un logo déjà enregistré (image en data URL).
async function couleurDuLogo(logo) {
  const img = await new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = logo;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return couleurDominante(ctx.getImageData(0, 0, c.width, c.height));
}

$("#couleur-logo").onclick = async () => {
  try {
    const couleur = await couleurDuLogo($("#form-entreprise [name=logo]").value);
    if (!couleur) return notifier("Ton logo est noir et blanc : choisis la couleur à la main.");
    $("#form-entreprise [name=couleur]").value = couleur;
    notifier("Couleur du logo appliquée : appuie sur « Enregistrer ».");
  } catch (err) {
    erreur("Couleur du logo introuvable.", err);
  }
};

$("#fichier-logo").onchange = async (ev) => {
  const fichier = ev.target.files?.[0];
  ev.target.value = "";
  if (!fichier) return;
  try {
    const { donnees, couleur } = await preparerLogo(fichier);
    afficherLogo(donnees);
    if (couleur) $("#form-entreprise [name=couleur]").value = couleur;
    notifier(couleur ? "Logo détouré et couleur reprise du logo : appuie sur « Enregistrer »." : "Logo prêt : appuie sur « Enregistrer ».");
  } catch (err) {
    erreur("Ce fichier n'est pas une image utilisable (PNG ou JPEG).", err);
  }
};
$("#retirer-logo").onclick = () => afficherLogo("");

// --- Labels (RGE, Qualibat…) : petites images détourées, gardées dans les infos de l'entreprise
function labelsFormulaire() {
  return labelsDe({ labels: $("#form-entreprise [name=labels]").value });
}
function afficherLabels(labels) {
  $("#form-entreprise [name=labels]").value = JSON.stringify(labels);
  $("#liste-labels").innerHTML = labels.length
    ? labels.map((l, i) => `<div class="label-reglage"><img src="${esc(l)}" alt="Label ${i + 1}"><button type="button" class="lien danger" data-retirer-label="${i}" aria-label="Retirer ce label">✕</button></div>`).join("")
    : `<p class="aide">Aucun label pour l'instant.</p>`;
  $("#ajouter-label").hidden = labels.length >= LABELS_MAX;
  for (const b of $("#liste-labels").querySelectorAll("[data-retirer-label]")) {
    b.onclick = () => {
      const l = labelsFormulaire();
      l.splice(Number(b.dataset.retirerLabel), 1);
      afficherLabels(l);
      notifier("Label retiré : appuie sur « Enregistrer ».");
    };
  }
}
$("#fichier-label").onchange = async (ev) => {
  const fichier = ev.target.files?.[0];
  ev.target.value = "";
  if (!fichier) return;
  try {
    const { donnees } = await preparerLogo(fichier, { largeur: 320, hauteur: 160 });
    afficherLabels([...labelsFormulaire(), donnees].slice(0, LABELS_MAX));
    notifier("Label ajouté : appuie sur « Enregistrer ».");
  } catch (err) {
    erreur("Ce fichier n'est pas une image utilisable (PNG ou JPEG).", err);
  }
};

// --- Numérotation : aperçu des prochains numéros et reprise depuis un autre logiciel
async function afficherNumeros() {
  const zone = $("#apercu-numeros");
  const { data, error } = await sb.rpc("numerotation");
  if (error) {
    zone.textContent = "";
    $("#reprendre-numeros").hidden = true;
    return null;
  }
  zone.innerHTML = `Prochain devis : <strong>${esc(data.devis)}</strong> · prochaine facture : <strong>${esc(data.facture)}</strong>`;
  $("#reprendre-numeros").hidden = false;
  return data;
}
$("#reprendre-numeros").onclick = async () => {
  const data = await afficherNumeros();
  if (!data) return erreur("Numérotation indisponible (connexion ?).");
  const saisie = await demanderTexte(
    `Numéro de ta prochaine facture ${new Date().getFullYear()} (ex. : ta dernière était la n° 57 → tape 58)`,
    "Numéro",
    String(data.facture_suivante),
  );
  if (saisie === null) return;
  const n = Number(String(saisie).replace(/\D/g, ""));
  if (!n || n < data.facture_suivante) return erreur(`Le numéro ne peut qu'avancer (au moins ${data.facture_suivante}) : sinon deux factures auraient le même numéro.`);
  const { error } = await sb.rpc("numerotation", { p_prochain_facture: n });
  if (error) return erreur("Numérotation non modifiée.", error);
  await afficherNumeros();
  notifier("Numérotation des factures mise à jour.");
};

$("#form-entreprise").onsubmit = async (ev) => {
  ev.preventDefault();
  const infos = { ...profil.infos }; // garde ce qui n'est pas dans le formulaire (interface…)
  for (const champ of ev.target.elements) {
    if (!champ.name) continue;
    if (champ.type === "radio") {
      if (champ.checked) infos[champ.name] = champ.value;
      continue;
    }
    infos[champ.name] = champ.type === "checkbox" ? champ.checked : champ.value.trim();
  }
  infos.labels = labelsDe(infos);
  for (const k of ["prefixe_devis", "prefixe_facture"]) {
    infos[k] = (infos[k] || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    ev.target.elements[k].value = infos[k];
  }
  const metiers = [...$("#liste-metiers").querySelectorAll("input:checked")].map((i) => i.value);
  const { error } = await sb.from("entreprises").upsert({ user_id: utilisateur.id, infos, metiers, updated_at: new Date().toISOString() });
  if (error) return erreur("Informations non enregistrées.", error);
  profil = { infos, metiers };
  notifier("Informations enregistrées.");
  afficherNumeros();
};

function optionsCorps(selection) {
  return [`<option value="">— Autre —</option>`, ...CORPS_ETAT.map((c) => `<option value="${esc(c.id)}" ${c.id === selection ? "selected" : ""}>${esc(c.nom)}</option>`)].join("");
}

const UNITES = ["m²", "ml", "u", "m³", "h", "jour", "forfait", "ens", "kg"];
let rechercheTarifs = "";
const groupesFermes = new Set();

// Grille de prix en cartes (lisible sur téléphone) : nom complet sur plusieurs lignes,
// prix et unité en dessous, rangée par métier, avec recherche.
// Hauteur des noms de prestation selon leur texte. Calculée seulement quand l'onglet « Tarifs »
// est affiché : sur un onglet caché, la hauteur mesurée vaut 0 et le texte était coupé.
function ajusterHauteur(champ) {
  if (!champ.offsetParent) return;
  champ.style.height = "auto";
  champ.style.height = `${champ.scrollHeight + 2}px`;
}
const ajusterNomsTarifs = () => document.querySelectorAll("#grille-tarifs textarea[data-k]").forEach(ajusterHauteur);
window.addEventListener("resize", ajusterNomsTarifs);

function rendreTarifs() {
  const zone = $("#grille-tarifs");
  if (!tarifs.length) {
    zone.innerHTML = `<p class="aide">Aucun prix pour l'instant. Ajoute tes prix habituels : l'IA les utilisera en priorité.</p>`;
    return;
  }
  const filtre = normaliser(rechercheTarifs);
  const visibles = tarifs.filter((t) => !filtre || normaliser(t.designation).includes(filtre));
  const comptes = new Map();
  for (const t of tarifs) {
    const cle = `${normaliser(t.designation)}|${t.unite}`;
    comptes.set(cle, (comptes.get(cle) ?? 0) + 1);
  }
  const groupes = new Map();
  for (const t of visibles) {
    if (!groupes.has(t.corps_etat)) groupes.set(t.corps_etat, []);
    groupes.get(t.corps_etat).push(t);
  }
  const unites = (u) => [...new Set([...UNITES, u].filter(Boolean))].map((x) => `<option ${x === u ? "selected" : ""}>${esc(x)}</option>`).join("");
  zone.innerHTML = `
    <input type="search" id="recherche-tarifs" class="recherche-tarifs" placeholder="🔍 Chercher un prix…" value="${esc(rechercheTarifs)}">
    ${
      visibles.length
        ? [...groupes]
            .sort(([a], [b]) => (a ? nomCorpsEtat(a) : "zzz").localeCompare(b ? nomCorpsEtat(b) : "zzz", "fr"))
            .map(
              ([corps, liste]) => `<details class="groupe-tarifs" data-groupe="${esc(corps)}" ${groupesFermes.has(corps) && !filtre ? "" : "open"}>
          <summary>${esc(corps ? nomCorpsEtat(corps) : "Sans métier")} <span class="nb">${liste.length}</span></summary>
          ${liste
            .map(
              (t) => `<div class="carte-tarif">
              <textarea data-id="${esc(t.id)}" data-k="designation" rows="1" maxlength="300" placeholder="Nom de la prestation (ex : Pose de placo BA13)">${esc(t.designation)}</textarea>
              ${comptes.get(`${normaliser(t.designation)}|${t.unite}`) > 1 && t.designation ? `<p class="doublon">⚠️ En double : supprime celui en trop avec 🗑️</p>` : ""}
              <div class="ligne-prix">
                <label class="champ-prix"><input data-id="${esc(t.id)}" data-k="prix" inputmode="decimal" value="${nombre(t.prix)}" aria-label="Prix HT"><span>€ HT</span></label>
                <span class="par">par</span>
                <select data-id="${esc(t.id)}" data-k="unite" aria-label="Unité">${unites(t.unite)}</select>
                <button class="suppr-tarif" data-suppr-tarif="${esc(t.id)}" aria-label="Supprimer ce prix">🗑️</button>
              </div>
              <select data-id="${esc(t.id)}" data-k="corps_etat" class="choix-metier" aria-label="Métier">${optionsCorps(t.corps_etat).replace("— Autre —", "Métier : à choisir")}</select>
            </div>`,
            )
            .join("")}
        </details>`,
            )
            .join("")
        : `<p class="aide">Aucun prix ne correspond à « ${esc(rechercheTarifs)} ».</p>`
    }`;

  const recherche = $("#recherche-tarifs");
  recherche.oninput = () => {
    rechercheTarifs = recherche.value;
    const pos = recherche.selectionStart;
    rendreTarifs();
    const r = $("#recherche-tarifs");
    r.focus();
    r.setSelectionRange(pos, pos);
  };
  for (const d of zone.querySelectorAll("details[data-groupe]")) {
    d.ontoggle = () => {
      if (d.open) {
        groupesFermes.delete(d.dataset.groupe);
        ajusterNomsTarifs();
      } else groupesFermes.add(d.dataset.groupe);
    };
  }
  for (const champ of zone.querySelectorAll("textarea[data-k]")) champ.addEventListener("input", () => ajusterHauteur(champ));
  ajusterNomsTarifs();
  for (const champ of zone.querySelectorAll("[data-k]")) {
    champ.onchange = async () => {
      const valeur = champ.dataset.k === "prix" ? lireNombre(champ.value) : champ.value.trim();
      const { data, error } = await sb.from("tarifs").update({ [champ.dataset.k]: valeur }).eq("id", champ.dataset.id).select("*").single();
      if (error) return erreur("Prix non enregistré.", error);
      tarifs = tarifs.map((t) => (t.id === data.id ? data : t));
      if (champ.dataset.k === "prix") champ.value = nombre(data.prix);
      // Seul un changement de métier déplace la carte (pas de re-rendu pendant la saisie).
      if (champ.dataset.k === "corps_etat") rendreTarifs();
      notifier("Prix enregistré ✓");
    };
  }
  for (const b of zone.querySelectorAll("[data-suppr-tarif]")) {
    b.onclick = async () => {
      const t = tarifs.find((x) => x.id === b.dataset.supprTarif);
      if (t?.designation && !(await demander(`Supprimer « ${t.designation} » de ta grille ?`, { ok: "Supprimer", danger: true }))) return;
      const { error } = await sb.from("tarifs").delete().eq("id", b.dataset.supprTarif);
      if (error) return erreur("Suppression impossible.", error);
      tarifs = tarifs.filter((x) => x.id !== b.dataset.supprTarif);
      rendreTarifs();
    };
  }
}

$("#ajouter-tarif").onclick = async () => {
  const { data, error } = await sb
    .from("tarifs")
    .insert({ corps_etat: "", designation: "", unite: "m²", prix: 0 })
    .select("*")
    .single();
  if (error) return erreur("Impossible d'ajouter un prix.", error);
  tarifs.push(data);
  rechercheTarifs = "";
  groupesFermes.delete("");
  rendreTarifs();
  const champ = $(`#grille-tarifs textarea[data-id="${data.id}"]`);
  champ?.scrollIntoView({ behavior: "smooth", block: "center" });
  champ?.focus();
};
