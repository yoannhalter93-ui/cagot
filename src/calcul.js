// Tous les montants sont calculés ici, jamais par l'IA : elle fournit les
// quantités et prix unitaires, le serveur fait les multiplications et les totaux.

export const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function calculerTotaux(devis) {
  const tauxTva = Number(devis.taux_tva ?? 10);
  let totalHt = 0;

  const sections = (devis.sections ?? []).map((section) => {
    const lignes = (section.lignes ?? []).map((ligne) => {
      const quantite = arrondi(ligne.quantite ?? 0);
      const prixUnitaire = arrondi(ligne.prix_unitaire_ht ?? 0);
      const total = arrondi(quantite * prixUnitaire);
      totalHt += total;
      return { ...ligne, quantite, prix_unitaire_ht: prixUnitaire, total_ht: total };
    });
    const sousTotal = arrondi(lignes.reduce((s, l) => s + l.total_ht, 0));
    return { ...section, lignes, sous_total_ht: sousTotal };
  });

  totalHt = arrondi(totalHt);
  const tva = arrondi((totalHt * tauxTva) / 100);
  return {
    ...devis,
    taux_tva: tauxTva,
    sections,
    total_ht: totalHt,
    montant_tva: tva,
    total_ttc: arrondi(totalHt + tva),
  };
}
