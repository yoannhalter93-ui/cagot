// Page publique du devis : le client l'ouvre depuis le lien reçu (sans compte),
// coche ses options, signe au doigt. Le lien secret est dans l'ancre (#…), jamais envoyé
// dans les journaux des serveurs.
import { calculerTotaux } from "/calcul.js";
import { genererPdf, preparerPolices } from "/pdf-devis.js";
import { htmlPersonnalisation, modeleDe } from "/personnalisation.js";
import { autoliquidation, mentionsTvaReduite, ventilationTva, formulaireRetractation, horsEtablissement, mentionsClient, texteAcompte } from "/mentions-legales.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const euros = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const heureFr = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jeton = decodeURIComponent(location.hash.slice(1));

let sb = null;
let donnees = null;
let contenu = null; // contenu avec les options cochées
let traceFaite = false;

function erreurPage(message) {
  $("#chargement").hidden = true;
  $("#devis-client").hidden = true;
  $("#erreur-client").hidden = false;
  $("#erreur-client").innerHTML = `<h2>Devis indisponible</h2><p>${esc(message)}</p>`;
}

const cleLigne = (si, li) => `${si}-${li}`;

function totaux() {
  return calculerTotaux(contenu);
}

function mentions(e, c, ttc) {
  const m = [`Devis valable ${e.validite || 30} jours à compter du ${dateFr(donnees.date_document)}. Devis gratuit.`];
  if (Number(e.acompte)) m.push(texteAcompte(c, Number(e.acompte), euros((ttc * Number(e.acompte)) / 100)));
  if (c.duree_estimee) m.push(`Durée estimée des travaux : ${c.duree_estimee}.`);
  m.push(...mentionsClient({ type: "devis", numero: donnees.numero, contenu: c }, e, dateFr));
  if (e.franchise_tva) m.push("TVA non applicable, art. 293 B du CGI.");
  else if (autoliquidation(c)) {
    // mention d'autoliquidation déjà ajoutée
  } else m.push(...mentionsTvaReduite(c, "devis"));
  if (e.assurance) m.push(`Assurance décennale : ${e.assurance}.`);
  if (e.conditions) m.push(e.conditions);
  return m;
}

function formulaireHtml(e) {
  const f = formulaireRetractation(e, { numero: donnees.numero, contenu });
  return `<details class="formulaire-retractation"><summary>${esc(f.titre)}</summary>${f.lignes.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join("")}</details>`;
}

function rendre() {
  const e = donnees.entreprise;
  const c = totaux();
  const franchise = !!e.franchise_tva;
  const ttc = franchise ? c.total_ht : c.total_ttc;
  const couleur = /^#[0-9a-f]{6}$/i.test(e.couleur || "") ? e.couleur : "#1f3b63";
  $("#document").style.setProperty("--bleu", couleur);
  const lignes = c.sections
    .map(
      (s, si) => `<tr class="section"><td colspan="4">${esc(s.titre)}</td></tr>
      ${s.lignes
        .map((l, li) => {
          const nonRetenue = l.option && l.option_retenue !== true;
          return `<tr class="${l.option ? "ligne-option" : ""} ${nonRetenue ? "non-retenue" : ""}">
            <td>${esc(l.designation)}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ""}
              ${l.option ? `<span class="badge-option">${nonRetenue ? "Option non incluse" : "Option incluse ✓"}</span>` : ""}</td>
            <td class="num">${nombre(l.quantite)} ${esc(l.unite)}</td>
            <td class="num">${euros(l.prix_unitaire_ht)}</td>
            <td class="num">${nonRetenue ? `<s>${euros(l.total_ht)}</s>` : euros(l.total_ht)}</td></tr>`;
        })
        .join("")}`,
    )
    .join("");
  const perso = htmlPersonnalisation(e, "devis", esc);
  $("#document").innerHTML = `
    <div class="doc-entete">
      <div class="entreprise">
        ${/^data:image\/(png|jpeg);base64,/.test(e.logo || "") ? `<img class="doc-logo" src="${esc(e.logo)}" alt="">` : ""}
        <strong>${esc(e.nom)}</strong><br>${esc(e.adresse || "").replace(/\n/g, "<br>")}<br>
        ${e.telephone ? `Tél. ${esc(e.telephone)}<br>` : ""}${e.email ? `${esc(e.email)}<br>` : ""}${e.siret ? `SIRET ${esc(e.siret)}` : ""}
      </div>
      <div class="client"><strong>Client</strong><br>${esc(c.client_nom)}<br>${esc(c.client_adresse || "").replace(/\n/g, "<br>")}</div>
    </div>
    <h2 class="doc-titre">DEVIS n° ${esc(donnees.numero)}</h2>
    <div class="doc-meta">Date : ${dateFr(donnees.date_document)} · Objet : ${esc(c.titre)}</div>
    ${c.description ? `<p>${esc(c.description)}</p>` : ""}
    ${perso.intro}
    <table class="doc-table"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead><tbody>${lignes}</tbody></table>
    <table class="doc-totaux">
      <tr><td>Total HT</td><td class="num">${euros(c.total_ht)}</td></tr>
      ${franchise ? "" : autoliquidation(c) ? `<tr><td>TVA autoliquidée</td><td class="num">${euros(0)}</td></tr>` : ventilationTva(c).map((t) => `<tr><td>TVA ${nombre(t.taux)} %</td><td class="num">${euros(t.montant_tva)}</td></tr>`).join("")}
      <tr class="ttc"><td>${franchise ? "Net à payer" : "Total TTC"}</td><td class="num">${euros(ttc)}</td></tr>
    </table>
    ${perso.fin}
    <div class="doc-mentions">${mentions(e, c, ttc).map((m) => `<p>${esc(m)}</p>`).join("")}</div>
    ${perso.labels}${perso.pied}
    ${horsEtablissement(c) ? formulaireHtml(e) : ""}`;
  $("#document").dataset.modele = modeleDe(e);
  $("#total-signature").textContent = `${euros(ttc)}${franchise ? "" : " TTC"}`;
  $("#signer").textContent = `✍️ Signer et accepter le devis (${euros(ttc)}${franchise ? "" : " TTC"})`;
}

function rendreOptions() {
  const options = [];
  contenu.sections.forEach((s, si) => s.lignes.forEach((l, li) => l.option && options.push({ l, cle: cleLigne(si, li) })));
  $("#bloc-options").hidden = !options.length || !!donnees.signe_at;
  $("#liste-options").innerHTML = options
    .map(
      ({ l, cle }) => `<label class="option-client"><input type="checkbox" data-cle="${cle}" ${l.option_retenue ? "checked" : ""}>
        <span><strong>${esc(l.designation)}</strong><small>${nombre(l.quantite)} ${esc(l.unite)} × ${euros(l.prix_unitaire_ht)} = ${euros(l.quantite * l.prix_unitaire_ht)} HT</small></span></label>`,
    )
    .join("");
  for (const c of $("#liste-options").querySelectorAll("input")) {
    c.onchange = () => {
      const [si, li] = c.dataset.cle.split("-").map(Number);
      contenu.sections[si].lignes[li].option_retenue = c.checked;
      rendre();
    };
  }
}

// --- Signature au doigt ---
function preparerPad() {
  const pad = $("#pad");
  const ctx = pad.getContext("2d");
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1c2430";
  let dessine = false;
  const point = (ev) => {
    const r = pad.getBoundingClientRect();
    return [((ev.clientX - r.left) * pad.width) / r.width, ((ev.clientY - r.top) * pad.height) / r.height];
  };
  pad.addEventListener("pointerdown", (ev) => {
    dessine = true;
    pad.setPointerCapture(ev.pointerId);
    ctx.beginPath();
    ctx.moveTo(...point(ev));
    ev.preventDefault();
  });
  pad.addEventListener("pointermove", (ev) => {
    if (!dessine) return;
    ctx.lineTo(...point(ev));
    ctx.stroke();
    traceFaite = true;
    ev.preventDefault();
  });
  const fin = () => (dessine = false);
  pad.addEventListener("pointerup", fin);
  pad.addEventListener("pointercancel", fin);
  $("#effacer-signature").onclick = () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    traceFaite = false;
  };
}

async function signer() {
  const nom = $("#nom-signataire").value.trim();
  if (nom.length < 2) return alerte("Indiquez votre nom et prénom.");
  if (!traceFaite) return alerte("Signez avec le doigt dans le cadre.");
  if (!$("#accord").checked) return alerte("Cochez la case « Bon pour accord ».");
  const options = [];
  contenu.sections.forEach((s, si) => s.lignes.forEach((l, li) => l.option && l.option_retenue && options.push(cleLigne(si, li))));
  const bouton = $("#signer");
  bouton.disabled = true;
  bouton.textContent = "Signature en cours…";
  const { error } = await sb.rpc("signer_devis", { p_jeton: jeton, p_nom: nom, p_signature: $("#pad").toDataURL("image/png"), p_options: options });
  if (error) {
    bouton.disabled = false;
    rendre();
    const msg = /deja_signe/.test(error.message) ? "Ce devis a déjà été signé." : /devis_indisponible/.test(error.message) ? "Ce devis n'est plus disponible pour signature : contactez l'entreprise." : "La signature n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.";
    return alerte(msg);
  }
  await charger();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function alerte(message) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast erreur";
    t.setAttribute("role", "alert");
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.hidden = false;
  clearTimeout(alerte.minuterie);
  alerte.minuterie = setTimeout(() => (t.hidden = true), 4000);
}

async function telechargerPdf() {
  for (const src of ["/vendor/jspdf.umd.min.js", "/vendor/jspdf.plugin.autotable.min.js"]) {
    if (!document.querySelector(`script[src="${src}"]`)) {
      await new Promise((ok, ko) => document.head.appendChild(Object.assign(document.createElement("script"), { src, onload: ok, onerror: ko })));
    }
  }
  await preparerPolices();
  const c = totaux();
  const e = donnees.entreprise;
  const franchise = !!e.franchise_tva;
  const ttc = franchise ? c.total_ht : c.total_ttc;
  const d = { type: "devis", numero: donnees.numero, date_document: donnees.date_document, contenu: c };
  const blob = genererPdf({
    d,
    entreprise: e,
    elements: {
      franchise, tauxTva: franchise ? 0 : c.taux_tva, tva: franchise ? 0 : c.montant_tva, ttc,
      mentions: mentions(e, c, ttc), titre: `DEVIS n° ${donnees.numero}`,
      signature: donnees.signature ? { image: donnees.signature, nom: donnees.signataire_nom, date: dateFr(donnees.signe_at) } : null,
    },
    euros, nombre, dateFr,
  });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `Devis_${donnees.numero}_signe.pdf` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function charger() {
  const { data, error } = await sb.rpc("devis_public", { p_jeton: jeton });
  if (error || !data || data.erreur) return erreurPage("Ce lien n'est plus valable. Demandez un nouveau lien à l'entreprise.");
  donnees = data;
  contenu = structuredClone(data.contenu);
  $("#chargement").hidden = true;
  $("#devis-client").hidden = false;
  document.title = `Devis ${data.numero} – ${data.entreprise.nom || ""}`;
  rendre();
  rendreOptions();
  const signe = !!data.signe_at;
  $("#bloc-signe").hidden = !signe;
  $("#bloc-signature").hidden = signe || !["brouillon", "envoye"].includes(data.statut);
  if (signe) {
    $("#texte-signe").textContent = `Signé par ${data.signataire_nom} le ${dateFr(data.signe_at)} à ${heureFr(data.signe_at)}. Merci ! L'entreprise a été prévenue automatiquement dans son application.`;
    $("#image-signature").src = data.signature;
  } else if (!["brouillon", "envoye"].includes(data.statut)) {
    $("#erreur-client").hidden = false;
    $("#erreur-client").innerHTML = `<p>Ce devis n'est plus ouvert à la signature. Pour toute question, contactez ${esc(data.entreprise.nom || "l'entreprise")}${data.entreprise.telephone ? ` au ${esc(data.entreprise.telephone)}` : ""}.</p>`;
  }
}

(async () => {
  if (jeton.length < 40) return erreurPage("Lien incomplet : ouvrez le lien reçu par message, en entier.");
  try {
    const config = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch {
    return erreurPage("Connexion impossible. Vérifiez votre réseau et rechargez la page.");
  }
  preparerPad();
  $("#signer").onclick = signer;
  $("#pdf-client").onclick = () => telechargerPdf().catch(() => alerte("PDF impossible à créer, réessayez."));
  await charger();
})();
