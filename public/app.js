import { calculerTotaux } from "/calcul.js";

// ---------------------------------------------------------------------------
// Stockage local (MVP : tout reste sur le téléphone)
// ---------------------------------------------------------------------------
const stock = {
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
    } catch (e) {
      alert("Impossible d'enregistrer sur cet appareil (mémoire pleine ?).");
      console.error(e);
    }
  },
};

let tarifsParDefaut = [];
const entreprise = () => stock.lire("entreprise", { validite: 30, acompte: 30, delai_paiement: 30 });
const tarifs = () => stock.lire("tarifs", null) ?? tarifsParDefaut;
const documents = () => stock.lire("documents", []);
const sauverDocuments = (docs) => stock.ecrire("documents", docs);

function prochainNumero(type) {
  const annee = new Date().getFullYear();
  const compteurs = stock.lire("compteurs", {});
  const cle = `${type}-${annee}`;
  compteurs[cle] = (compteurs[cle] ?? 0) + 1;
  stock.ecrire("compteurs", compteurs);
  return `${type === "devis" ? "DEV" : "FAC"}-${annee}-${String(compteurs[cle]).padStart(3, "0")}`;
}

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

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function afficherVue(nom) {
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== `vue-${nom}`;
  for (const b of document.querySelectorAll(".barre nav button")) {
    b.classList.toggle("actif", b.dataset.vue === nom || (nom === "document" && b.dataset.vue === "documents"));
  }
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

function demarrerDictee({ envoiAuto = false } = {}) {
  if (!Reconnaissance) {
    alert("La dictée vocale n'est pas disponible sur ce navigateur. Utilise Chrome (Android) ou Safari (iPhone), ou le micro du clavier.");
    return;
  }
  arreterParole();
  reco = new Reconnaissance();
  reco.lang = "fr-FR";
  reco.interimResults = true;
  reco.continuous = !envoiAuto; // mains libres : s'arrête tout seul au silence
  texteAvantDictee = $("#texte").value ? `${$("#texte").value.trim()} ` : "";
  let final = "";

  reco.onresult = (e) => {
    let provisoire = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += `${e.results[i][0].transcript} `;
      else provisoire += e.results[i][0].transcript;
    }
    $("#texte").value = texteAvantDictee + final + provisoire;
  };
  reco.onerror = (e) => {
    if (e.error === "not-allowed") alert("Autorise l'accès au micro pour dicter.");
  };
  reco.onend = () => {
    $("#micro").classList.remove("ecoute");
    reco = null;
    if (envoiAuto && $("#texte").value.trim()) envoyer();
  };
  $("#micro").classList.add("ecoute");
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

const prefs = stock.lire("prefs", { voix: true, mainsLibres: false });
$("#voix").checked = prefs.voix;
$("#mains-libres").checked = prefs.mainsLibres;
$("#voix").onchange = $("#mains-libres").onchange = () => {
  if ($("#mains-libres").checked) $("#voix").checked = true;
  stock.ecrire("prefs", { voix: $("#voix").checked, mainsLibres: $("#mains-libres").checked });
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

$("#photo").onchange = async (e) => {
  for (const f of e.target.files) photosEnAttente.push(await redimensionner(f));
  e.target.value = "";
  $("#apercu-photos").innerHTML = photosEnAttente.map((p) => `<img src="${p}" alt="note">`).join("");
};

// ---------------------------------------------------------------------------
// Conversation avec l'IA
// ---------------------------------------------------------------------------
// Les photos restent en mémoire pendant la session mais ne sont pas stockées (trop lourdes).
let conversation = stock.lire("conversation", { historique: [], docId: null });

function sauverConversation() {
  stock.ecrire("conversation", {
    docId: conversation.docId,
    historique: conversation.historique.map(({ images, ...m }) =>
      images?.length ? { ...m, texte: `${m.texte}\n[${images.length} photo(s) de notes]` } : m,
    ),
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
  $("#apercu-photos").innerHTML = "";
  $("#envoyer").disabled = true;
  const attente = bulle("ia attente", "Je réfléchis au chantier…");

  try {
    const rep = await fetch("/api/discuter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ historique: conversation.historique, entreprise: entreprise(), tarifs: tarifs() }),
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error(data.erreur || "Erreur serveur");
    attente.remove();

    const reponse = { role: "assistant", texte: data.message, questions: data.questions, brut: data.brut };
    if (data.statut === "devis" && data.devis) reponse.docId = enregistrerDevis(data.devis);
    conversation.historique.push(reponse);
    sauverConversation();
    bulleIa(reponse);

    const aDire = [data.message, ...(data.questions ?? [])].join(" ");
    const relancer = $("#mains-libres").checked && data.statut === "questions";
    parler(aDire, relancer ? () => demarrerDictee({ envoiAuto: true }) : undefined);
  } catch (err) {
    attente.remove();
    conversation.historique.pop(); // on laisse l'artisan renvoyer le même message
    $("#texte").value = texte;
    bulle("erreur", esc(err.message));
  } finally {
    $("#envoyer").disabled = false;
  }
}

$("#saisie").onsubmit = (e) => {
  e.preventDefault();
  envoyer();
};

$("#nouveau").onclick = () => {
  if (conversation.historique.length && !confirm("Commencer un nouveau chantier ? La conversation en cours sera effacée (les devis restent enregistrés).")) return;
  conversation = { historique: [], docId: null };
  sauverConversation();
  reafficherConversation();
};

function enregistrerDevis(devis) {
  const docs = documents();
  const existant = conversation.docId && docs.find((d) => d.id === conversation.docId && d.type === "devis");
  if (existant) {
    existant.devis = { ...devis, client_nom: devis.client_nom || existant.devis.client_nom, client_adresse: devis.client_adresse || existant.devis.client_adresse };
    existant.modifie = new Date().toISOString();
  } else {
    const id = crypto.randomUUID();
    docs.unshift({ id, type: "devis", numero: prochainNumero("devis"), date: new Date().toISOString(), devis });
    conversation.docId = id;
  }
  sauverDocuments(docs);
  return conversation.docId;
}

// ---------------------------------------------------------------------------
// Liste des documents
// ---------------------------------------------------------------------------
function afficherListe() {
  const docs = documents();
  $("#liste-documents").innerHTML = docs.length
    ? docs
        .map(
          (d) => `<div class="element-liste" data-id="${esc(d.id)}">
            <div><strong>${esc(d.numero)}</strong> — ${esc(d.devis.titre)}
              <small>${dateFr(d.date)}${d.devis.client_nom ? ` · ${esc(d.devis.client_nom)}` : ""}</small></div>
            <div><span class="pastille ${d.type}">${d.type}</span><br><strong>${euros(d.devis.total_ttc)}</strong></div>
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

function ouvrirDocument(id) {
  docCourant = documents().find((d) => d.id === id);
  if (!docCourant) return;
  afficherVue("document");
  rendreDocument();
}

function majDocument(modif) {
  modif(docCourant);
  docCourant.devis = calculerTotaux(docCourant.devis);
  docCourant.modifie = new Date().toISOString();
  sauverDocuments(documents().map((d) => (d.id === docCourant.id ? docCourant : d)));
  rendreDocument();
}

function rendreDocument() {
  const d = docCourant;
  const v = d.devis;
  const e = entreprise();
  const facture = d.type === "facture";
  const franchise = e.franchise_tva;

  $("#en-facture").hidden = facture;
  $("#modifier-ia").hidden = facture;

  const hyp = v.hypotheses ?? [];
  $("#hypotheses").hidden = hyp.length === 0;
  $("#hypotheses").innerHTML = `<strong>À vérifier avant d'envoyer :</strong><ul>${hyp.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;

  const lignes = v.sections
    .map(
      (s, si) => `
      <tr class="section"><td colspan="5" contenteditable data-champ="section" data-s="${si}">${esc(s.titre)}</td></tr>
      ${s.lignes
        .map(
          (l, li) => `<tr>
            <td><div contenteditable data-champ="designation" data-s="${si}" data-l="${li}">${esc(l.designation)}</div>
              ${l.detail ? `<div class="detail" contenteditable data-champ="detail" data-s="${si}" data-l="${li}">${esc(l.detail)}</div>` : ""}
              ${l.calcul ? `<div class="calcul">${esc(l.calcul)}</div>` : ""}</td>
            <td class="num" contenteditable data-champ="quantite" data-s="${si}" data-l="${li}">${nombre(l.quantite)}</td>
            <td contenteditable data-champ="unite" data-s="${si}" data-l="${li}">${esc(l.unite)}</td>
            <td class="num" contenteditable data-champ="prix_unitaire_ht" data-s="${si}" data-l="${li}">${nombre(l.prix_unitaire_ht)}</td>
            <td class="num">${euros(l.total_ht)} <button class="suppr-ligne" data-suppr="${si}-${li}" title="Supprimer la ligne">✕</button></td>
          </tr>`,
        )
        .join("")}
      <tr class="ajout-ligne"><td colspan="5"><button class="lien" data-ajout="${si}">+ ajouter une ligne</button></td></tr>`,
    )
    .join("");

  const tauxTva = franchise ? 0 : v.taux_tva;
  const tva = franchise ? 0 : v.montant_tva;
  const ttc = franchise ? v.total_ht : v.total_ttc;
  const acompte = Number(e.acompte || 0);

  const mentions = facture
    ? [
        `Date d'échéance : ${dateFr(ajouterJours(d.date, e.delai_paiement || 30))}.`,
        d.devisNumero ? `Facture établie selon le devis n° ${d.devisNumero}.` : "",
        "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.",
        e.iban ? `Règlement par virement : IBAN ${e.iban}` : "",
      ]
    : [
        `Devis valable ${e.validite || 30} jours à compter du ${dateFr(d.date)}. Devis gratuit.`,
        acompte ? `Acompte de ${acompte} % à la signature (${euros((ttc * acompte) / 100)}), solde à la fin des travaux.` : "",
        v.duree_estimee ? `Durée estimée des travaux : ${v.duree_estimee}.` : "",
      ];
  if (franchise) mentions.push("TVA non applicable, art. 293 B du CGI.");
  else if (tauxTva < 20) mentions.push(`Taux de TVA réduit de ${nombre(tauxTva)} % appliqué pour des travaux dans un logement achevé depuis plus de 2 ans (art. 279-0 bis / 278-0 bis A du CGI), sur déclaration du client.`);
  if (e.assurance) mentions.push(`Assurance décennale : ${e.assurance}.`);

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
        <div contenteditable data-champ="client_nom" data-placeholder="Nom du client">${esc(v.client_nom) || "<em>Nom du client</em>"}</div>
        <div contenteditable data-champ="client_adresse">${esc(v.client_adresse) || "<em>Adresse du client</em>"}</div>
        ${v.adresse_chantier ? `<small>Chantier : ${esc(v.adresse_chantier)}</small>` : ""}
      </div>
    </div>
    <h2 class="doc-titre">${facture ? "FACTURE" : "DEVIS"} n° ${esc(d.numero)}</h2>
    <div class="doc-meta">Date : ${dateFr(d.date)} · Objet : <span contenteditable data-champ="titre">${esc(v.titre)}</span></div>
    <p contenteditable data-champ="description">${esc(v.description)}</p>
    <table class="doc-table">
      <thead><tr><th>Désignation</th><th class="num">Qté</th><th>Unité</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
    <table class="doc-totaux">
      <tr><td>Total HT</td><td class="num">${euros(v.total_ht)}</td></tr>
      ${franchise ? "" : `<tr><td>TVA <span contenteditable data-champ="taux_tva">${nombre(tauxTva)}</span> %</td><td class="num">${euros(tva)}</td></tr>`}
      <tr class="ttc"><td>${franchise ? "Net à payer" : "Total TTC"}</td><td class="num">${euros(ttc)}</td></tr>
    </table>
    <div class="doc-mentions">${mentions.filter(Boolean).map((m) => `<p>${esc(m)}</p>`).join("")}</div>
    ${facture ? "" : `<div class="doc-signature"><div>L'entreprise</div><div>Le client<br><small>Date, signature et mention « Bon pour accord »</small></div></div>`}
  `;

  // Édition directe dans le document
  for (const el of $("#document").querySelectorAll("[contenteditable]")) {
    el.addEventListener("focus", () => {
      if (el.querySelector("em")) el.textContent = "";
    });
    el.addEventListener("blur", () => {
      const { champ, s, l } = el.dataset;
      const val = el.innerText.trim();
      majDocument((doc) => {
        const dv = doc.devis;
        if (champ === "section") dv.sections[s].titre = val;
        else if (l !== undefined) {
          const ligne = dv.sections[s].lignes[l];
          ligne[champ] = ["quantite", "prix_unitaire_ht"].includes(champ) ? lireNombre(val) : val;
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
      majDocument((doc) => doc.devis.sections[s].lignes.splice(l, 1));
    };
  }
  for (const b of $("#document").querySelectorAll("[data-ajout]")) {
    b.onclick = () =>
      majDocument((doc) =>
        doc.devis.sections[b.dataset.ajout].lignes.push({ designation: "Nouvelle prestation", detail: "", quantite: 1, unite: "u", prix_unitaire_ht: 0, calcul: "" }),
      );
  }
}

$("#retour").onclick = () => afficherVue("documents");
$("#imprimer").onclick = () => {
  const avant = document.title;
  document.title = `${docCourant.numero} ${docCourant.devis.client_nom || ""}`.trim();
  window.print();
  document.title = avant;
};

$("#partager").onclick = async () => {
  const d = docCourant;
  const e = entreprise();
  const texte = `Bonjour,\n\nVeuillez trouver ci-joint ${d.type === "facture" ? "la facture" : "le devis"} n° ${d.numero} (${d.devis.titre}) d'un montant de ${euros(e.franchise_tva ? d.devis.total_ht : d.devis.total_ttc)}${e.franchise_tva ? "" : " TTC"}.\n\nCordialement,\n${e.nom || ""}${e.telephone ? `\n${e.telephone}` : ""}`;
  const sujet = `${d.type === "facture" ? "Facture" : "Devis"} ${d.numero} – ${d.devis.titre}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: sujet, text: texte });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  location.href = `mailto:?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(`${texte}\n\n(Pense à joindre le PDF via « PDF / Imprimer ».)`)}`;
};

$("#en-facture").onclick = () => {
  if (!confirm("Créer la facture à partir de ce devis ?")) return;
  const facture = {
    id: crypto.randomUUID(),
    type: "facture",
    numero: prochainNumero("facture"),
    date: new Date().toISOString(),
    devisNumero: docCourant.numero,
    devis: structuredClone({ ...docCourant.devis, hypotheses: [] }),
  };
  sauverDocuments([facture, ...documents()]);
  ouvrirDocument(facture.id);
};

$("#modifier-ia").onclick = () => {
  const d = docCourant;
  if (conversation.docId !== d.id) {
    conversation = {
      docId: d.id,
      historique: [
        { role: "user", texte: `Voici le devis actuel ${d.numero} à modifier :\n${JSON.stringify(d.devis)}` },
        { role: "assistant", texte: "Ok, j'ai le devis sous les yeux. Qu'est-ce qu'on change ?", questions: [] },
      ],
    };
    sauverConversation();
    reafficherConversation();
  }
  afficherVue("chantier");
  $("#texte").focus();
};

$("#supprimer").onclick = () => {
  if (!confirm(`Supprimer définitivement ${docCourant.numero} ?`)) return;
  sauverDocuments(documents().filter((d) => d.id !== docCourant.id));
  if (conversation.docId === docCourant.id) conversation.docId = null;
  afficherVue("documents");
};

// ---------------------------------------------------------------------------
// Réglages : entreprise et grille de prix
// ---------------------------------------------------------------------------
function afficherParametres() {
  const e = entreprise();
  const form = $("#form-entreprise");
  for (const champ of form.elements) {
    if (!champ.name) continue;
    if (champ.type === "checkbox") champ.checked = !!e[champ.name];
    else if (e[champ.name] !== undefined) champ.value = e[champ.name];
  }
  rendreTarifs();
}

$("#form-entreprise").onsubmit = (ev) => {
  ev.preventDefault();
  const donnees = {};
  for (const champ of ev.target.elements) {
    if (!champ.name) continue;
    donnees[champ.name] = champ.type === "checkbox" ? champ.checked : champ.value.trim();
  }
  stock.ecrire("entreprise", donnees);
  alert("Informations enregistrées.");
};

function rendreTarifs() {
  $("#table-tarifs tbody").innerHTML = tarifs()
    .map(
      (t, i) => `<tr>
        <td><input data-i="${i}" data-k="designation" value="${esc(t.designation)}"></td>
        <td><input data-i="${i}" data-k="unite" value="${esc(t.unite)}"></td>
        <td><input data-i="${i}" data-k="prix" inputmode="decimal" value="${nombre(t.prix)}"></td>
        <td><button class="suppr-ligne" data-suppr-tarif="${i}">✕</button></td>
      </tr>`,
    )
    .join("");
  for (const input of $("#table-tarifs").querySelectorAll("input")) {
    input.onchange = () => {
      const liste = structuredClone(tarifs());
      liste[input.dataset.i][input.dataset.k] = input.dataset.k === "prix" ? lireNombre(input.value) : input.value.trim();
      stock.ecrire("tarifs", liste);
    };
  }
  for (const b of $("#table-tarifs").querySelectorAll("[data-suppr-tarif]")) {
    b.onclick = () => {
      const liste = structuredClone(tarifs());
      liste.splice(Number(b.dataset.supprTarif), 1);
      stock.ecrire("tarifs", liste);
      rendreTarifs();
    };
  }
}

$("#ajouter-tarif").onclick = () => {
  stock.ecrire("tarifs", [...tarifs(), { code: `P${Date.now() % 10000}`, designation: "", unite: "m²", prix: 0 }]);
  rendreTarifs();
  $("#table-tarifs tbody tr:last-child input").focus();
};
$("#reinit-tarifs").onclick = () => {
  if (!confirm("Remettre la grille de prix par défaut ? Tes prix personnalisés seront perdus.")) return;
  localStorage.removeItem("cagot.tarifs");
  rendreTarifs();
};

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    tarifsParDefaut = cfg.tarifs;
    $("#bandeau-demo").hidden = !cfg.demo;
  })
  .catch(() => {});

reafficherConversation();
