import { z } from "zod";

// Validation stricte de ce que l'appli envoie à l'IA (serveur Node et fonction Supabase).
const Image = z.string().max(8_000_000).regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/);
export const Requete = z.object({
  historique: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        texte: z.string().max(50_000).default(""),
        brut: z.string().max(200_000).optional(),
        images: z.array(Image).max(10).optional(),
      }),
    )
    .min(1)
    .max(80)
    .refine((h) => h[0]?.role === "user" && h.at(-1)?.role === "user", "L'historique doit commencer et finir par l'artisan."),
  entreprise: z
    .object({
      nom: z.string().max(200).optional(),
      metiers: z.array(z.string().max(40)).max(40).optional(),
      franchise_tva: z.boolean().optional(),
    })
    .default({}),
  tarifs: z
    .array(
      z.object({
        corps_etat: z.string().max(40).default(""),
        designation: z.string().max(300),
        unite: z.string().max(20),
        prix: z.number().nonnegative().max(1_000_000),
      }),
    )
    .max(2000)
    .default([]),
});
