import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { calculerTotaux } from "./calcul.js";
import { devisDeDemo } from "./demo.js";
import { CONSIGNES, promptArtisan } from "./prompt.js";

const Ligne = z.object({
  designation: z.string().describe("Libellé clair de la prestation, tel qu'il apparaîtra sur le devis"),
  detail: z.string().describe("Précisions techniques (produit, épaisseur, nombre de couches, méthode, norme). Chaîne vide si rien à ajouter."),
  quantite: z.number(),
  unite: z.string().describe("m², m³, ml, u, h, forfait, jour, ens…"),
  prix_unitaire_ht: z.number(),
  prix_source: z
    .enum(["grille", "estime"])
    .describe("'grille' si le prix vient de la grille de l'artisan, 'estime' si tu l'as estimé toi-même"),
  calcul: z.string().describe("Comment la quantité a été obtenue, ex: '(3,50+4,20)×2×2,50 − 1,7 porte − 1,8 fenêtre'. Chaîne vide si non applicable."),
  option: z.boolean().describe("true si la ligne est proposée en option au client (non comptée dans le total tant qu'il ne la choisit pas), sinon false"),
});

const Devis = z.object({
  titre: z.string().describe("Ex: 'Rénovation salle de bain', 'Réfection toiture'"),
  client_nom: z.string().describe("Nom du client s'il a été donné, sinon chaîne vide"),
  client_adresse: z.string(),
  client_email: z.string().describe("E-mail du client s'il a été donné, sinon chaîne vide"),
  adresse_chantier: z.string(),
  description: z.string().describe("Résumé des travaux en 2-3 phrases pour le client"),
  sections: z.array(
    z.object({
      titre: z.string().describe("Lot ou zone, ex: 'Préparation', 'Salle de bain – Plomberie', 'Chambre – Murs'"),
      lignes: z.array(Ligne),
    }),
  ),
  taux_tva: z.number().describe("5.5, 10 ou 20"),
  duree_estimee: z.string().describe("Ex: '3 jours'"),
  hypotheses: z.array(z.string()).describe("Hypothèses retenues faute d'information, et points à vérifier par l'artisan"),
});

const Piece = z.object({
  piece: z.string().describe("Nom de la pièce tel qu'écrit sur le plan (Séjour, Chambre 1…)"),
  surface_sol_m2: z.number().describe("Surface au sol en m² (celle écrite sur le plan en priorité)"),
  perimetre_ml: z.number().describe("Périmètre en mètres linéaires, 0 si impossible à déterminer"),
  hauteur_m: z.number().describe("Hauteur sous plafond retenue (2,50 par défaut si non indiquée)"),
  surface_murs_m2: z.number().describe("Surface des murs = périmètre × hauteur − ouvertures, 0 si périmètre inconnu"),
  source: z.enum(["plan", "cotes", "echelle", "estime"]).describe("'plan' = surface écrite sur le plan, 'cotes' = calculée avec les cotes, 'echelle' = mesurée à l'échelle, 'estime' = estimation"),
  remarque: z.string().describe("Doute ou précision utile, chaîne vide sinon"),
});

const Reponse = z.object({
  statut: z.enum(["questions", "devis", "metre"]),
  message: z
    .string()
    .describe("Ce que l'assistant dit à l'artisan : court, naturel, lisible à voix haute (pas de tableau ni de markdown)"),
  questions: z.array(z.string()).describe("Questions précises encore ouvertes (vide si statut = devis)"),
  suggestions: z
    .array(z.array(z.string()))
    .describe("Pour chaque question, dans le même ordre : 2 à 4 réponses courtes probables à toucher du doigt (ex: ['2,50 m', '2,70 m']). Tableau vide pour une question vraiment ouverte."),
  devis: Devis.nullable().describe("Le devis complet si statut = devis, sinon null"),
  metre: z.array(Piece).describe("Si statut = metre : une ligne par pièce repérée sur le plan, sinon tableau vide"),
});

// Historique côté client : [{ role: "user"|"assistant", texte, images?: [dataURL] }]
function versMessagesApi(historique) {
  return historique.map((m) => {
    if (m.role === "assistant") return { role: "assistant", content: m.brut ?? m.texte };
    const contenu = [];
    for (const image of m.images ?? []) {
      const [entete, data] = image.split(",");
      const media_type = entete.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
      if (media_type === "application/pdf") contenu.push({ type: "document", source: { type: "base64", media_type, data } });
      else contenu.push({ type: "image", source: { type: "base64", media_type, data } });
    }
    contenu.push({ type: "text", text: m.texte || "Voici mes notes de chantier (photo)." });
    return { role: "user", content: contenu };
  });
}

// Messages d'erreur montrés à l'artisan (les autres erreurs restent génériques).
export class ErreurIA extends Error {}

// Fabrique indépendante de l'environnement : utilisée par le serveur Node (server.js)
// et par la fonction Supabase (supabase/functions/discuter).
export function creerIA({ apiKey, modele = "claude-opus-5", effort = "high", delaiMs } = {}) {
  const client = apiKey ? new Anthropic({ apiKey, ...(delaiMs ? { timeout: delaiMs, maxRetries: 0 } : {}) }) : null;

  async function discuter({ historique, entreprise, tarifs }) {
    if (!client) return { ...devisDeDemo(historique), demo: true };

    // Streaming : un devis multi-lots peut être long à rédiger.
    const flux = client.beta.messages.stream({
      model: modele,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort, format: betaZodOutputFormat(Reponse) },
      // Si le modèle principal refuse, l'API relance automatiquement sur un modèle de secours.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: CONSIGNES, cache_control: { type: "ephemeral" } },
        { type: "text", text: promptArtisan({ entreprise, tarifs }) },
      ],
      messages: versMessagesApi(historique),
    });
    let reponse;
    try {
      reponse = await flux.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new ErreurIA("Le devis est trop long à rédiger d'un coup : découpe le chantier (par pièce ou par lot) et réessaie.");
      }
      throw err;
    }

    if (reponse.stop_reason === "refusal") {
      throw new ErreurIA("L'IA n'a pas pu traiter cette demande. Reformule tes notes et réessaie.");
    }
    const texte = reponse.content.find((b) => b.type === "text")?.text ?? "";
    let sortie;
    try {
      sortie = Reponse.parse(JSON.parse(texte));
    } catch {
      throw new ErreurIA("Réponse de l'IA incomplète, réessaie.");
    }
    return {
      ...sortie,
      devis: sortie.devis ? calculerTotaux(sortie.devis) : null,
      brut: JSON.stringify(sortie),
      demo: false,
    };
  }

  return { demo: client === null, discuter };
}

// Traduit une erreur en message pour l'artisan, sans exposer de détail interne.
export function messageErreur(err) {
  if (err instanceof ErreurIA) return err.message;
  if (err instanceof Anthropic.RateLimitError) return "Trop de demandes en même temps, réessaie dans un instant.";
  if (err instanceof Anthropic.APIConnectionError) return "Impossible de joindre le service IA (connexion).";
  if (err instanceof Anthropic.APIError) return "Le service IA est indisponible, réessaie.";
  return "Erreur inattendue, réessaie.";
}
