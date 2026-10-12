import { calculerTotaux } from "/calcul.js";
import { CORPS_ETAT, nomCorpsEtat } from "/corps-etat.js";
import { demarrerPlateforme } from "/plateforme.js";

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
    fond.onclick = (e) => e.target === fond && fermer(false);
    document.body.appendChild(fond);
    fond.querySelector(".valider").focus();
  });
}

// ---------------------------------------------------------------------------
// Connexion (Supabase Auth)
// ---------------------------------------------------------------------------
const plateforme = await demarrerPlateforme();
const { sb } = plateforme;
$("#bandeau-demo").hidden = !plateforme.demo;
$("#bandeau-essai").hidden = !plateforme.essai;
$("#carte-compte").hidden = plateforme.essai;
$("#micro").hidden = !plateforme.dictee;
$("#micro-note").hidden = !plateforme.dictee;
$("#option-mains-libres").hidden = !plateforme.dictee;
$("#imprimer").textContent = plateforme.libelleExport;
$("#photo").closest("label").hidden = plateforme.photos === false;
$("#photo-note").closest("label").hidden = plateforme.photos === false;

let utilisateur = null;
let modeConnexion = "connexion";

function afficherModeConnexion(mode) {
  modeConnexion = mode;
  const titres = { connexion: "Connexion", inscription: "Créer un compte", oubli: "Mot de passe oublié" };
  const boutons = { connexion: "Se connecter", inscription: "Créer mon compte", oubli: "Recevoir un lien par e-mail" };
  $("#titre-connexion").textContent = titres[mode];
  $("#btn-connexion").textContent = boutons[mode];
  $("#champ-mdp").hidden = mode === "oubli";
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
      const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
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
  if (utilisateur) local.effacer(`conversation.${utilisateur.id}`);
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
}

async function demarrerSession() {
  $("#navigation").hidden = false;
  $("#email-compte").textContent = utilisateur.email;
  try {
    await chargerProfil();
  } catch (err) {
    erreur("Impossible de charger tes données. Vérifie ta connexion internet.", err);
  }
  conversation = local.lire(`conversation.${utilisateur.id}`, { historique: [], docId: null });
  reafficherConversation();
  afficherVue(profil.infos.nom ? "notes" : "parametres");
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function afficherVue(nom) {
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== `vue-${nom}`;
  for (const b of document.querySelectorAll(".barre nav button")) {
    const parent = { document: "documents", note: "notes" }[nom];
    b.classList.toggle("actif", b.dataset.vue === nom || b.dataset.vue === parent);
  }
  if (nom !== "note") quitterNote();
  if (nom === "notes") afficherNotes();
  if (nom === "documents") afficherListe();
  if (nom === "parametres") afficherParametres();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll(".barre nav button")) b.onclick = () => afficherVue(b.dataset.vue);

// ---------------------------------------------------------------------------
// Voix : dictée (reconnaissance vocale) et synthèse vocale
// ---------------------------------------------------------------------------
const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
let reco = null;
let texteAvantDictee = "";

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

function redimensionner(fichier, max = 1600) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = ko;
    img.src = URL.createObjectURL(fichier);
  });
}

function afficherPhotosEnAttente() {
  const html = photosEnAttente.map((p) => `<img src="${p}" alt="note">`).join("");
  $("#apercu-photos").innerHTML = html;
  $("#photos-note").innerHTML = html;
}

$("#photo").onchange = $("#photo-note").onchange = async (e) => {
  for (const f of e.target.files) photosEnAttente.push(await redimensionner(f));
  e.target.value = "";
  afficherPhotosEnAttente();
};

// ---------------------------------------------------------------------------
// Conversation avec l'IA
// ---------------------------------------------------------------------------
// Les photos restent en mémoire pendant la session mais ne sont pas sauvegardées (trop lourdes).
let conversation = { historique: [], docId: null };

const historiqueSansPhotos = (historique) =>
  historique.map(({ images, ...m }) =>
    images?.length ? { ...m, texte: `${m.texte}\n[${images.length} photo(s) de notes]` } : m,
  );

function sauverConversation() {
  if (!utilisateur) return;
  local.ecrire(`conversation.${utilisateur.id}`, {
    docId: conversation.docId,
    noteId: conversation.noteId ?? null,
    historique: historiqueSansPhotos(conversation.historique),
  });
}

function bulle(classe, html) {
  const div = document.createElement("div");
  div.className = `bulle ${classe}`;
  div.innerHTML = html;
  $("#fil").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

function bulleIa(m) {
  const questions = m.questions?.length ? `<ol>${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : "";
  const bouton = m.docId ? `<br><button class="btn-principal" data-doc="${esc(m.docId)}">Voir le devis</button>` : "";
  const div = bulle("ia", esc(m.texte) + questions + bouton);
  div.querySelector("[data-doc]")?.addEventListener("click", () => ouvrirDocument(m.docId));
}

function reafficherConversation() {
  $("#fil").querySelectorAll(".bulle:not(:first-child)").forEach((b) => b.remove());
  for (const m of conversation.historique) {
    if (m.role === "user") {
      bulle("moi", esc(m.texte) + (m.images ?? []).map((i) => `<img src="${i}" alt="note">`).join(""));
    } else bulleIa(m);
  }
}

async function envoyer() {
  const texte = $("#texte").value.trim();
  if (!texte && photosEnAttente.length === 0) return;
  arreterDictee();
  arreterParole();

  const message = { role: "user", texte, images: photosEnAttente };
  conversation.historique.push(message);
  bulle("moi", esc(texte) + photosEnAttente.map((i) => `<img src="${i}" alt="note">`).join(""));
  $("#texte").value = "";
  photosEnAttente = [];
  afficherPhotosEnAttente();
  $("#envoyer").disabled = true;
  const attente = bulle("ia attente", "Je réfléchis au chantier…");

  try {
    const data = await plateforme.appelerIA(
      {
        historique: conversation.historique.map(({ role, texte, brut, images }) => ({ role, texte, brut, images })),
        entreprise: { nom: profil.infos.nom, metiers: profil.metiers, franchise_tva: !!profil.infos.franchise_tva },
        tarifs: tarifs
          .filter((t) => t.designation)
          .map((t) => ({ corps_etat: t.corps_etat, designation: t.designation, unite: t.unite, prix: Number(t.prix) })),
      },
      await jetonAcces(),
    );
    attente.remove();
    if (data.demo) $("#bandeau-demo").hidden = false;

    const reponse = { role: "assistant", texte: data.message, questions: data.questions, brut: data.brut };
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

$("#nouveau").onclick = async () => {
  if (conversation.historique.length && !(await demander("Commencer un nouveau chantier ? La conversation en cours sera effacée (les devis restent enregistrés).", { ok: "Nouveau chantier" }))) return;
  conversation = { historique: [], docId: null };
  sauverConversation();
  reafficherConversation();
};

async function enregistrerDevis(devis) {
  const histo = historiqueSansPhotos(conversation.historique);
  if (conversation.docId) {
    const { data: existant } = await sb.from("documents").select("contenu").eq("id", conversation.docId).eq("type", "devis").maybeSingle();
    if (existant) {
      const contenu = {
        ...devis,
        client_nom: devis.client_nom || existant.contenu.client_nom,
        client_adresse: devis.client_adresse || existant.contenu.client_adresse,
      };
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
              <span class="extrait">${esc(n.contenu.slice(0, 200))}</span></div>
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
  $("#titre-note").value = noteCourante.titre;
  $("#contenu-note").value = noteCourante.contenu;
  etatNote(copie && copie.updated_at > note.updated_at ? "Modifications locales à enregistrer" : "Enregistrée");
  afficherVue("note");
  if (copie && copie.updated_at > note.updated_at) programmerEnregistrementNote(0);
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
    if (noteCourante?.id === id) etatNote(`Enregistrée à ${heureFr(new Date().toISOString())}`);
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

$("#retour-notes").onclick = () => afficherVue("notes");

$("#micro-note").onclick = () =>
  reco
    ? arreterDictee()
    : demarrerDictee({ cible: $("#contenu-note"), bouton: $("#micro-note"), apresTexte: () => programmerEnregistrementNote() });

$("#supprimer-note").onclick = async () => {
  if (!(await demander("Supprimer cette note ?", { ok: "Supprimer", danger: true }))) return;
  const id = noteCourante.id;
  clearTimeout(minuterieNote);
  noteCourante = null;
  const { error } = await sb.from("notes").delete().eq("id", id);
  if (error) return erreur("Suppression impossible.", error);
  local.effacer(cleNoteLocale(id));
  afficherVue("notes");
};

$("#envoyer-note").onclick = async () => {
  const contenu = $("#contenu-note").value.trim();
  if (!contenu && photosEnAttente.length === 0) return notifier("La note est vide.");
  if (conversation.historique.length && !(await demander("Démarrer un nouveau chantier avec cette note ? La conversation en cours sera effacée (les devis restent enregistrés).", { ok: "Faire le devis" }))) return;
  const note = noteCourante;
  await enregistrerNote();
  await sb.from("notes").update({ envoyee_at: new Date().toISOString() }).eq("id", note.id);
  conversation = { historique: [], docId: null, noteId: note.id };
  sauverConversation();
  reafficherConversation();
  afficherVue("chantier");
  $("#texte").value = note.titre ? `${note.titre}\n\n${contenu}` : contenu;
  envoyer();
};

// ---------------------------------------------------------------------------
// Liste des documents
// ---------------------------------------------------------------------------
const LIBELLES_STATUT = {
  brouillon: "brouillon",
  envoye: "envoyé",
  accepte: "accepté",
  refuse: "refusé",
  emise: "émise",
  payee: "payée",
};

async function afficherListe() {
  $("#liste-documents").innerHTML = `<p class="aide">Chargement…</p>`;
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, type, statut, numero, date_document, contenu")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    $("#liste-documents").innerHTML = `<p class="aide">Impossible de charger les documents (connexion ?).</p>`;
    return;
  }
  $("#liste-documents").innerHTML = docs.length
    ? docs
        .map(
          (d) => `<div class="element-liste" data-id="${esc(d.id)}">
            <div><strong>${esc(d.numero || "Facture brouillon")}</strong> — ${esc(d.contenu.titre)}
              <small>${dateFr(d.date_document)}${d.contenu.client_nom ? ` · ${esc(d.contenu.client_nom)}` : ""}</small></div>
            <div class="droite"><span class="pastille ${d.type}">${d.type} · ${LIBELLES_STATUT[d.statut]}</span><br><strong>${euros(d.contenu.total_ttc)}</strong></div>
          </div>`,
        )
        .join("")
    : `<p class="aide">Aucun document pour l'instant. Va dans « Chantier » pour créer ton premier devis.</p>`;
  for (const el of document.querySelectorAll(".element-liste")) el.onclick = () => ouvrirDocument(el.dataset.id);
}

// ---------------------------------------------------------------------------
// Affichage et édition d'un devis / d'une facture
// ---------------------------------------------------------------------------
let docCourant = null;

async function ouvrirDocument(id) {
  const { data, error } = await sb.from("documents").select("*").eq("id", id).maybeSingle();
  if (error || !data) return erreur("Document introuvable.", error);
  docCourant = data;
  afficherVue("document");
  rendreDocument();
}

const estVerrouille = (d) => d.type === "facture" && d.statut !== "brouillon";

async function majDocument(modif) {
  const contenu = structuredClone(docCourant.contenu);
  modif(contenu);
  const recalcule = calculerTotaux(contenu);
  const { data, error } = await sb.from("documents").update({ contenu: recalcule }).eq("id", docCourant.id).select("*").single();
  if (error) {
    erreur("Modification non enregistrée.", error);
  } else docCourant = data;
  rendreDocument();
}

async function changerStatut(statut) {
  const { data, error } = await sb.from("documents").update({ statut }).eq("id", docCourant.id).select("*").single();
  if (error) return erreur("Statut non modifié.", error);
  docCourant = data;
  rendreDocument();
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
  $("#modifier-ia").hidden = facture;
  $("#emettre").hidden = !(facture && d.statut === "brouillon");
  $("#payee").hidden = !(facture && d.statut === "emise");
  $("#supprimer").hidden = verrouille;

  const info = $("#info-statut");
  if (facture) {
    info.hidden = false;
    info.innerHTML =
      d.statut === "brouillon"
        ? "Facture en <strong>brouillon</strong> : vérifie-la puis clique « Émettre la facture ». Elle recevra alors son numéro définitif et ne pourra plus être modifiée."
        : `Facture <strong>${LIBELLES_STATUT[d.statut]}</strong> : elle est verrouillée (obligation légale). Pour corriger, il faudra faire un avoir.`;
  } else {
    info.hidden = false;
    info.innerHTML = `Statut du devis : <select id="statut-devis">${["brouillon", "envoye", "accepte", "refuse"]
      .map((s) => `<option value="${s}" ${s === d.statut ? "selected" : ""}>${LIBELLES_STATUT[s]}</option>`)
      .join("")}</select>`;
    $("#statut-devis").onchange = (ev) => changerStatut(ev.target.value);
  }

  const estimes = v.sections.flatMap((s) => s.lignes).filter((l) => l.prix_source === "estime").length;
  const hyp = [...(v.hypotheses ?? [])];
  if (estimes && !verrouille) hyp.unshift(`${estimes} prix estimé(s) par l'IA (surlignés en jaune) : vérifie-les et ajoute-les à ta grille.`);
  $("#hypotheses").hidden = hyp.length === 0 || verrouille;
  $("#hypotheses").innerHTML = `<strong>À vérifier avant d'envoyer :</strong><ul>${hyp.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;

  const lignes = v.sections
    .map(
      (s, si) => `
      <tr class="section"><td colspan="5" ${editable} data-champ="section" data-s="${si}">${esc(s.titre)}</td></tr>
      ${s.lignes
        .map((l, li) => {
          const estime = l.prix_source === "estime" && !verrouille;
          return `<tr${estime ? ' class="estime"' : ""}>
            <td><div ${editable} data-champ="designation" data-s="${si}" data-l="${li}">${esc(l.designation)}</div>
              ${l.detail ? `<div class="detail" ${editable} data-champ="detail" data-s="${si}" data-l="${li}">${esc(l.detail)}</div>` : ""}
              ${l.calcul ? `<div class="calcul">${esc(l.calcul)}</div>` : ""}
              ${estime ? `<div class="no-print"><span class="badge-estime">prix estimé</span> <button class="lien" data-grille="${si}-${li}">+ ajouter à ma grille</button></div>` : ""}</td>
            <td class="num" ${editable} data-champ="quantite" data-s="${si}" data-l="${li}">${nombre(l.quantite)}</td>
            <td ${editable} data-champ="unite" data-s="${si}" data-l="${li}">${esc(l.unite)}</td>
            <td class="num" ${editable} data-champ="prix_unitaire_ht" data-s="${si}" data-l="${li}">${nombre(l.prix_unitaire_ht)}</td>
            <td class="num">${euros(l.total_ht)}${verrouille ? "" : ` <button class="suppr-ligne" data-suppr="${si}-${li}" title="Supprimer la ligne">✕</button>`}</td>
          </tr>`;
        })
        .join("")}
      ${verrouille ? "" : `<tr class="ajout-ligne"><td colspan="5"><button class="lien" data-ajout="${si}">+ ajouter une ligne</button></td></tr>`}`,
    )
    .join("");

  const tauxTva = franchise ? 0 : v.taux_tva;
  const tva = franchise ? 0 : v.montant_tva;
  const ttc = franchise ? v.total_ht : v.total_ttc;
  const acompte = Number(e.acompte || 0);

  const mentions = facture
    ? [
        d.statut !== "brouillon" ? `Date d'échéance : ${dateFr(ajouterJours(d.date_document, e.delai_paiement || 30))}.` : "",
        v.devis_numero ? `Facture établie selon le devis n° ${v.devis_numero}.` : "",
        "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.",
        e.iban ? `Règlement par virement : IBAN ${e.iban}` : "",
      ]
    : [
        `Devis valable ${e.validite || 30} jours à compter du ${dateFr(d.date_document)}. Devis gratuit.`,
        acompte ? `Acompte de ${acompte} % à la signature (${euros((ttc * acompte) / 100)}), solde à la fin des travaux.` : "",
        v.duree_estimee ? `Durée estimée des travaux : ${v.duree_estimee}.` : "",
      ];
  if (franchise) mentions.push("TVA non applicable, art. 293 B du CGI.");
  else if (tauxTva < 20) mentions.push(`Taux de TVA réduit de ${nombre(tauxTva)} % appliqué pour des travaux dans un logement achevé depuis plus de 2 ans (art. 279-0 bis / 278-0 bis A du CGI), sur déclaration du client.`);
  if (e.assurance) mentions.push(`Assurance décennale : ${e.assurance}.`);

  const titreDoc = facture
    ? d.numero ? `FACTURE n° ${esc(d.numero)}` : "FACTURE (brouillon, non numérotée)"
    : `DEVIS n° ${esc(d.numero)}`;

  $("#document").innerHTML = `
    <div class="doc-entete">
      <div class="entreprise">
        <strong>${esc(e.nom || "Mon entreprise (à compléter dans Réglages)")}</strong><br>
        ${esc(e.adresse || "").replace(/\n/g, "<br>")}<br>
        ${e.telephone ? `Tél. ${esc(e.telephone)}<br>` : ""}${e.email ? `${esc(e.email)}<br>` : ""}
        ${e.siret ? `SIRET ${esc(e.siret)}<br>` : ""}${e.tva_intra && !franchise ? `TVA ${esc(e.tva_intra)}` : ""}
      </div>
      <div class="client">
        <strong>Client</strong><br>
        <div ${editable} data-champ="client_nom">${esc(v.client_nom) || "<em>Nom du client</em>"}</div>
        <div ${editable} data-champ="client_adresse">${esc(v.client_adresse) || "<em>Adresse du client</em>"}</div>
        ${v.adresse_chantier ? `<small>Chantier : ${esc(v.adresse_chantier)}</small>` : ""}
      </div>
    </div>
    <h2 class="doc-titre">${titreDoc}</h2>
    <div class="doc-meta">Date : ${dateFr(d.date_document)} · Objet : <span ${editable} data-champ="titre">${esc(v.titre)}</span></div>
    <p ${editable} data-champ="description">${esc(v.description)}</p>
    <table class="doc-table">
      <thead><tr><th>Désignation</th><th class="num">Qté</th><th>Unité</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
    <table class="doc-totaux">
      <tr><td>Total HT</td><td class="num">${euros(v.total_ht)}</td></tr>
      ${franchise ? "" : `<tr><td>TVA <span ${editable} data-champ="taux_tva">${nombre(tauxTva)}</span> %</td><td class="num">${euros(tva)}</td></tr>`}
      <tr class="ttc"><td>${franchise ? "Net à payer" : "Total TTC"}</td><td class="num">${euros(ttc)}</td></tr>
    </table>
    <div class="doc-mentions">${mentions.filter(Boolean).map((m) => `<p>${esc(m)}</p>`).join("")}</div>
    ${facture ? "" : `<div class="doc-signature"><div>L'entreprise</div><div>Le client<br><small>Date, signature et mention « Bon pour accord »</small></div></div>`}
  `;

  if (verrouille) return;

  // Édition directe dans le document
  for (const el of $("#document").querySelectorAll("[contenteditable]")) {
    el.addEventListener("focus", () => {
      if (el.querySelector("em")) el.textContent = "";
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
        } else dv[champ] = champ === "taux_tva" ? lireNombre(val) : val;
      });
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        el.blur();
      }
    });
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
      const { data, error } = await sb
        .from("tarifs")
        .insert({ corps_etat: "", designation: ligne.designation.slice(0, 300), unite: ligne.unite.slice(0, 20), prix: ligne.prix_unitaire_ht })
        .select("*")
        .single();
      if (error) return erreur("Prix non ajouté à la grille.", error);
      tarifs.push(data);
      majDocument((dv) => (dv.sections[s].lignes[l].prix_source = "grille"));
    };
  }
}

$("#retour").onclick = () => afficherVue("documents");
$("#imprimer").onclick = async () => {
  try {
    await plateforme.exporterPdf({
      titre: `${docCourant.numero || "brouillon"} ${docCourant.contenu.client_nom || ""}`.trim(),
      document: $("#document"),
    });
  } catch (err) {
    erreur("Export impossible.", err);
  }
};

$("#partager").onclick = async () => {
  const d = docCourant;
  const e = profil.infos;
  const nom = d.type === "facture" ? "la facture" : "le devis";
  const texte = `Bonjour,\n\nVeuillez trouver ci-joint ${nom} n° ${d.numero ?? "(brouillon)"} (${d.contenu.titre}) d'un montant de ${euros(e.franchise_tva ? d.contenu.total_ht : d.contenu.total_ttc)}${e.franchise_tva ? "" : " TTC"}.\n\nCordialement,\n${e.nom || ""}${e.telephone ? `\n${e.telephone}` : ""}`;
  const sujet = `${d.type === "facture" ? "Facture" : "Devis"} ${d.numero ?? ""} – ${d.contenu.titre}`;
  const envoye = await plateforme.partager({ sujet, texte, notifier });
  if (envoye && d.type === "devis" && d.statut === "brouillon") changerStatut("envoye");
};

$("#en-facture").onclick = async () => {
  if (!(await demander("Créer une facture (brouillon) à partir de ce devis ?", { ok: "Créer la facture" }))) return;
  const contenu = { ...structuredClone(docCourant.contenu), hypotheses: [], devis_numero: docCourant.numero };
  const { data, error } = await sb
    .from("documents")
    .insert({ type: "facture", devis_id: docCourant.id, contenu })
    .select("id")
    .single();
  if (error) return erreur("Facture non créée.", error);
  if (docCourant.statut !== "accepte") await sb.from("documents").update({ statut: "accepte" }).eq("id", docCourant.id);
  ouvrirDocument(data.id);
};

$("#emettre").onclick = async () => {
  if (!(await demander("Émettre la facture ? Elle recevra son numéro définitif et ne pourra plus être modifiée.", { ok: "Émettre" }))) return;
  const { data, error } = await sb.rpc("emettre_facture", { p_id: docCourant.id });
  if (error) return erreur("Émission impossible.", error);
  docCourant = data;
  rendreDocument();
};

$("#payee").onclick = async () => {
  if (await demander("Marquer cette facture comme payée ?", { ok: "Marquer payée" })) changerStatut("payee");
};

$("#modifier-ia").onclick = () => {
  const d = docCourant;
  if (conversation.docId !== d.id) {
    conversation = {
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
    if (!champ.name) continue;
    if (champ.type === "checkbox") champ.checked = !!profil.infos[champ.name];
    else if (profil.infos[champ.name] !== undefined) champ.value = profil.infos[champ.name];
  }
  $("#liste-metiers").innerHTML = CORPS_ETAT.map(
    (c) => `<label><input type="checkbox" value="${esc(c.id)}" ${profil.metiers.includes(c.id) ? "checked" : ""}> ${esc(c.nom)}</label>`,
  ).join("");
  rendreTarifs();
}

$("#form-entreprise").onsubmit = async (ev) => {
  ev.preventDefault();
  const infos = {};
  for (const champ of ev.target.elements) {
    if (!champ.name) continue;
    infos[champ.name] = champ.type === "checkbox" ? champ.checked : champ.value.trim();
  }
  const metiers = [...$("#liste-metiers").querySelectorAll("input:checked")].map((i) => i.value);
  const { error } = await sb.from("entreprises").upsert({ user_id: utilisateur.id, infos, metiers, updated_at: new Date().toISOString() });
  if (error) return erreur("Informations non enregistrées.", error);
  profil = { infos, metiers };
  notifier("Informations enregistrées.");
};

function optionsCorps(selection) {
  return [`<option value="">— Autre —</option>`, ...CORPS_ETAT.map((c) => `<option value="${esc(c.id)}" ${c.id === selection ? "selected" : ""}>${esc(c.nom)}</option>`)].join("");
}

function rendreTarifs() {
  if (!tarifs.length) {
    $("#grille-tarifs").innerHTML = `<p class="aide">Aucun prix pour l'instant.</p>`;
    return;
  }
  const groupes = new Map();
  for (const t of tarifs) {
    if (!groupes.has(t.corps_etat)) groupes.set(t.corps_etat, []);
    groupes.get(t.corps_etat).push(t);
  }
  $("#grille-tarifs").innerHTML = [...groupes]
    .map(
      ([corps, liste]) => `<h3>${esc(corps ? nomCorpsEtat(corps) : "Autre")}</h3>
      <table class="tarifs"><thead><tr><th>Prestation</th><th>Unité</th><th>Prix €</th><th></th></tr></thead><tbody>
      ${liste
        .map(
          (t) => `<tr>
            <td><input data-id="${esc(t.id)}" data-k="designation" value="${esc(t.designation)}" maxlength="300" placeholder="Ex : Pose de placo BA13">
              <select data-id="${esc(t.id)}" data-k="corps_etat">${optionsCorps(t.corps_etat)}</select></td>
            <td><input data-id="${esc(t.id)}" data-k="unite" value="${esc(t.unite)}" maxlength="20"></td>
            <td><input data-id="${esc(t.id)}" data-k="prix" inputmode="decimal" value="${nombre(t.prix)}"></td>
            <td><button class="suppr-ligne" data-suppr-tarif="${esc(t.id)}" title="Supprimer">✕</button></td>
          </tr>`,
        )
        .join("")}
      </tbody></table>`,
    )
    .join("");

  for (const champ of $("#grille-tarifs").querySelectorAll("[data-k]")) {
    champ.onchange = async () => {
      const valeur = champ.dataset.k === "prix" ? lireNombre(champ.value) : champ.value.trim();
      const { data, error } = await sb.from("tarifs").update({ [champ.dataset.k]: valeur }).eq("id", champ.dataset.id).select("*").single();
      if (error) return erreur("Prix non enregistré.", error);
      tarifs = tarifs.map((t) => (t.id === data.id ? data : t));
      if (champ.dataset.k === "corps_etat") rendreTarifs();
    };
  }
  for (const b of $("#grille-tarifs").querySelectorAll("[data-suppr-tarif]")) {
    b.onclick = async () => {
      const { error } = await sb.from("tarifs").delete().eq("id", b.dataset.supprTarif);
      if (error) return erreur("Suppression impossible.", error);
      tarifs = tarifs.filter((t) => t.id !== b.dataset.supprTarif);
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
  rendreTarifs();
  $(`#grille-tarifs input[data-id="${data.id}"]`)?.focus();
};
