import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { discuter, modeDemo } from "./src/ia.js";
import { TARIFS_PAR_DEFAUT } from "./src/tarifs.js";

const app = express();
app.use(express.json({ limit: "25mb" })); // photos de notes papier en base64
app.use(express.static("public"));
// Même module de calcul côté navigateur (recalcul instantané après modification d'une ligne).
app.get("/calcul.js", (_req, res) => res.sendFile("src/calcul.js", { root: "." }));

app.get("/api/config", (_req, res) => {
  res.json({ demo: modeDemo(), tarifs: TARIFS_PAR_DEFAUT });
});

app.post("/api/discuter", async (req, res) => {
  const { historique, entreprise, tarifs } = req.body ?? {};
  if (!Array.isArray(historique) || historique.length === 0) {
    return res.status(400).json({ erreur: "Historique de conversation manquant." });
  }
  try {
    const resultat = await discuter({
      historique,
      entreprise: entreprise ?? {},
      tarifs: Array.isArray(tarifs) && tarifs.length ? tarifs : TARIFS_PAR_DEFAUT,
    });
    res.json(resultat);
  } catch (err) {
    console.error(err);
    let message = err.message || "Erreur inconnue.";
    if (err instanceof Anthropic.AuthenticationError) message = "Clé API invalide : vérifie ANTHROPIC_API_KEY.";
    else if (err instanceof Anthropic.RateLimitError) message = "Trop de demandes en même temps, réessaie dans un instant.";
    else if (err instanceof Anthropic.APIConnectionError) message = "Impossible de joindre le service IA (connexion).";
    else if (err instanceof Anthropic.APIError) message = `Erreur du service IA (${err.status}).`;
    res.status(502).json({ erreur: message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Cagot prêt sur http://localhost:${port}${modeDemo() ? " (mode démo : pas de clé API)" : ""}`);
});
