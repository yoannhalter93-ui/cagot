// Tous les montants sont calculés ici, jamais par l'IA : elle fournit les
// quantités et prix unitaires, le serveur fait les multiplications et les totaux.

export const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Une ligne « option » ne compte dans le total que si le client l'a retenue.
export const compte = (ligne) => !ligne.option || ligne.option_retenue === true;

// Taux de TVA d'une ligne : le sien s'il est précisé (ex. isolation à 5,5 % dans un devis à 10 %),
// sinon celui du document. Autoliquidation : aucune TVA facturée.
export const tauxLigne = (ligne, devis) =>
  devis.autoliquidation ? 0 : Number.isFinite(Number(ligne.taux_tva)) && ligne.taux_tva !== null && ligne.taux_tva !== "" ? Number(ligne.taux_tva) : Number(devis.taux_tva ?? 10);

export function calculerTotaux(devis) {
  const tauxTva = Number(devis.taux_tva ?? 10);
  let totalHt = 0;
  const bases = new Map(); // taux → base HT

  const sections = (devis.sections ?? []).map((section) => {
    const lignes = (section.lignes ?? []).map((ligne) => {
      const quantite = arrondi(ligne.quantite ?? 0);
      const prixUnitaire = arrondi(ligne.prix_unitaire_ht ?? 0);
      const total = arrondi(quantite * prixUnitaire);
      if (compte(ligne)) {
        totalHt += total;
        const t = tauxLigne(ligne, { ...devis, taux_tva: tauxTva });
        bases.set(t, (bases.get(t) ?? 0) + total);
      }
      return { ...ligne, quantite, prix_unitaire_ht: prixUnitaire, total_ht: total };
    });
    const sousTotal = arrondi(lignes.filter(compte).reduce((s, l) => s + l.total_ht, 0));
    return { ...section, lignes, sous_total_ht: sousTotal };
  });

  totalHt = arrondi(totalHt);
  // TVA calculée par taux (arrondie par taux, comme sur une facture électronique)
  const ventilation = [...bases]
    .map(([taux, base]) => ({ taux, base_ht: arrondi(base), montant_tva: arrondi((arrondi(base) * taux) / 100) }))
    .sort((a, b) => b.taux - a.taux)
    // Un taux dont tout s'annule (ex. : facture finale après situations) n'a rien à afficher.
    .filter((v, _i, toutes) => toutes.length === 1 || v.base_ht !== 0 || v.montant_tva !== 0);
  const tva = arrondi(ventilation.reduce((s, v) => s + v.montant_tva, 0));
  return {
    ...devis,
    taux_tva: tauxTva,
    sections,
    total_ht: totalHt,
    montant_tva: tva,
    ventilation_tva: ventilation.length ? ventilation : [{ taux: devis.autoliquidation ? 0 : tauxTva, base_ht: 0, montant_tva: 0 }],
    total_ttc: arrondi(totalHt + tva),
  };
}
