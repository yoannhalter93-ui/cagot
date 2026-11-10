// Fabrication d'un calendrier iCalendar (RFC 5545) : lu par Google Agenda, l'agenda de l'iPhone, Outlook.

export type Evenement = {
  uid: string;
  titre: string;
  debut: Date;
  fin: Date;
  journee?: boolean; // journée entière (dates sans heure, fin exclue)
  lieu?: string;
  description?: string;
  modifie?: Date;
};

const enc = new TextEncoder();
const CRLF = "\r\n";

// Texte : échappement des caractères spéciaux d'iCalendar.
export const echapper = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lignes de 75 octets au plus, repliées (sans couper un caractère accentué).
export function plier(ligne: string): string {
  const morceaux: string[] = [];
  let courant = "";
  let max = 75;
  for (const car of ligne) {
    if (enc.encode(courant + car).length > max) {
      morceaux.push(courant);
      courant = "";
      max = 74; // la ligne de suite commence par une espace
    }
    courant += car;
  }
  morceaux.push(courant);
  return morceaux.join(`${CRLF} `);
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Date du jour à Paris (AAAAMMJJ), pour les événements « journée entière ».
export const jourParis = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
const jourSuivant = (aaaammjj: string) => {
  const d = new Date(Date.UTC(+aaaammjj.slice(0, 4), +aaaammjj.slice(4, 6) - 1, +aaaammjj.slice(6, 8) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

export function calendrier(nom: string, evenements: Evenement[], maintenant = new Date()): string {
  const l = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cagot//Agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${echapper(nom.replace(/[,;]+/g, " "))}`,
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of evenements) {
    l.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utc(e.modifie ?? maintenant)}`);
    if (e.journee) {
      const j1 = jourParis(e.debut);
      const j2 = jourParis(e.fin);
      l.push(`DTSTART;VALUE=DATE:${j1}`, `DTEND;VALUE=DATE:${jourSuivant(j2 < j1 ? j1 : j2)}`);
    } else {
      l.push(`DTSTART:${utc(e.debut)}`, `DTEND:${utc(e.fin > e.debut ? e.fin : new Date(e.debut.getTime() + 3600e3))}`);
    }
    l.push(`SUMMARY:${echapper(e.titre)}`);
    if (e.lieu) l.push(`LOCATION:${echapper(e.lieu)}`);
    if (e.description) l.push(`DESCRIPTION:${echapper(e.description)}`);
    l.push("END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.map(plier).join(CRLF) + CRLF;
}
