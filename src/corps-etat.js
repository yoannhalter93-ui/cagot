// Corps d'état du bâtiment : liste proposée dans les réglages, et points de vigilance
// que l'IA doit vérifier (questions à poser) pour chacun.
export const CORPS_ETAT = [
  { id: "demolition", nom: "Démolition / curage", verifier: "nature des matériaux, amiante/plomb (diagnostic avant travaux si bâtiment d'avant 1997/1949), évacuation et tri des gravats, accès benne" },
  { id: "terrassement", nom: "Terrassement / VRD", verifier: "volumes (L×l×profondeur), nature du sol, accès engins, évacuation des terres, réseaux existants (DICT)" },
  { id: "maconnerie", nom: "Maçonnerie / gros œuvre", verifier: "dimensions, épaisseurs, type de blocs/béton, ferraillage, fondations, ouvertures et linteaux, étaiement, besoin d'un bureau d'études pour mur porteur" },
  { id: "charpente", nom: "Charpente", verifier: "portées, section des bois, type (traditionnelle/fermettes), traitement, surface de toiture, pente" },
  { id: "couverture", nom: "Couverture / zinguerie", verifier: "surface et pente du toit, type de couverture existante et neuve, faîtage/rives/noues (ml), gouttières et descentes (ml), échafaudage ou nacelle, hauteur" },
  { id: "etancheite", nom: "Étanchéité", verifier: "surface, support, relevés (ml), type de membrane, isolation, évacuations EP" },
  { id: "facade", nom: "Façade / ravalement / ITE", verifier: "surface de façade (déduire les ouvertures), hauteur et échafaudage, état du support, type de finition ou d'isolant et épaisseur, appuis et tableaux" },
  { id: "menuiserie_ext", nom: "Menuiseries extérieures", verifier: "nombre et dimensions exactes (L×H) de chaque menuiserie, matériau (PVC/alu/bois), vitrage, pose en rénovation ou dépose totale, volets" },
  { id: "menuiserie_int", nom: "Menuiseries intérieures / agencement", verifier: "nombre et dimensions des portes, sens d'ouverture, type de bloc-porte, placards (L×H×P), plinthes" },
  { id: "platrerie", nom: "Plâtrerie / plaquiste / isolation", verifier: "surfaces des cloisons, doublages et plafonds, hauteur, type de plaque (standard/hydro/phonique/feu), isolant et épaisseur (R), bandes et joints" },
  { id: "electricite", nom: "Électricité", verifier: "nombre de points (prises, interrupteurs, points lumineux, RJ45), tableau électrique existant, mise en conformité NF C 15-100, encastré ou apparent, consuel si rénovation totale" },
  { id: "plomberie", nom: "Plomberie / sanitaire", verifier: "appareils à poser (WC, lavabo, douche, baignoire, évier), longueurs d'alimentation et d'évacuation, matériaux (PER, multicouche, cuivre), production d'eau chaude" },
  { id: "chauffage", nom: "Chauffage / climatisation / ventilation", verifier: "surface et volume à chauffer, isolation, type d'équipement et puissance, nombre d'émetteurs ou d'unités, VMC (simple/double flux), évacuation des condensats, certification RGE pour les aides" },
  { id: "carrelage", nom: "Carrelage / faïence", verifier: "surfaces sol et murs, format des carreaux, pose droite ou diagonale, dépose de l'existant, ragréage, étanchéité sous carrelage (SPEC) en pièce humide, plinthes (ml), fourniture incluse ou non" },
  { id: "sols", nom: "Sols souples / parquet", verifier: "surface, état et planéité du support, ragréage, type de revêtement, sous-couche, plinthes et barres de seuil" },
  { id: "peinture", nom: "Peinture / revêtements muraux", verifier: "dimensions des pièces, hauteur sous plafond, nombre et taille des ouvertures, état des supports (papier peint, fissures), plafonds, boiseries et radiateurs" },
  { id: "serrurerie", nom: "Serrurerie / métallerie", verifier: "dimensions des ouvrages (garde-corps, portail, escalier), matériau, finition (galva, thermolaquage), fixation" },
  { id: "cuisine_sdb", nom: "Cuisine / salle de bain clé en main", verifier: "plan et dimensions de la pièce, liste des meubles et équipements, fourniture par qui, tous les lots concernés (plomberie, électricité, carrelage, peinture)" },
  { id: "paysage", nom: "Aménagements extérieurs", verifier: "surfaces (terrasse, allée), matériaux, fondations, évacuations, clôtures (ml et hauteur)" },
];

export const nomCorpsEtat = (id) => CORPS_ETAT.find((c) => c.id === id)?.nom ?? id;
