// Import de données venant d'un autre logiciel (Henrri, Excel, autre) : lecture des fichiers
// Excel (.xlsx) et CSV sans bibliothèque externe, reconnaissance des colonnes, conversion.

// ---------------------------------------------------------------- lecture des fichiers
export async function lireFichierImport(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const zip = octets[0] === 0x50 && octets[1] === 0x4b; // « PK » : fichier Excel moderne
  if (zip) return lireXlsx(octets);
  if (/\.xls$/i.test(fichier.name)) throw new Error("Ancien format Excel (.xls) : ouvre-le et enregistre-le en .xlsx ou en .csv, puis réessaie.");
  return lireCsv(decoderTexte(octets));
}

export function decoderTexte(octets) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(octets); // exports Excel « CSV » sous Windows
  }
}

export function lireCsv(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0] ?? "";
  const compte = (c) => premiere.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => compte(b) - compte(a))[0];
  const lignes = [];
  let ligne = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"' && champ === "") guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  if (champ !== "" || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((x) => String(x).trim() !== ""));
}

// Fichier .xlsx = archive zip de fichiers XML ; on lit la première feuille.
async function dezipper(octets) {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 70000); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("Fichier Excel illisible.");
  const nb = vue.getUint16(fin + 10, true);
  let pos = vue.getUint32(fin + 16, true);
  const fichiers = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < nb; n++) {
    if (vue.getUint32(pos, true) !== 0x02014b50) break;
    const methode = vue.getUint16(pos + 10, true);
    const taille = vue.getUint32(pos + 20, true);
    const lNom = vue.getUint16(pos + 28, true);
    const lExtra = vue.getUint16(pos + 30, true);
    const lCom = vue.getUint16(pos + 32, true);
    const local = vue.getUint32(pos + 42, true);
    const nom = dec.decode(octets.subarray(pos + 46, pos + 46 + lNom));
    fichiers.set(nom, { methode, taille, local });
    pos += 46 + lNom + lExtra + lCom;
  }
  return async (nom) => {
    const f = fichiers.get(nom);
    if (!f) return null;
    const debut = f.local + 30 + vue.getUint16(f.local + 26, true) + vue.getUint16(f.local + 28, true);
    const brut = octets.subarray(debut, debut + f.taille);
    if (f.methode === 0) return dec.decode(brut);
    const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(flux).text();
  };
}

const xmlImport = (t) => new DOMParser().parseFromString(t, "application/xml");
const colonneImport = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export async function lireXlsx(octets) {
  const lire = await dezipper(octets);
  const classeur = xmlImport((await lire("xl/workbook.xml")) ?? "");
  const premiere = classeur.getElementsByTagName("sheet")[0];
  const rid = premiere?.getAttribute("r:id") ?? premiere?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  let chemin = "xl/worksheets/sheet1.xml";
  const rels = await lire("xl/_rels/workbook.xml.rels");
  if (rels && rid) {
    const r = [...xmlImport(rels).getElementsByTagName("Relationship")].find((x) => x.getAttribute("Id") === rid);
    const cible = r?.getAttribute("Target");
    if (cible) chemin = cible.startsWith("/") ? cible.slice(1) : `xl/${cible.replace(/^\.\//, "")}`;
  }
  const partages = [];
  const ss = await lire("xl/sharedStrings.xml");
  if (ss) for (const si of xmlImport(ss).getElementsByTagName("si")) partages.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  const feuille = await lire(chemin);
  if (!feuille) throw new Error("Feuille Excel introuvable.");
  const lignes = [];
  for (const row of xmlImport(feuille).getElementsByTagName("row")) {
    const ligne = [];
    for (const c of row.getElementsByTagName("c")) {
      const i = colonneImport(c.getAttribute("r") ?? "A");
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      ligne[i] = t === "s" ? partages[Number(v)] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : t === "b" ? (v === "1" ? "oui" : "non") : v;
    }
    lignes.push(Array.from(ligne, (x) => x ?? ""));
  }
  return lignes.filter((l) => l.some((x) => String(x).trim() !== ""));
}

// ---------------------------------------------------------------- colonnes
export const normalImport = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Champ de Cagot → noms de colonnes possibles (Henrri, Excel, autres logiciels).
export const CHAMPS_IMPORT = {
  clients: {
    nom: { libelle: "Nom / raison sociale", mots: ["raison sociale", "societe", "entreprise", "nom du client", "client", "nom complet", "denomination", "nom"] },
    nom_famille: { libelle: "Nom de famille (particuliers)", mots: ["nom de famille", "nom"] },
    prenom: { libelle: "Prénom", mots: ["prenom"] },
    adresse: { libelle: "Adresse", mots: ["adresse", "adresse 1", "rue", "adresse de facturation", "voie"] },
    adresse2: { libelle: "Complément d'adresse", mots: ["adresse 2", "complement", "complement d adresse"] },
    cp: { libelle: "Code postal", mots: ["code postal", "cp", "postal"] },
    ville: { libelle: "Ville", mots: ["ville", "commune", "localite"] },
    telephone: { libelle: "Téléphone", mots: ["telephone", "tel", "portable", "mobile", "telephone portable", "telephone fixe", "gsm"] },
    email: { libelle: "E-mail", mots: ["email", "e mail", "mail", "courriel", "adresse email", "adresse e mail"] },
    siret: { libelle: "SIRET / SIREN", mots: ["siret", "siren"] },
    notes: { libelle: "Notes", mots: ["notes", "note", "commentaire", "commentaires", "remarque"] },
  },
  factures: {
    numero: { libelle: "Numéro", mots: ["numero", "n", "no", "numero de facture", "n facture", "numero document", "reference", "ref", "piece", "n piece"] },
    type: { libelle: "Type (facture, avoir, devis)", mots: ["type", "type de document", "nature"] },
    date: { libelle: "Date", mots: ["date", "date de facture", "date facture", "date d emission", "date document", "date piece"] },
    client: { libelle: "Client", mots: ["client", "nom du client", "raison sociale", "societe", "tiers", "destinataire"] },
    objet: { libelle: "Objet", mots: ["objet", "titre", "libelle", "designation", "intitule"] },
    ht: { libelle: "Total HT", mots: ["total ht", "montant ht", "ht", "net ht", "total hors taxes"] },
    tva: { libelle: "TVA", mots: ["tva", "montant tva", "total tva"] },
    ttc: { libelle: "Total TTC", mots: ["total ttc", "montant ttc", "ttc", "net a payer", "montant", "total"] },
    statut: { libelle: "Statut", mots: ["statut", "etat", "etat du paiement", "reglement", "paye", "payee"] },
  },
};

// Ligne d'en-tête : la première ligne (parmi les 10 premières) qui ressemble le plus à des titres.
export function trouverEntete(lignes) {
  const tous = [...Object.values(CHAMPS_IMPORT.clients), ...Object.values(CHAMPS_IMPORT.factures)].flatMap((c) => c.mots);
  let meilleure = 0;
  let score = -1;
  lignes.slice(0, 10).forEach((l, i) => {
    const s = l.filter((x) => tous.includes(normalImport(x))).length;
    if (s > score) [meilleure, score] = [i, s];
  });
  return meilleure;
}

export function detecterColonnes(entetes, sorte) {
  const titres = entetes.map(normalImport);
  const pris = new Set();
  const choix = {};
  // d'abord les correspondances exactes, puis « contient »
  for (const passe of ["exact", "contient"]) {
    for (const [champ, def] of Object.entries(CHAMPS_IMPORT[sorte])) {
      if (choix[champ] !== undefined) continue;
      for (const mot of def.mots) {
        const i = titres.findIndex((t, k) => !pris.has(k) && (passe === "exact" ? t === mot : mot.length > 2 && (` ${t} `).includes(` ${mot} `)));
        if (i !== -1) {
          choix[champ] = i;
          pris.add(i);
          break;
        }
      }
    }
  }
  return choix;
}

// Type de fichier : des numéros et des montants → factures ; sinon → clients.
export function devinerSorte(entetes) {
  const f = detecterColonnes(entetes, "factures");
  return f.numero !== undefined && (f.ttc !== undefined || f.ht !== undefined) ? "factures" : "clients";
}

// ---------------------------------------------------------------- conversions
export function lireMontant(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  let t = String(v).replace(/[\s  €$]/g, "").replace(/EUR/i, "");
  if (/,\d{1,2}$/.test(t) || (t.includes(",") && !t.includes("."))) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function lireDate(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const n = Number(t); // date Excel (nombre de jours depuis le 30/12/1899)
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  }
  return null;
}

const valImport = (ligne, i) => (i === undefined ? "" : String(ligne[i] ?? "").trim());

export function construireClients(lignes, col) {
  return lignes
    .map((l) => {
      // Entreprise : raison sociale ; particulier : prénom + nom de famille.
      const prenom = valImport(l, col.prenom);
      const famille = valImport(l, col.nom_famille);
      let nom = valImport(l, col.nom) || famille;
      if (!valImport(l, col.nom) || normalImport(nom) === normalImport(famille)) nom = [prenom, famille || valImport(l, col.nom)].filter(Boolean).join(" ");
      const ville = [valImport(l, col.cp), valImport(l, col.ville)].filter(Boolean).join(" ");
      const adresse = [valImport(l, col.adresse), valImport(l, col.adresse2), ville].filter(Boolean).join("\n");
      const siret = valImport(l, col.siret);
      const notes = [siret && `SIRET : ${siret}`, valImport(l, col.notes)].filter(Boolean).join("\n");
      const email = valImport(l, col.email).replace(/\s+/g, "").toLowerCase();
      return {
        nom: nom.slice(0, 200),
        adresse: adresse.slice(0, 500),
        telephone: valImport(l, col.telephone).slice(0, 40),
        email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 200) : "",
        notes: notes.slice(0, 2000),
      };
    })
    .filter((c) => c.nom || c.email);
}

export function typeDocument(texte, numero) {
  const t = normalImport(texte);
  if (/avoir|credit/.test(t) || /^av/i.test(numero)) return "avoir";
  if (/devis/.test(t) || /^dev/i.test(numero)) return "devis";
  return "facture";
}

export function construireFactures(lignes, col, source = "import") {
  return lignes
    .map((l) => {
      const numero = valImport(l, col.numero).slice(0, 60);
      const ht = lireMontant(l[col.ht]);
      const tva = lireMontant(l[col.tva]);
      let ttc = lireMontant(l[col.ttc]);
      if (ttc === null && ht !== null) ttc = Math.round((ht + (tva ?? 0)) * 100) / 100;
      return {
        type: typeDocument(valImport(l, col.type), numero),
        numero,
        date_document: lireDate(l[col.date]),
        client_nom: valImport(l, col.client).slice(0, 200),
        objet: valImport(l, col.objet).slice(0, 500),
        total_ht: ht,
        total_tva: tva ?? (ht !== null && ttc !== null ? Math.round((ttc - ht) * 100) / 100 : null),
        total_ttc: ttc,
        statut: valImport(l, col.statut).slice(0, 60),
        source,
      };
    })
    .filter((f) => f.numero);
}
