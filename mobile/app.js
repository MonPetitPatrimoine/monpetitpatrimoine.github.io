"use strict";
/* Mon Petit Patrimoine — © 2026. Tous droits réservés.
   mobile/app.js : application mobile en lecture seule (27 novembre 2026, choix de l'utilisateur).
   Le téléphone est associé par le lien du QR code affiché dans l'application de bureau (Réglages généraux → Sur votre téléphone) :
     https://monpetitpatrimoine.net/mobile/#<identifiant>.<clé>
   Le fragment « # » n'est jamais envoyé au serveur ; il est gardé dans le stockage local de ce téléphone puis effacé de l'adresse.
   Le bloc chiffré est lu au service (GET /sync/<identifiant>) et déchiffré ici (WebCrypto, AES-256-GCM). Le dernier bloc reçu est
   gardé chiffré pour l'ouverture hors ligne. Aucune mesure d'audience, aucun cookie. Tout texte venu des données est inséré
   comme du texte (textContent), jamais comme du HTML. */
const API = "https://mon-petit-patrimoine-paiement.monpetitpatrimoine.workers.dev/sync/";
const VERSION_APP = "3";   // même numéro que « ?v= » dans index.html et que le cache de sw.js
const K_ASSOC = "mpp-mobile-association", K_BLOC = "mpp-mobile-bloc", K_MASQUE = "mpp-mobile-masque", K_PER = "mpp-mobile-periode";
const $ = id => document.getElementById(id);
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const signe = (v, f) => (v > 0.005 ? "+" : v < -0.005 ? "−" : "") + f(Math.abs(v));
const classe = v => v > 0.005 ? "pos" : v < -0.005 ? "neg" : "";
const dateFr = iso => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return (d === 1 ? "1er" : d) + " " + MOIS[m - 1] + " " + y; };
const moisFr = ym => { const [y, m] = ym.split("-").map(Number); return MOIS[m - 1] + " " + y; };
const lire = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const ecrire = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
/* éléments construits en texte : el("div", { class: "x" }, "texte", enfant…) */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (v == null || v === false) return; if (k === "style") e.style.cssText = v; else e.setAttribute(k, v === true ? "" : v); });   // style par le DOM : permis par la politique de contenu
  kids.flat(Infinity).forEach(k => { if (k != null && k !== false) e.append(k instanceof Node ? k : String(k)); });
  return e;
}
const montant = (v, f) => el("span", { class: "m" }, (f || eur).format(v));   // flouté quand les montants sont masqués

/* ---------- installation sur l'écran d'accueil (27 novembre 2026, demande de l'utilisateur) ----------
   Aucun téléphone ne laisse une page s'installer seule : Android (Chrome, Edge, Samsung Internet) propose un bouton
   (beforeinstallprompt) ; iPhone et iPad n'en ont pas : on montre les deux gestes (Partager → Sur l'écran d'accueil).
   Sur iPhone et iPad, l'application ajoutée à l'écran d'accueil ne partage pas le stockage de Safari et s'ouvre sur l'adresse
   de la page au moment de l'ajout : la clé reste donc dans le fragment de l'adresse (jamais envoyé au serveur) tant que
   l'application n'est pas installée, et le manifeste n'est pas déclaré (son start_url ferait perdre ce fragment). */
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const INSTALLEE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const K_PLUS_TARD = "mpp-mobile-installer-plus-tard", PLUS_TARD_JOURS = 30;
let invite = null;   // événement beforeinstallprompt gardé pour le bouton
if (!IOS) { const l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.json"; document.head.append(l); }
function proposerInstallation(assoc) {
  const t = lire(K_PLUS_TARD), repousse = t && Date.now() - t < PLUS_TARD_JOURS * 864e5;
  const montrer = !!assoc && !INSTALLEE && !repousse;
  $("installer").hidden = !montrer; if (!montrer) return;
  $("inst-ios").hidden = !IOS; $("inst-android").hidden = IOS || !invite; $("inst-autre").hidden = IOS || !!invite;
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); invite = e; proposerInstallation(lire(K_ASSOC)); });
window.addEventListener("appinstalled", () => { invite = null; $("installer").hidden = true; });
$("inst-btn").onclick = async () => {
  if (!invite) return;
  const e = invite; invite = null; e.prompt();
  try { const r = await e.userChoice; if (r && r.outcome === "accepted") { $("installer").hidden = true; return; } } catch (err) {}
  proposerInstallation(lire(K_ASSOC));
};
$("inst-plus-tard").onclick = () => { ecrire(K_PLUS_TARD, Date.now()); $("installer").hidden = true; };

/* ---------- association du téléphone ---------- */
function associer() {
  const m = /^#([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(location.hash), avant = lire(K_ASSOC);
  if (m && !(avant && avant.id === m[1] && avant.cle === m[2])) { ecrire(K_ASSOC, { id: m[1], cle: m[2] }); ecrire(K_BLOC, null); }
  const assoc = lire(K_ASSOC);
  // la clé ne reste pas dans l'adresse ni dans l'historique, sauf sur iPhone et iPad avant l'installation (voir plus haut)
  const voulu = IOS && !INSTALLEE && assoc ? "#" + assoc.id + "." + assoc.cle : "";
  if (location.hash !== voulu) history.replaceState(null, "", location.pathname + voulu);
  return assoc;
}
async function dechiffrer(bloc, cle) {
  const k = await crypto.subtle.importKey("raw", b64(cle), "AES-GCM", false, ["decrypt"]);
  const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(bloc.iv) }, k, b64(bloc.data));
  return JSON.parse(new TextDecoder().decode(clair));
}

/* ---------- affichage ---------- */
let donnees = null, periode = lire(K_PER) || "1y";
function rendement(r) {
  if (!r || !isFinite(r.v)) return "—";
  return signe(r.v, v => pct.format(v)) + (r.mode === "an" ? " par an" : " sur " + Math.max(1, Math.round(r.days / 30.44)) + " mois");
}
function courbe(points) {
  const k0 = (points || []).findIndex(p => p.v > 0 || p.d > 0); points = k0 > 0 ? points.slice(k0) : points;   // pas de départ à zéro
  if (!points || points.length < 2) return null;
  const W = 320, H = 140, vals = points.flatMap(p => [p.v, p.d]), lo = Math.min(...vals), hi = Math.max(...vals);
  const X = i => i / (points.length - 1) * W, Y = v => H - 8 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (H - 16);
  const trace = k => points.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p[k]).toFixed(1)).join("");
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Évolution du patrimoine depuis " + moisFr(points[0].m));
  [["v", "var(--e1)", ""], ["d", "var(--dep)", "4 4"]].forEach(([k, c, dash]) => { const p = document.createElementNS(ns, "path"); p.setAttribute("d", trace(k)); p.setAttribute("fill", "none"); p.setAttribute("stroke", c); p.setAttribute("stroke-width", "2"); p.setAttribute("vector-effect", "non-scaling-stroke"); if (dash) p.setAttribute("stroke-dasharray", dash); svg.append(p); });
  return svg;
}
function afficher() {
  const S = donnees, box = $("synthese"); if (!S) return;
  const vars = S.variations || [], v = vars.find(x => x.p === periode) || vars.find(x => x.p === "1y") || vars[0];
  box.replaceChildren(...[
    el("div", { class: "card" },
      el("p", { class: "lbl" }, S.titre || "Mon patrimoine"),
      el("p", { class: "total" }, montant(S.total)),
      S.dettes > 0.005 ? el("p", { class: "sub" }, "Patrimoine net · brut ", montant(S.brut), " · crédits restant dus ", montant(S.dettes)) : null,
      v ? el("p", { class: "small" }, el("b", { class: classe(v.gain) }, el("span", { class: "m" }, signe(v.gain, x => eur.format(x))), v.pct != null ? " · " + signe(v.pct, x => pct.format(x)) : ""), " ", el("span", { class: "muted" }, v.texte)) : null,
      vars.length > 1 ? el("div", { class: "per", role: "group", "aria-label": "Période" }, vars.map(x => { const b = el("button", { type: "button", "aria-pressed": String(x === v) }, x.label); b.onclick = () => { periode = x.p; ecrire(K_PER, periode); afficher(); }; return b; })) : null),
    el("div", { class: "kpis" },
      el("div", { class: "kpi" }, el("span", {}, "Versé"), el("b", {}, montant(S.verse))),
      el("div", { class: "kpi" }, el("span", {}, "Plus-value"), el("b", { class: classe(S.pv) }, el("span", { class: "m" }, signe(S.pv, x => eur.format(x))))),
      el("div", { class: "kpi" }, el("span", {}, "Rendement" + (S.horsImmo ? " (hors immo.)" : "")), el("b", {}, rendement(S.ret)))),
    S.courbe && S.courbe.length > 1 ? el("div", { class: "card courbe" }, el("p", { class: "lbl" }, "Évolution"), courbe(S.courbe),
      el("div", { class: "leg" }, el("span", {}, el("i", { style: "border-color:var(--e1)" }), "Valeur"), el("span", {}, el("i", { style: "border-color:var(--dep);border-top-style:dashed" }), "Versé"))) : null,
    el("h2", {}, "Vos comptes"),
    el("div", { class: "card" }, (S.comptes || []).length ? S.comptes.map(c => el("div", { class: "compte" },
      el("div", {}, el("div", { class: "n" }, el("span", { class: "chip", style: "background:" + couleur(c.couleur) }), c.nom), el("div", { class: "d" }, "Versé ", montant(c.verse, eur0), " · ", el("span", { class: classe(c.pv) + " m" }, signe(c.pv, x => eur0.format(x))), c.horsTotal ? " · hors total" : "")),
      el("div", { class: "v" }, montant(c.val), c.part != null ? el("div", { class: "d" }, pct.format(c.part)) : null))) : el("p", { class: "muted small" }, "Aucun compte alimenté pour l’instant.")),
    (S.repartition || []).length ? [el("h2", {}, "Répartition"), el("div", { class: "card" },
      el("div", { class: "barre", role: "img", "aria-label": "Répartition par type d’actif" }, S.repartition.map(r => el("span", { style: "width:" + (S.total > 0 ? r.val / S.total * 100 : 0).toFixed(2) + "%;background:" + couleur(r.couleur) }))),
      el("div", { class: "rep" }, S.repartition.map(r => [el("span", { class: "chip", style: "background:" + couleur(r.couleur) }), el("span", {}, r.nom), el("span", {}, S.total > 0 ? pct.format(r.val / S.total) : "")])))] : null,
    (S.aVenir || []).length ? [el("h2", {}, "À venir"), el("div", { class: "card" }, el("ul", { class: "liste" }, S.aVenir.map(x => el("li", {}, x.texte, el("small", {}, x.mois ? moisFr(x.mois) : dateFr(x.date))))))] : null,
    (S.objectifs || []).length ? [el("h2", {}, "Objectifs"), el("div", { class: "card" }, el("ul", { class: "liste" }, S.objectifs.map(g => el("li", {},
      el("b", {}, g.nom), el("div", { class: "prog", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(g.ratio * 100)), "aria-label": "Avancement : " + g.nom }, el("i", { style: "width:" + (g.ratio * 100).toFixed(1) + "%" })),
      el("small", {}, montant(g.actuel, eur0), " sur ", montant(g.cible, eur0), g.atteint ? " · atteint" : g.retard ? " · à accélérer" : "", g.echeance ? " · " + moisFr(g.echeance) : "")))))] : null
  ].flat().filter(Boolean));
  box.hidden = false;
  const d = new Date(S.genere);
  etat("Chiffres du " + dateFr(S.jour) + ", envoyés à " + String(d.getHours()).padStart(2, "0") + " h " + String(d.getMinutes()).padStart(2, "0") + ".");
}
const COULEURS = /^var\(--(e[0-5]|dep|accent)\)$|^#[0-9A-Fa-f]{3,8}$/;
const couleur = c => COULEURS.test(String(c || "")) ? c : "var(--dep)";   // jamais une valeur de style arbitraire
const etat = t => { $("etat").textContent = t || ""; };

/* ---------- chargement ---------- */
async function charger(assoc) {
  $("actualiser").disabled = true;
  try {
    const r = await fetch(API + assoc.id, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (r.status === 404) { etat("Rien à afficher pour l’instant : vérifiez que l’envoi est activé sur l’ordinateur."); return; }
    if (!r.ok) throw new Error("http " + r.status);
    const bloc = await r.json();
    donnees = await dechiffrer(bloc, assoc.cle);
    ecrire(K_BLOC, { iv: bloc.iv, data: bloc.data });
    afficher();
  } catch (e) {
    if (e && e.name === "OperationError") { etat("Ces chiffres ne s’ouvrent pas avec ce téléphone : scannez à nouveau le QR code de l’ordinateur."); return; }
    etat(donnees ? "Hors ligne : derniers chiffres reçus." : "Connexion impossible : réessayez plus tard.");
  } finally { $("actualiser").disabled = false; }
}
async function demarrer() {
  const assoc = associer();
  $("accueil").hidden = !!assoc; $("bas").hidden = !assoc; $("actualiser").hidden = !assoc; $("masquer").hidden = !assoc;
  proposerInstallation(assoc);
  $("version").textContent = "Version " + VERSION_APP + " · " + (INSTALLEE ? "application installée" : "dans le navigateur");
  if (!assoc) { etat(""); return; }
  const masque = !!lire(K_MASQUE); document.body.classList.toggle("cache", masque); $("masquer").setAttribute("aria-pressed", String(masque));
  const garde = lire(K_BLOC);
  if (garde) { try { donnees = await dechiffrer(garde, assoc.cle); afficher(); } catch (e) {} }
  if (!donnees) etat("Chargement…");
  await charger(assoc);
}
$("actualiser").onclick = () => { const a = lire(K_ASSOC); if (a) charger(a); };
$("masquer").onclick = () => { const on = !document.body.classList.contains("cache"); document.body.classList.toggle("cache", on); $("masquer").setAttribute("aria-pressed", String(on)); ecrire(K_MASQUE, on); };
$("oublier").onclick = () => { if (!confirm("Dissocier ce téléphone ? Ses chiffres y seront effacés. Vous pourrez l’associer à nouveau avec le QR code de l’ordinateur." + (IOS && INSTALLEE ? " Supprimez ensuite l’icône de l’écran d’accueil : elle garde le lien d’association." : ""))) return; ecrire(K_ASSOC, null); ecrire(K_BLOC, null); history.replaceState(null, "", location.pathname); donnees = null; $("synthese").hidden = true; $("synthese").replaceChildren(); demarrer(); };
document.addEventListener("visibilitychange", () => { const a = lire(K_ASSOC); if (document.visibilityState === "visible" && a) charger(a); });
window.addEventListener("hashchange", demarrer);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
demarrer();
