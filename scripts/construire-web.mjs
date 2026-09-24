// Construit le site statique (dist/web) à publier sur n'importe quel hébergeur de fichiers
// (Cloudflare Pages, Netlify, GitHub Pages…). Tout ce qui dépend de l'hébergement est dans
// config.json : changer d'hébergeur ou d'API = changer ces variables, pas l'appli.
//
// Variables (facultatives, valeurs par défaut = projet Supabase « cagot ») :
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, API_URL
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const racine = new URL("../", import.meta.url);
const sortie = new URL("dist/web/", racine);
const SUPABASE_URL = process.env.SUPABASE_URL || "https://waaohyrvqnpukurbgtay.supabase.co";
const config = {
  supabaseUrl: SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_ZxBR_8BuFWNdHoeyKLKLhA_p7wvik6_",
  apiUrl: process.env.API_URL || `${SUPABASE_URL}/functions/v1/discuter`,
};

rmSync(sortie, { recursive: true, force: true });
mkdirSync(new URL("vendor/", sortie), { recursive: true });
cpSync(new URL("public/", racine), sortie, { recursive: true });
cpSync(new URL("src/calcul.js", racine), new URL("calcul.js", sortie));
cpSync(new URL("src/corps-etat.js", racine), new URL("corps-etat.js", sortie));
cpSync(new URL("node_modules/@supabase/supabase-js/dist/umd/supabase.js", racine), new URL("vendor/supabase.js", sortie));
writeFileSync(new URL("config.json", sortie), `${JSON.stringify(config, null, 2)}\n`);

// En-têtes de sécurité (format Cloudflare Pages / Netlify)
const supabaseWs = SUPABASE_URL.replace(/^http/, "ws");
const apiOrigine = new URL(config.apiUrl, "https://exemple.invalid").origin;
const connect = ["'self'", SUPABASE_URL, supabaseWs, apiOrigine].filter((v, i, t) => !v.includes("exemple.invalid") && t.indexOf(v) === i);
writeFileSync(
  new URL("_headers", sortie),
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src ${connect.join(" ")}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(self), geolocation=()

/config.json
  Cache-Control: no-store
`,
);
console.log(`dist/web prêt — API : ${config.apiUrl}`);
