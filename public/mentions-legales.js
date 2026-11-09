// Mentions légales liées au client et au chantier (communes à l'appli, au PDF, à la page
// client et à l'espace comptable). Les champs sont dans le contenu du document (c) :
//   client_type        "particulier" (défaut) ou "pro"
//   client_siren       SIREN du client professionnel
//   hors_etablissement devis signé chez le client particulier (défaut : oui)
//   date_debut         date de début prévue des travaux (devis)
//   date_travaux       date ou période d'exécution des travaux (facture)
//   autoliquidation    sous-traitance BTP : TVA due par l'entreprise cliente
//   avoir, facture_origine, facture_origine_date : avoir annulant une facture

export const estParticulier = (c) => c?.client_type !== "pro";
export const horsEtablissement = (c) => estParticulier(c) && c?.hors_etablissement !== false;
export const autoliquidation = (c) => !estParticulier(c) && !!c?.autoliquidation;

const txt = (t) => (typeof t === "string" ? t.trim() : "");

export const NATURES = { services: "prestation de services", biens: "livraison de biens", mixte: "opération mixte (biens et services)" };

export const MENTION_AUTOLIQUIDATION = "Autoliquidation : TVA due par le preneur, en application de l'article 283-2 nonies du CGI (sous-traitance de travaux de construction).";

export const TEXTE_RETRACTATION =
  "Droit de rétractation (contrat conclu hors établissement) : vous disposez d'un délai de 14 jours à compter de la signature du présent devis pour vous rétracter, sans avoir à motiver votre décision (art. L221-18 du Code de la consommation), en nous envoyant le formulaire de rétractation joint ou toute autre déclaration dénuée d'ambiguïté. Si vous demandez expressément que les travaux commencent avant la fin de ce délai et que vous vous rétractez ensuite, vous paierez un montant proportionnel aux travaux déjà réalisés (art. L221-25). Aucun paiement ne peut être exigé avant l'expiration d'un délai de 7 jours à compter de la signature (art. L221-10).";

// Ligne d'acompte du devis : pas de paiement avant 7 jours pour un contrat hors établissement.
export function texteAcompte(c, acompte, montant) {
  if (!acompte) return "";
  return horsEtablissement(c)
    ? `Acompte de ${acompte} % (${montant}) payable au plus tôt 7 jours après la signature (art. L221-10 du Code de la consommation), solde à la fin des travaux.`
    : `Acompte de ${acompte} % à la signature (${montant}), solde à la fin des travaux.`;
}

export function texteMediateur(e) {
  const m = txt(e?.mediateur);
  return m ? `Médiation de la consommation : en cas de litige non résolu avec nous, vous pouvez recourir gratuitement au médiateur ${m} (art. L612-1 du Code de la consommation).` : "";
}

// Mentions à ajouter en bas du document (en plus des mentions habituelles).
export function mentionsClient(d, e, dateFr) {
  const c = d.contenu ?? {};
  const m = [];
  if (d.type === "devis") {
    if (txt(c.date_debut)) m.push(`Date de début prévue des travaux : ${txt(c.date_debut)}.`);
    if (horsEtablissement(c)) m.push(TEXTE_RETRACTATION);
  } else {
    if (c.avoir) m.push(`Avoir annulant la facture n° ${c.facture_origine || "?"}${c.facture_origine_date ? ` du ${dateFr(c.facture_origine_date)}` : ""}.`);
    else if (txt(c.date_travaux)) m.push(`Date d'exécution des travaux : ${txt(c.date_travaux)}.`);
    if (!c.avoir) m.push(`Nature de l'opération : ${NATURES[c.nature] ?? NATURES.services}.`);
    if (!c.avoir && e?.tva_debits && !e?.franchise_tva && !autoliquidation(c)) m.push("Option pour le paiement de la TVA d'après les débits.");
  }
  if (autoliquidation(c)) m.push(MENTION_AUTOLIQUIDATION);
  if (estParticulier(c) && texteMediateur(e)) m.push(texteMediateur(e));
  return m;
}

// Formulaire type de rétractation (annexe à l'article R221-1 du Code de la consommation).
export function formulaireRetractation(e, d) {
  const pro = [e?.nom, ...String(e?.adresse || "").split("\n"), e?.email].map(txt).filter(Boolean).join(", ");
  return {
    titre: "Formulaire de rétractation",
    lignes: [
      "(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)",
      `À l'attention de : ${pro}`,
      `Je/nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la prestation de services ci-dessous : devis n° ${d.numero || "…"} – ${txt(d.contenu?.titre)}`,
      "Commandé le (*) : ……………………………………",
      "Nom du (des) consommateur(s) : ……………………………………………………",
      "Adresse du (des) consommateur(s) : ………………………………………………………………………………",
      "Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :",
      "",
      "Date : ……………………",
      "(*) Rayez la mention inutile.",
    ],
  };
}
