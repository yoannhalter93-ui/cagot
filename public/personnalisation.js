// Personnalisation des devis et factures (écran, page client, PDF) : modèle de mise en page,
// textes d'introduction et de fin, labels (RGE, Qualibat…) et pied de page de l'artisan.
// Les réglages sont dans les infos de l'entreprise (e).

export const MODELES = [
  { id: "classique", nom: "Classique", aide: "En-tête sobre, tableau aux couleurs de ton logo." },
  { id: "moderne", nom: "Moderne", aide: "Bandeau de couleur pour le titre et le total." },
  { id: "epure", nom: "Épuré", aide: "Sans aplats de couleur, lignes fines, très lisible." },
];
export const modeleDe = (e) => (MODELES.some((m) => m.id === e?.modele) ? e.modele : "classique");

export const LABELS_MAX = 6;
const imageValide = (x) => typeof x === "string" && x.length < 300_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x);
// Les labels sont enregistrés en liste ; un ancien enregistrement peut les avoir en texte JSON.
export function labelsDe(e) {
  let l = e?.labels;
  if (typeof l === "string") {
    try {
      l = JSON.parse(l || "[]");
    } catch {
      l = [];
    }
  }
  return Array.isArray(l) ? l.filter(imageValide).slice(0, LABELS_MAX) : [];
}

const texte = (t) => (typeof t === "string" ? t.trim().slice(0, 1500) : "");
export const textesDocument = (e, type) =>
  type === "facture"
    ? { intro: texte(e?.intro_facture), fin: texte(e?.fin_facture) }
    : { intro: texte(e?.intro_devis), fin: texte(e?.fin_devis) };
export const piedDePage = (e) => texte(e?.pied_page).slice(0, 400);
// Conditions particulières : celles des factures peuvent être différentes (sinon les mêmes).
export const conditionsDe = (e, type) => texte(type === "facture" && texte(e?.conditions_facture) ? e.conditions_facture : e?.conditions);

// Morceaux HTML (esc = fonction d'échappement de la page).
export function htmlPersonnalisation(e, type, esc) {
  const { intro, fin } = textesDocument(e, type);
  const para = (t, classe) => (t ? `<p class="${classe}">${esc(t).replace(/\n/g, "<br>")}</p>` : "");
  const labels = labelsDe(e);
  const pied = piedDePage(e);
  return {
    intro: para(intro, "doc-intro"),
    fin: para(fin, "doc-fin"),
    labels: labels.length ? `<div class="doc-labels">${labels.map((l) => `<img src="${esc(l)}" alt="Label">`).join("")}</div>` : "",
    pied: pied ? `<div class="doc-pied">${esc(pied).replace(/\n/g, "<br>")}</div>` : "",
  };
}
