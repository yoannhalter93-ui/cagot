// Construit la version d'essai (une seule page HTML) publiable sur claude.ai.
// Usage : node scripts/construire-essai.mjs  ->  dist/cagot-essai.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Modules concaténés dans l'ordre des dépendances ; les import/export sont retirés.
const modules = ["src/calcul.js", "src/corps-etat.js", "src/prompt.js", "scripts/essai/plateforme-essai.js", "public/app.js"];
const code = modules
  .map((f) => `// ---- ${f}\n${lire(f).replace(/^import [^;]+;\n/gm, "").replace(/^export /gm, "")}`)
  .join("\n");

const index = lire("public/index.html");
const corps = index
  .slice(index.indexOf("<body>") + "<body>".length, index.indexOf("</body>"))
  .replace(/\s*<script[^>]*><\/script>/g, "");

const page = `<title>Cagot</title>
<style>
${lire("public/style.css")}
</style>
${corps.trim()}
<script type="module">
${code}
</script>
`;

mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/cagot-essai.html", import.meta.url), page);
console.log(`dist/cagot-essai.html (${Math.round(page.length / 1024)} Ko)`);
