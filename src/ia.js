import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { calculerTotaux } from "./calcul.js";
import { devisDeDemo } from "./demo.js";
import { CONSIGNES, promptArtisan } from "./prompt.js";

const MODELE = process.env.CLAUDE_MODEL || "claude-opus-5";

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
});

const Devis = z.object({
  titre: z.string().describe("Ex: 'Rénovation salle de bain', 'Réfection toiture'"),
  client_nom: z.string().describe("Nom du client s'il a été donné, sinon chaîne vide"),
  client_adresse: z.string(),
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

const Reponse = z.object({
  statut: z.enum(["questions", "devis"]),
  message: z
    .string()
    .describe("Ce que l'assistant dit à l'artisan : court, naturel, lisible à voix haute (pas de tableau ni de markdown)"),
  questions: z.array(z.string()).describe("Questions précises encore ouvertes (vide si statut = devis)"),
  devis: Devis.nullable().describe("Le devis complet si statut = devis, sinon null"),
});

// Historique côté client : [{ role: "user"|"assistant", texte, images?: [dataURL] }]
function versMessagesApi(historique) {
  return historique.map((m) => {
    if (m.role === "assistant") return { role: "assistant", content: m.brut ?? m.texte };
    const contenu = [];
    for (const image of m.images ?? []) {
      const [entete, data] = image.split(",");
      const media_type = entete.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
      contenu.push({ type: "image", source: { type: "base64", media_type, data } });
    }
    contenu.push({ type: "text", text: m.texte || "Voici mes notes de chantier (photo)." });
    return { role: "user", content: contenu };
  });
}

const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;

export const modeDemo = () => client === null;

export async function discuter({ historique, entreprise, tarifs }) {
  if (!client) return devisDeDemo(historique);

  // Streaming : un devis multi-lots peut être long à rédiger.
  const flux = client.beta.messages.stream({
    model: MODELE,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(Reponse) },
    // Si le modèle principal refuse, l'API relance automatiquement sur un modèle de secours.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: CONSIGNES, cache_control: { type: "ephemeral" } },
      { type: "text", text: promptArtisan({ entreprise, tarifs }) },
    ],
    messages: versMessagesApi(historique),
  });
  const reponse = await flux.finalMessage();

  if (reponse.stop_reason === "refusal") {
    throw new Error("L'IA n'a pas pu traiter cette demande. Reformule tes notes et réessaie.");
  }
  const texte = reponse.content.find((b) => b.type === "text")?.text ?? "";
  let sortie;
  try {
    sortie = Reponse.parse(JSON.parse(texte));
  } catch {
    throw new Error("Réponse de l'IA incomplète, réessaie.");
  }
  const brut = JSON.stringify(sortie);
  return {
    ...sortie,
    devis: sortie.devis ? calculerTotaux(sortie.devis) : null,
    brut,
  };
}
