// cagot.fr / www.cagot.fr : page de présentation ; app.cagot.fr : l'application.
if (/^(www\.)?cagot\.fr$/.test(location.hostname) && (location.pathname === "/" || location.pathname === "/index.html")) {
  location.replace("/bienvenue.html");
}
