import { calculerTotaux } from "./calcul.js";

// Mode démo (aucune clé API configurée) : permet de tester l'interface de bout en bout
// avec un scénario fixe « chambre avec papier peint ».
export function devisDeDemo(historique) {
  const tout = historique.filter((m) => m.role === "user").map((m) => m.texte ?? "").join(" ");
  const aDesMesures = /\d/.test(tout);

  const dernier = historique.at(-1) ?? {};
  if ((dernier.images ?? []).length && /plan|scann|métré|metre/i.test(dernier.texte ?? "")) {
    const sortie = {
      statut: "metre",
      message: "Mode démo : métré d'EXEMPLE (l'IA n'est pas branchée). Vérifie les mesures avant de t'en servir.",
      questions: [],
      suggestions: [],
      devis: null,
      metre: [
        { piece: "Séjour", surface_sol_m2: 31.21, perimetre_ml: 23.1, hauteur_m: 2.5, surface_murs_m2: 51.1, source: "plan", remarque: "" },
        { piece: "Cuisine", surface_sol_m2: 9.99, perimetre_ml: 12.7, hauteur_m: 2.5, surface_murs_m2: 28.3, source: "plan", remarque: "" },
        { piece: "Chambre 1", surface_sol_m2: 11.7, perimetre_ml: 13.7, hauteur_m: 2.5, surface_murs_m2: 30.8, source: "plan", remarque: "Hauteur non indiquée : 2,50 m retenu" },
      ],
    };
    return { ...sortie, brut: JSON.stringify(sortie) };
  }
  if (!aDesMesures) {
    const sortie = {
      statut: "questions",
      message:
        "Mode démo : l'IA n'est pas encore branchée, je ne lis pas tes notes. Voici des questions d'EXEMPLE ; réponds avec un chiffre pour voir un devis d'exemple.",
      questions: [
        "Quelles sont la longueur et la largeur de la chambre ?",
        "Quelle est la hauteur sous plafond ?",
        "Combien de portes et de fenêtres, et quelles dimensions pour les fenêtres ?",
        "Le plafond est-il à repeindre aussi ?",
      ],
      suggestions: [["3 × 4 m", "3,5 × 4,2 m"], ["2,50 m", "2,70 m"], ["1 porte, 1 fenêtre", "1 porte, 2 fenêtres"], ["Oui", "Non"]],
      devis: null,
      metre: [],
    };
    return { ...sortie, brut: JSON.stringify(sortie) };
  }

  // Chambre 3,50 × 4,20 × 2,50, 1 porte, 1 fenêtre 1,20 × 1,50
  const murs = 38.5 - 1.7 - 1.8; // 35,00 m²
  const sortie = {
    statut: "devis",
    message:
      "Mode démo : l'IA n'est pas encore branchée, je ne lis pas tes notes. Voici un devis d'EXEMPLE fixe (une chambre) pour essayer l'appli. Ajoute la clé de l'IA pour un vrai devis.",
    questions: [],
    suggestions: [],
    metre: [],
    devis: {
      titre: "EXEMPLE – Rénovation peinture chambre",
      client_nom: "",
      client_adresse: "",
      client_email: "",
      adresse_chantier: "",
      description:
        "Dépose du papier peint existant, préparation des murs (lessivage, rebouchage, ratissage, ponçage), impression et mise en peinture des murs et du plafond de la chambre.",
      sections: [
        {
          titre: "Préparation du chantier",
          lignes: [
            { designation: "Protection des sols et mobilier", detail: "Bâche + adhésif de masquage", quantite: 14.7, unite: "m²", prix_unitaire_ht: 2.5, prix_source: "estime", calcul: "3,50 × 4,20", option: false },
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
      hypotheses: ["MODE DÉMO : ce devis est un exemple fixe qui ne correspond pas à tes notes. Ajoute la clé de l'IA (ANTHROPIC_API_KEY dans Supabase) pour un vrai chiffrage."],
    },
  };
  return { ...sortie, devis: calculerTotaux(sortie.devis), brut: JSON.stringify(sortie) };
}
