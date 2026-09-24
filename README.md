# Cagot – Devis & factures pour les artisans du bâtiment

Sur le chantier, tu dictes ou tapes tes notes (ou tu prends en photo tes notes papier).
L'IA reconstitue les travaux, **te pose des questions s'il manque une mesure ou une info**,
puis rédige un devis complet, chiffré avec **ta** grille de prix, prêt à envoyer.
Un clic transforme le devis en facture.

## Fonctionnalités (v0.1)

- **Dictée vocale** (micro, français) et **réponses à voix haute** ; mode **mains libres** :
  l'IA pose sa question, puis le micro se rouvre tout seul pour ta réponse.
- **Photo des notes papier** : l'IA lit l'écriture manuscrite et les croquis cotés.
- **Questions de l'IA** quand il manque quelque chose (dimensions, hauteur sous plafond,
  ouvertures, plafond inclus ou non, TVA…), 5 maximum à la fois.
- **Étapes techniques ajoutées automatiquement** (ex. dépose papier peint → lessivage →
  rebouchage → ratissage → ponçage → impression → 2 couches), avec le détail du calcul des surfaces.
- **Totaux calculés par le logiciel**, jamais par l'IA (pas d'erreur de calcul).
- **Devis modifiable** directement (quantités, prix, libellés) ou en redemandant à l'IA.
- **Transformer en facture**, avec les mentions légales (échéance, pénalités, 40 €, TVA réduite,
  décennale, franchise en base de TVA pour les auto-entrepreneurs).
- **PDF / impression** et **envoi** (partage du téléphone ou e-mail).
- **Réglages** : infos entreprise (SIRET, assurance décennale, IBAN…) et grille de prix personnelle.

## Lancer l'appli

```bash
npm install
cp .env.example .env      # puis mets ta clé ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

Sans clé API, l'appli démarre en **mode démo** (scénario fixe « chambre avec papier peint »)
pour tester l'interface.

Sur téléphone : ouvre l'adresse du serveur dans Chrome (Android) ou Safari (iPhone), puis
« Ajouter à l'écran d'accueil ». La dictée vocale demande une connexion **HTTPS** (ou localhost).

## Organisation du code

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur Express : API `/api/discuter`, fichiers de l'interface |
| `src/ia.js` | Prompt et appel à Claude (sortie JSON structurée : questions ou devis) |
| `src/calcul.js` | Calcul des totaux HT / TVA / TTC (partagé serveur + navigateur) |
| `src/tarifs.js` | Grille de prix par défaut |
| `src/demo.js` | Réponses du mode démo |
| `public/` | Interface mobile (HTML/CSS/JS sans framework) |

`npm test` lance les tests des calculs.

## Limites actuelles / prochaines étapes

- Les données (devis, factures, réglages) sont stockées **dans le navigateur du téléphone** :
  pas encore de compte ni de synchronisation (prochaine étape : base de données + connexion).
- PDF via la fonction « Imprimer → Enregistrer en PDF » du téléphone.
- Signature électronique, suivi des paiements, relances, facturation électronique (obligatoire
  progressivement à partir de 2026) : à venir.
