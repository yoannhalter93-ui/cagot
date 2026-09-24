import { calculerTotaux } from "./calcul.js";

// Mode démo (aucune clé API configurée) : permet de tester l'interface de bout en bout
// avec un scénario fixe « chambre avec papier peint ».
export function devisDeDemo(historique) {
  const tout = historique.filter((m) => m.role === "user").map((m) => m.texte ?? "").join(" ");
  const aDesMesures = /\d/.test(tout);

  if (!aDesMesures) {
    const sortie = {
      statut: "questions",
      message:
        "D'accord, une chambre à refaire avec dépose du papier peint. Il me manque quelques mesures pour être précis.",
      questions: [
        "Quelles sont la longueur et la largeur de la chambre ?",
        "Quelle est la hauteur sous plafond ?",
        "Combien de portes et de fenêtres, et quelles dimensions pour les fenêtres ?",
        "Le plafond est-il à repeindre aussi ?",
      ],
      devis: null,
    };
    return { ...sortie, brut: JSON.stringify(sortie) };
  }

  // Chambre 3,50 × 4,20 × 2,50, 1 porte, 1 fenêtre 1,20 × 1,50
  const murs = 38.5 - 1.7 - 1.8; // 35,00 m²
  const sortie = {
    statut: "devis",
    message: "Voilà le devis de la chambre : dépose du papier peint, préparation complète des murs et peinture murs et plafond.",
    questions: [],
    devis: {
      titre: "Rénovation peinture – Chambre",
      client_nom: "",
      client_adresse: "",
      adresse_chantier: "",
      description:
        "Dépose du papier peint existant, préparation des murs (lessivage, rebouchage, ratissage, ponçage), impression et mise en peinture des murs et du plafond de la chambre.",
      sections: [
        {
          titre: "Préparation du chantier",
          lignes: [
            { designation: "Protection des sols et mobilier", detail: "Bâche + adhésif de masquage", quantite: 14.7, unite: "m²", prix_unitaire_ht: 2.5, prix_source: "estime", calcul: "3,50 × 4,20" },
          ],
        },
        {
          titre: "Chambre – Murs",
          lignes: [
            { designation: "Dépose de papier peint", detail: "Décollage à la décolleuse vapeur et grattage", quantite: murs, unite: "m²", prix_unitaire_ht: 8, prix_source: "grille", calcul: "(3,50+4,20)×2×2,50 − 1,7 porte − 1,8 fenêtre" },
            { designation: "Lessivage des murs", detail: "", quantite: murs, unite: "m²", prix_unitaire_ht: 4, prix_source: "grille", calcul: "idem" },
            { designation: "Ratissage 2 passes", detail: "Enduit de lissage", quantite: murs, unite: "m²", prix_unitaire_ht: 14, prix_source: "grille", calcul: "idem" },
            { designation: "Ponçage et dépoussiérage", detail: "", quantite: murs, unite: "m²", prix_unitaire_ht: 4, prix_source: "grille", calcul: "idem" },
            { designation: "Impression murs", detail: "Sous-couche acrylique", quantite: murs, unite: "m²", prix_unitaire_ht: 5, prix_source: "grille", calcul: "idem" },
            { designation: "Peinture murs 2 couches", detail: "Acrylique velours", quantite: murs, unite: "m²", prix_unitaire_ht: 14, prix_source: "grille", calcul: "idem" },
          ],
        },
        {
          titre: "Chambre – Plafond",
          lignes: [
            { designation: "Impression plafond", detail: "", quantite: 14.7, unite: "m²", prix_unitaire_ht: 6, prix_source: "grille", calcul: "3,50 × 4,20" },
            { designation: "Peinture plafond 2 couches", detail: "Acrylique mate", quantite: 14.7, unite: "m²", prix_unitaire_ht: 17, prix_source: "grille", calcul: "3,50 × 4,20" },
          ],
        },
      ],
      taux_tva: 10,
      duree_estimee: "4 jours",
      hypotheses: ["Mode démo : ce devis est un exemple fixe, configure ANTHROPIC_API_KEY pour un vrai chiffrage."],
    },
  };
  return { ...sortie, devis: calculerTotaux(sortie.devis), brut: JSON.stringify(sortie) };
}
