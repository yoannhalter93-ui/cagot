# Cagot – Devis & factures pour les artisans du bâtiment

Sur le chantier, tu dictes ou tapes tes notes (ou tu prends en photo tes notes papier).
L'IA reconstitue les travaux, **te pose des questions s'il manque une mesure ou une info**,
puis rédige un devis complet, chiffré avec **ta** grille de prix, prêt à envoyer.
Un clic transforme le devis en facture.

## Fonctionnalités (v0.2)

- **Tous corps d'état** : démolition, gros œuvre, charpente, couverture, façade, menuiseries,
  plâtrerie-isolation, électricité, plomberie, chauffage-ventilation, carrelage, sols, peinture,
  serrurerie, aménagements extérieurs… L'IA connaît les points à vérifier pour chacun.
- **Comptes et sauvegarde en ligne sécurisée** (Supabase) : chaque artisan n'accède qu'à ses données.
- **Ta grille de prix**, saisie dans l'appli et classée par corps d'état. Quand un prix manque,
  l'IA l'estime, le surligne sur le devis, et tu l'ajoutes à ta grille en un clic.
- **Factures conformes** : brouillon modifiable, puis émission avec numéro chronologique sans trou ;
  une facture émise est verrouillée (ni modifiable ni supprimable), statut « payée ».
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
- **Réglages** : infos entreprise (SIRET, assurance décennale, IBAN…), métiers exercés, grille de prix.

## Lancer l'appli

```bash
npm install
cp .env.example .env      # puis mets ta clé ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

Sans clé Anthropic, l'IA fonctionne en **mode démo** (scénario fixe « chambre avec papier peint »)
pour tester l'interface.

Sur téléphone : ouvre l'adresse du serveur dans Chrome (Android) ou Safari (iPhone), puis
« Ajouter à l'écran d'accueil ». La dictée vocale demande une connexion **HTTPS** (ou localhost).

## Organisation du code

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur Express : API `/api/discuter`, fichiers de l'interface |
| `src/ia.js` | Prompt et appel à Claude (sortie JSON structurée : questions ou devis) |
| `src/calcul.js` | Calcul des totaux HT / TVA / TTC (partagé serveur + navigateur) |
| `src/corps-etat.js` | Corps d'état et points à vérifier par l'IA |
| `supabase/migrations/` | Schéma de la base, règles de sécurité (RLS), numérotation des factures |
| `src/demo.js` | Réponses du mode démo |
| `public/` | Interface mobile (HTML/CSS/JS sans framework) |

`npm test` lance les tests des calculs.

## Sécurité

- **Connexion obligatoire** (e-mail + mot de passe de 10 caractères minimum, confirmation par e-mail).
- **Isolation des données** : règles RLS dans la base, un artisan ne peut ni lire ni modifier les données
  d'un autre, même en appelant la base directement. Les visiteurs non connectés n'ont accès à rien.
- **Factures inviolables** : numérotation faite par la base (impossible de sauter ou réutiliser un numéro),
  facture émise verrouillée par un déclencheur SQL.
- **IA protégée** : réservée aux comptes connectés (jeton vérifié), limitée par adresse IP et par compte,
  requêtes validées (taille, format des photos). La clé Anthropic reste sur le serveur.
- **En-têtes de sécurité** (CSP stricte, HSTS, anti-iframe) via helmet.

À faire dans le tableau de bord Supabase (Authentication) avant la mise en ligne :
1. *URL Configuration* : mettre l'adresse du site dans **Site URL** et **Redirect URLs**
   (sinon les liens de confirmation et de mot de passe oublié ne marchent pas).
2. *Providers → Email* : laisser **Confirm email** activé, longueur minimale du mot de passe à 10.
3. *Emails / SMTP* : brancher un vrai service d'e-mail (le service intégré est limité à quelques envois par heure).

## Limites actuelles / prochaines étapes

- PDF via la fonction « Imprimer → Enregistrer en PDF » du téléphone.
- Avoirs, signature électronique, relances de paiement, double authentification, facturation
  électronique (obligatoire progressivement à partir de 2026) : à venir.
