// Version mise en page de l'e-mail : paragraphes, et le lien de signature devient un bouton.
const echapperHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Montants (« 3 115,18 € ») : jamais coupés en fin de ligne.
const insecable = (t: string) => t.replace(/(\d)[ \u00a0\u202f](?=\d|€)/g, "$1&nbsp;");
export function texteVersHtml(texte: string, couleur?: string): string {
  const fond = /^#[0-9a-f]{6}$/i.test(couleur ?? "") ? couleur! : "#1f4e79";
  const paragraphes = texte.split(/\n{2,}/).map((p) => {
    const lien = p.match(/https:\/\/\S+/);
    if (lien) {
      const intro = echapperHtml(p.replace(lien[0], "").replace(/\s*:\s*$/, "").trim());
      const signature = /devis\.html#/.test(lien[0]);
      return `${intro ? `<p style="margin:0 0 12px">${intro.replace(/\n/g, "<br>")}${signature ? "" : " :"}</p>` : ""}<p style="margin:0 0 20px"><a href="${echapperHtml(lien[0])}" style="display:inline-block;background:${fond};color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:10px">${signature ? "✍️ Consulter et signer le devis" : "Ouvrir le lien"}</a></p>`;
    }
    return `<p style="margin:0 0 16px">${insecable(echapperHtml(p)).replace(/\n/g, "<br>")}</p>`;
  });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f5f7"><div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1c2430">${paragraphes.join("")}</div></body></html>`;
}
