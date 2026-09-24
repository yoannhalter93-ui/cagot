// Copie le code partagé (src/) dans la fonction Supabase, qui ne peut pas importer hors de son dossier.
import { cpSync, mkdirSync, rmSync } from "node:fs";

const cible = new URL("../supabase/functions/discuter/_partage/", import.meta.url);
rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });
for (const f of ["ia.js", "prompt.js", "corps-etat.js", "calcul.js", "demo.js", "requete.js"]) {
  cpSync(new URL(`../src/${f}`, import.meta.url), new URL(f, cible));
}
console.log("supabase/functions/discuter/_partage/ à jour");
