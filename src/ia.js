import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { calculerTotaux } from "./calcul.js";
import { devisDeDemo } from "./demo.js";

const MODELE = process.env.CLAUDE_MODEL || "claude-opus-5";

const Ligne = z.object({
  designation: z.string().describe("Libellé clair de la prestation, tel qu'il apparaîtra sur le devis"),
  detail: z.string().describe("Précisions techniques (produit, nombre de couches, méthode). Chaîne vide si rien à ajouter."),
  quantite: z.number(),
  unite: z.string().describe("m², ml, u, h, forfait, jour…"),
  prix_unitaire_ht: z.number(),
  calcul: z.string().describe("Comment la quantité a été obtenue, ex: '(3,50+4,20)×2×2,50 − 1,6 porte − 1,8 fenêtre'. Chaîne vide si non applicable."),
});

const Devis = z.object({
  titre: z.string().describe("Ex: 'Rénovation peinture chambre 1'"),
  client_nom: z.string().describe("Nom du client s'il a été donné, sinon chaîne vide"),
  client_adresse: z.string(),
  adresse_chantier: z.string(),
  description: z.string().describe("Résumé des travaux en 2-3 phrases pour le client"),
  sections: z.array(
    z.object({
      titre: z.string().describe("Ex: 'Chambre – Murs', 'Chambre – Plafond', 'Préparation'"),
      lignes: z.array(Ligne),
    }),
  ),
  taux_tva: z.number().describe("5.5, 10 ou 20"),
  duree_estimee: z.string().describe("Ex: '3 jours'"),
  hypotheses: z.array(z.string()).describe("Hypothèses retenues faute d'information (à valider par l'artisan)"),
});

const Reponse = z.object({
  statut: z.enum(["questions", "devis"]),
  message: z
    .string()
    .describe("Ce que l'assistant dit à l'artisan : court, naturel, lisible à voix haute (pas de tableau ni de markdown)"),
  questions: z.array(z.string()).describe("Questions précises encore ouvertes (vide si statut = devis)"),
  devis: Devis.nullable().describe("Le devis complet si statut = devis, sinon null"),
});

function formaterTarifs(tarifs) {
  return tarifs.map((t) => `- [${t.code}] ${t.designation} : ${t.prix} € HT / ${t.unite}`).join("\n");
}

function promptSysteme({ entreprise, tarifs }) {
  return `Tu es l'assistant de chiffrage d'un artisan du bâtiment en France (${entreprise?.metier || "peinture, revêtements, second œuvre"}).
L'artisan te transmet ses notes de chantier (texte tapé, dictée vocale retranscrite, ou photo de notes papier) et tu rédiges un devis professionnel, précis et prêt à envoyer.

## Comment travailler
1. Reconstitue le chantier : pièces, supports (murs, plafond, sols, boiseries), état actuel, travaux demandés.
2. Déduis toutes les étapes techniques nécessaires selon les règles de l'art, même si l'artisan ne les cite pas toutes. Exemple : dépose de papier peint → lessivage → rebouchage → ratissage → ponçage → impression → peinture 2 couches. Ajoute protection des sols, et nettoyage/évacuation si pertinent.
3. Calcule les quantités toi-même à partir des mesures :
   - surface des murs = périmètre × hauteur sous plafond − ouvertures (porte standard ≈ 0,83 × 2,04 m ≈ 1,7 m², fenêtre selon dimensions données) ;
   - surface du plafond = longueur × largeur ;
   - plinthes (ml) = périmètre − largeurs de portes.
   Indique le détail du calcul dans le champ "calcul". Arrondis les quantités à 2 décimales.
4. Chiffre avec la grille de prix de l'artisan ci-dessous en priorité. Si une prestation n'y figure pas, propose un prix de marché réaliste et signale-le dans "hypotheses".
5. TVA : 10 % pour des travaux de rénovation dans un logement de plus de 2 ans, 5,5 % pour la rénovation énergétique, 20 % pour le neuf ou les locaux professionnels. Si tu ne sais pas, demande (ou prends 10 % pour de la rénovation de logement et signale-le).

## Quand poser des questions
Tu dois être précis : si une information INDISPENSABLE au chiffrage manque (dimensions d'une pièce, hauteur sous plafond, nombre de portes/fenêtres, état du support qui change la méthode, plafond inclus ou non…), réponds avec statut = "questions", un message court et naturel (il peut être lu à voix haute sur le chantier) et la liste des questions. Pose toutes les questions nécessaires en une seule fois, maximum 5, les plus importantes d'abord. Ne pose pas de question sur ce que tu peux raisonnablement supposer : suppose-le et note-le dans "hypotheses".
Quand tu as assez d'informations, réponds avec statut = "devis" et le devis complet. Le message résume en une ou deux phrases ce que tu as chiffré.
Si l'artisan demande une modification d'un devis déjà produit, renvoie le devis complet modifié.

## Grille de prix de l'artisan (HT)
${formaterTarifs(tarifs)}

Ne calcule pas les totaux : le logiciel s'en charge à partir des quantités et prix unitaires.`;
}

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

  const reponse = await client.beta.messages.parse({
    model: MODELE,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(Reponse) },
    // Si le modèle principal refuse, l'API relance automatiquement sur un modèle de secours.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: promptSysteme({ entreprise, tarifs }), cache_control: { type: "ephemeral" } }],
    messages: versMessagesApi(historique),
  });

  if (reponse.stop_reason === "refusal") {
    throw new Error("L'IA n'a pas pu traiter cette demande. Reformule tes notes et réessaie.");
  }
  if (reponse.stop_reason === "max_tokens" || !reponse.parsed_output) {
    throw new Error("Réponse de l'IA incomplète, réessaie.");
  }

  const sortie = reponse.parsed_output;
  const brut = JSON.stringify(sortie);
  return {
    ...sortie,
    devis: sortie.devis ? calculerTotaux(sortie.devis) : null,
    brut,
  };
}
