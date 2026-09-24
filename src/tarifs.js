// Bibliothèque de prix par défaut (prix HT indicatifs, à adapter par chaque artisan
// depuis l'écran « Paramètres »). L'IA s'en sert en priorité pour chiffrer.
export const TARIFS_PAR_DEFAUT = [
  // Préparation / protection
  { code: "PROT", designation: "Protection des sols et mobilier (bâche, adhésif)", unite: "m²", prix: 2.5 },
  { code: "DEPL", designation: "Déplacement et installation de chantier", unite: "forfait", prix: 45 },
  { code: "EVAC", designation: "Évacuation des déchets en déchetterie", unite: "forfait", prix: 60 },

  // Murs
  { code: "DEPP", designation: "Dépose de papier peint (décollage, grattage)", unite: "m²", prix: 8 },
  { code: "DEPT", designation: "Dépose de toile de verre", unite: "m²", prix: 10 },
  { code: "LESS", designation: "Lessivage des murs", unite: "m²", prix: 4 },
  { code: "REBO", designation: "Rebouchage fissures et trous", unite: "m²", prix: 5 },
  { code: "RATI", designation: "Ratissage (enduit de lissage) 2 passes", unite: "m²", prix: 14 },
  { code: "PONC", designation: "Ponçage et dépoussiérage", unite: "m²", prix: 4 },
  { code: "IMPR", designation: "Impression (sous-couche) murs", unite: "m²", prix: 5 },
  { code: "PEIM", designation: "Peinture murs acrylique velours 2 couches", unite: "m²", prix: 14 },
  { code: "TVER", designation: "Pose de toile de verre + peinture 2 couches", unite: "m²", prix: 24 },
  { code: "PPNT", designation: "Pose de papier peint intissé", unite: "m²", prix: 18 },

  // Plafonds
  { code: "RATP", designation: "Ratissage plafond 2 passes", unite: "m²", prix: 18 },
  { code: "IMPP", designation: "Impression (sous-couche) plafond", unite: "m²", prix: 6 },
  { code: "PEIP", designation: "Peinture plafond mate 2 couches", unite: "m²", prix: 17 },

  // Boiseries / menuiseries
  { code: "PBOI", designation: "Peinture boiseries (plinthes) glycéro/acrylique", unite: "ml", prix: 9 },
  { code: "PPOR", designation: "Peinture porte 2 faces + huisserie", unite: "u", prix: 110 },
  { code: "PFEN", designation: "Peinture fenêtre 2 faces", unite: "u", prix: 130 },
  { code: "PRAD", designation: "Peinture radiateur (laque)", unite: "u", prix: 70 },

  // Sols
  { code: "DMOQ", designation: "Dépose de moquette collée", unite: "m²", prix: 9 },
  { code: "RAGR", designation: "Ragréage autolissant", unite: "m²", prix: 22 },
  { code: "PARQ", designation: "Pose de parquet flottant (hors fourniture)", unite: "m²", prix: 25 },
  { code: "CARR", designation: "Pose de carrelage sol (hors fourniture)", unite: "m²", prix: 45 },

  // Main d'œuvre générique
  { code: "MOHR", designation: "Main d'œuvre (taux horaire)", unite: "h", prix: 45 },
];
