// Envoi SMTP minimal et maîtrisé (TLS direct, port 465) avec un message MIME construit ici :
// objet et nom d'expéditeur encodés proprement (accents, tirets…), texte et PDF en base64.
// Remplace la bibliothèque précédente, qui cassait les objets accentués (mail illisible, PDF perdu).

const CRLF = "\r\n";
const enc = new TextEncoder();

const b64 = (octets: Uint8Array) => {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
};
const enLignes = (base64: string) => base64.replace(/.{1,76}/g, (l) => l + CRLF);
const ascii = (t: string) => /^[\x20-\x7e]*$/.test(t);

// En-tête encodé (RFC 2047) : mots base64 courts, repliés sur plusieurs lignes.
export function motEncode(texte: string): string {
  const t = texte.replace(/[\r\n]+/g, " ").trim();
  if (ascii(t) && t.length <= 70 && !/=\?/.test(t)) return t;
  const morceaux: string[] = [];
  let courant = "";
  for (const car of t) {
    if (enc.encode(courant + car).length > 42) {
      morceaux.push(courant);
      courant = "";
    }
    courant += car;
  }
  if (courant) morceaux.push(courant);
  return morceaux.map((m) => `=?UTF-8?B?${b64(enc.encode(m))}?=`).join(`${CRLF} `);
}

const adresse = (email: string, nom?: string) => {
  const n = (nom ?? "").replace(/[\r\n<>"]+/g, " ").trim();
  if (!n) return `<${email}>`;
  return ascii(n) ? `"${n.replace(/\\/g, "")}" <${email}>` : `${motEncode(n)} <${email}>`;
};

export type Message = {
  de: { email: string; nom?: string };
  a: string[];
  cci?: string[]; // copie cachée : destinataires de l'enveloppe, absents des en-têtes
  repondreA?: string;
  sujet: string;
  texte: string;
  html?: string; // version mise en page (le texte reste pour les messageries simples)
  pdf?: { base64: string; nom: string };
};

export function construireMime(m: Message): string {
  const frontiere = `cagot-${crypto.randomUUID()}`;
  const nomAscii = (m.pdf?.nom ?? "document.pdf").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
  const entetes = [
    `From: ${adresse(m.de.email, m.de.nom)}`,
    `To: ${m.a.map((x) => `<${x}>`).join(", ")}`,
    ...(m.repondreA ? [`Reply-To: <${m.repondreA}>`] : []),
    `Subject: ${motEncode(m.sujet)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@cagot.fr>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${frontiere}"`,
  ];
  const texte = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", enLignes(b64(enc.encode(m.texte.replace(/\r?\n/g, CRLF))))];
  const parties = [`--${frontiere}`];
  if (m.html) {
    const alt = `cagot-alt-${crypto.randomUUID()}`;
    parties.push(
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      ...texte,
      `--${alt}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      enLignes(b64(enc.encode(m.html))),
      `--${alt}--`,
      "",
    );
  } else parties.push(...texte);
  if (m.pdf) {
    parties.push(
      `--${frontiere}`,
      `Content-Type: application/pdf; name="${nomAscii}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(m.pdf.nom)}`,
      "",
      enLignes(m.pdf.base64.replace(/\s+/g, "")),
    );
  }
  parties.push(`--${frontiere}--`, "");
  return [...entetes, "", ...parties].join(CRLF);
}

// Dialogue SMTP (TLS implicite). Toute réponse inattendue lève une erreur avec le code du serveur.
export async function envoyerMail(
  serveur: { hote: string; port: number; utilisateur: string; motDePasse: string; caCerts?: string[] },
  m: Message,
  { delai = 20000 }: { delai?: number } = {},
) {
  const conn = await Deno.connectTls({ hostname: serveur.hote, port: serveur.port, ...(serveur.caCerts ? { caCerts: serveur.caCerts } : {}) });
  const lecteur = conn.readable.getReader();
  const ecrivain = conn.writable.getWriter();
  const dec = new TextDecoder();
  let tampon = "";
  const minuterie = setTimeout(() => {
    try {
      conn.close();
    } catch { /* déjà fermée */ }
  }, delai);

  async function reponse(attendu: number) {
    for (;;) {
      const lignes = tampon.split(CRLF);
      // réponse complète : une ligne « 250 texte » (pas « 250-texte »)
      const fin = lignes.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
      if (fin !== -1) {
        const texte = lignes.slice(0, fin + 1).join("\n");
        tampon = lignes.slice(fin + 1).join(CRLF);
        const code = Number(lignes[fin].slice(0, 3));
        if (code !== attendu) throw new Error(`SMTP ${code} : ${texte.slice(0, 200)}`);
        return texte;
      }
      const { value, done } = await lecteur.read();
      if (done) throw new Error("SMTP : connexion fermée par le serveur");
      tampon += dec.decode(value, { stream: true });
    }
  }
  const envoyer = (t: string) => ecrivain.write(enc.encode(t + CRLF));

  try {
    await reponse(220);
    await envoyer("EHLO cagot.fr");
    await reponse(250);
    await envoyer(`AUTH PLAIN ${b64(enc.encode(`\0${serveur.utilisateur}\0${serveur.motDePasse}`))}`);
    await reponse(235);
    await envoyer(`MAIL FROM:<${m.de.email}>`);
    await reponse(250);
    for (const a of [...m.a, ...(m.cci ?? [])]) {
      await envoyer(`RCPT TO:<${a}>`);
      await reponse(250);
    }
    await envoyer("DATA");
    await reponse(354);
    const corps = construireMime(m).split(CRLF).map((l) => (l.startsWith(".") ? "." + l : l)).join(CRLF);
    await ecrivain.write(enc.encode(corps + CRLF + "." + CRLF));
    await reponse(250);
    await envoyer("QUIT").catch(() => {});
  } finally {
    clearTimeout(minuterie);
    try {
      conn.close();
    } catch { /* déjà fermée */ }
  }
}
