/* ARCADIA — menu de paramètres commun à tous les jeux de la ludothèque.
 *
 * Intégration dans un jeu :
 *   1. Mettre une balise script vide portant l'attribut data-arcadia tout en haut du
 *      body (le script de construction la remplace par ce module, logo compris).
 *   2. Appeler, une fois le jeu prêt :
 *      Arcadia.init({
 *        id: "feux-artifice",            // sert à mémoriser les réglages de ce jeu
 *        titre: "Feux d'artifice",
 *        cibles: () => [...],             // éléments que le contacteur peut déclencher
 *        contacteur: ["fonction","balayage","hasard"], // modes proposés (défaut : les 3)
 *        ceJeu: element,                  // réglages propres au jeu (déplacés dans le panneau)
 *        activer: (el, i) => {},          // optionnel : comment déclencher une cible
 *        pause: { visible: () => true, changer: (enPause) => {} }, // optionnel
 *        ouvrir: () => {}, fermer: () => {}, reinitialiser: () => {},  // optionnels
 *        occupe: () => false   // optionnel : vrai quand une fenêtre du jeu (fiche, cadrage
 *                              // photo…) est ouverte ; contacteurs et balayage s'arrêtent
 *      });
 *   Les fenêtres propres au jeu portent l'attribut data-arcadia-ui pour rester utilisables.
 *   Arcadia.surReinit(fn) ajoute une action au bouton « Réinitialiser ».
 *   Arcadia.ouvert vaut true quand le panneau est affiché.
 *
 * Ce que fait le module, pour tous les jeux :
 *   - logo en haut à droite, 3 appuis pour ouvrir le panneau (pas d'appui long) ;
 *   - plein écran automatique au premier appui ;
 *   - « Ignorer les appuis trop rapprochés » (délai réglable) ;
 *   - contacteurs : un par fonction, un seul avec balayage (continu, ou lancé par un
 *     premier appui puis validé par un second), un seul au hasard ; en mode un seul
 *     contacteur, « tout l'écran » fait compter n'importe quel appui sur l'écran,
 *     chaque contacteur étant détecté (touche, clic gauche ou clic droit) ;
 *   - bouton pause pour les jeux qui le demandent ;
 *   - Réinitialiser et Quitter le jeu (dans la ludothèque).
 */
(function(){
"use strict";
if (window.Arcadia) return;

var LOGO = "__ARCADIA_LOGO__";
var DANS_LUDO = window.parent !== window;
var CLE_COMMUN = "arcadia-commun";
var DEFAUT = { rapproche:false, delai:1, contacteur:false, mode:"balayage", vitesse:2, demarrage:"auto", unique:null, ecran:false };

function lire(k){ try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(e){ return null; } }
function ecrire(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function effacer(k){ try{ localStorage.removeItem(k); }catch(e){} }

var C = Object.assign({}, DEFAUT, lire(CLE_COMMUN) || {});
var J = { entrees:{} };   // contacteurs « un par fonction », propres à chaque jeu
var cfg = { cibles:function(){ return []; }, contacteur:["fonction","balayage","hasard"] };
var synth = false, ui = {}, A, reinits = [];

/* ---------- Plein écran automatique ---------- */
function pleinEcran(){
  try{
    var d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) return;
    var f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f){ var p = f.call(el, { navigationUI:"hide" }); if (p && p.catch) p.catch(function(){}); }
  }catch(e){}
}
["pointerup","touchend","keydown","click"].forEach(function(ev){
  addEventListener(ev, function(){ if (!synth) pleinEcran(); }, { passive:true });
});

/* ---------- Outils ---------- */
function dansUI(t){ return !!(t && t.closest && t.closest("[data-arcadia-ui]")); }
function stop(e){ e.preventDefault(); e.stopImmediatePropagation(); }
function visible(el){
  if (!el || !el.isConnected || el.disabled) return false;
  var s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none") return false;
  var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
}
function cibles(){ try{ return (cfg.cibles() || []).filter(visible); }catch(e){ return []; } }
function nomCible(el, i){
  var n = el.getAttribute("data-arcadia-nom") || el.getAttribute("aria-label") || el.textContent || "";
  n = n.replace(/\s*\(touche.*\)\s*$/i, "").trim();
  return n || ("Élément " + (i + 1));
}
function nomEntree(x){
  if (!x) return "Aucun";
  if (x.type === "souris") return x.bouton === 2 ? "Clic droit" : "Clic gauche";
  var k = x.cle || x.code;
  var noms = { " ":"Espace", Enter:"Entrée", ArrowUp:"Flèche haut", ArrowDown:"Flèche bas",
    ArrowLeft:"Flèche gauche", ArrowRight:"Flèche droite", Tab:"Tabulation", Backspace:"Retour" };
  return "Touche " + (noms[k] || (k && k.length === 1 ? k.toUpperCase() : k));
}
function memeEntree(x, e){
  if (!x) return false;
  if (x.type === "souris") return e.pointerType === "mouse" && e.button === x.bouton;
  return e.code === x.code;
}

/* ---------- Déclencher une cible (contacteur) ---------- */
function activer(el){
  var liste = cibles(), i = liste.indexOf(el);
  surbrillance(el, true);
  synth = true;
  try{
    if (cfg.activer){ cfg.activer(el, i); }
    else {
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var o = { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0, pointerId:99, pointerType:"mouse", isPrimary:true };
      el.dispatchEvent(new PointerEvent("pointerdown", o));
      el.dispatchEvent(new MouseEvent("mousedown", o));
      el.dispatchEvent(new PointerEvent("pointerup", o));
      el.dispatchEvent(new MouseEvent("mouseup", o));
      el.dispatchEvent(new MouseEvent("click", o));
    }
  }catch(e){}
  synth = false;
}

/* ---------- Ignorer les appuis trop rapprochés ---------- */
var dernier = -1e9, bloque = false;
function accepte(){
  var t = performance.now();
  if (C.rapproche && t - dernier < C.delai * 1000) return false;
  dernier = t; return true;
}
function occupe(){ try{ return !!(cfg.occupe && cfg.occupe()); }catch(e){ return false; } }
function ecranContacteur(){ return C.contacteur && C.ecran && C.mode !== "fonction" && !A.ouvert && !A.enPause && !occupe(); }
var gesteEcran = false;
function filtreEcran(e){
  if (synth || dansUI(e.target)) return;
  if (e.type === "pointerdown"){
    gesteEcran = ecranContacteur();
    if (gesteEcran){ stop(e); appuiUnique(); return; }
  }
  if (gesteEcran) stop(e);   // relâchement, clic… du même appui : avalés
}
["pointerdown","touchstart","mousedown","pointerup","touchend","mouseup","click","contextmenu"].forEach(function(ev){
  addEventListener(ev, filtreEcran, { capture:true, passive:false });
});
function filtrePointeur(e){
  if (synth || A.ouvert || !C.rapproche || dansUI(e.target) || gesteEcran) return;
  if (e.type === "pointerdown"){ bloque = !accepte(); }
  if (bloque) stop(e);
}
["pointerdown","touchstart","mousedown","pointerup","touchend","mouseup","click"].forEach(function(ev){
  addEventListener(ev, filtrePointeur, { capture:true, passive:false });
});

/* ---------- Clavier, souris et contacteurs ---------- */
var detection = null;   // { fin:function(entree) }
var avale = null;       // entrée de contacteur en cours (on avale le relâchement)

addEventListener("keydown", function(e){
  if (synth) return;
  if (detection){
    stop(e);
    if (e.key === "Escape") detection.fin(null);
    else detection.fin({ type:"touche", code:e.code, cle:e.key });
    return;
  }
  if (A.ouvert){
    if (!dansUI(e.target)) stop(e);
    if (e.key === "Escape"){ stop(e); fermer(); }
    return;
  }
  if (C.contacteur && !dansUI(e.target) && !occupe() && entreeContacteur(e)){ stop(e); return; }
  if (C.rapproche && !dansUI(e.target)){
    if (e.repeat || !accepte()) stop(e);
  }
}, true);
addEventListener("keyup", function(e){
  if (avale && avale.type === "touche" && e.code === avale.code){ stop(e); avale = null; }
}, true);

function filtreSouris(e){
  if (synth) return;
  /* Pendant la détection, n'importe quel clic de souris compte (le contacteur clique là où est
     le pointeur, souvent sur le panneau), sauf sur le bouton « Détecter » lui-même. */
  if (detection && e.pointerType === "mouse" && e.type === "pointerdown" && !(e.target.closest && e.target.closest(".a-ecoute"))){
    stop(e); detection.fin({ type:"souris", bouton:e.button }); return;
  }
  /* Fin d'un appui de contacteur souris : on avale le relâchement et le clic */
  if (avale && avale.type === "souris" && e.type !== "pointerdown"){
    if (e.type === "contextmenu" || e.button === avale.bouton) stop(e);
    if (e.type === "click" || e.type === "contextmenu" || e.type === "auxclick") avale = null;
    return;
  }
  if (A.ouvert || !C.contacteur || dansUI(e.target) || occupe()) return;
  if (e.type === "pointerdown" && e.pointerType === "mouse" && entreeContacteur(e)){ stop(e); return; }
}
["pointerdown","mousedown","pointerup","mouseup","click","auxclick","contextmenu"].forEach(function(ev){
  addEventListener(ev, filtreSouris, { capture:true, passive:false });
});

function entreeContacteur(e){
  if (e.repeat) return memeEntreeActive(e);
  var mode = C.mode, liste;
  if (mode === "fonction"){
    liste = cibles();
    for (var i = 0; i < liste.length; i++){
      var x = J.entrees[nomCible(liste[i], i)];
      if (memeEntree(x, e)){ avale = x; if (accepte()) activer(liste[i]); return true; }
    }
    return false;
  }
  if (!memeEntree(C.unique, e)) return false;
  avale = C.unique;
  appuiUnique();
  return true;
}
/* Un appui du contacteur unique (ou de l'écran entier) : hasard ou balayage */
function appuiUnique(){
  var mode = C.mode, liste;
  if (!accepte()) return true;
  liste = cibles();
  if (!liste.length) return true;
  if (mode === "hasard") activer(liste[Math.floor(Math.random() * liste.length)]);
  else if (C.demarrage === "appui" && balayage.attente){
    /* Balayage à deux appuis : le premier appui lance le balayage… */
    balayage.attente = false; balayage.pos = 0; balayage.relancer();
  } else {
    /* … le second valide le bouton encadré */
    var el = liste[balayage.pos % liste.length]; activer(el);
    if (C.demarrage === "appui"){
      balayage.attente = true; clearInterval(balayage.minuteur); balayage.minuteur = null;
      setTimeout(balayage.relancer, 600);
    } else balayage.relancer();
  }
  return true;
}
function memeEntreeActive(e){
  if (C.mode === "fonction") return Object.keys(J.entrees).some(function(k){ return memeEntree(J.entrees[k], e); });
  return memeEntree(C.unique, e);
}

/* ---------- Balayage ---------- */
var balayage = {
  pos:0, minuteur:null, attente:true, pasFaits:0,
  actif:function(){ return C.contacteur && C.mode === "balayage" && (C.unique || C.ecran) && !A.ouvert && !A.enPause && !occupe(); },
  pas:function(){
    var liste = cibles();
    if (!balayage.actif() || !liste.length){ surbrillance(null); return; }
    balayage.pos = (balayage.pos + 1) % liste.length;
    /* À deux appuis : sans validation après 3 tours, le balayage s'arrête et attend */
    if (C.demarrage === "appui" && ++balayage.pasFaits >= 3 * liste.length){ balayage.attente = true; balayage.relancer(); return; }
    surbrillance(liste[balayage.pos]);
  },
  relancer:function(){
    clearInterval(balayage.minuteur); balayage.minuteur = null;
    balayage.pasFaits = 0;
    if (!balayage.actif() || (C.demarrage === "appui" && balayage.attente)){ surbrillance(null); return; }
    var liste = cibles(); if (balayage.pos >= liste.length) balayage.pos = 0;
    surbrillance(liste[balayage.pos]);
    balayage.minuteur = setInterval(balayage.pas, C.vitesse * 1000);
  }
};
var suivi = null;
function surbrillance(el, flash){
  var h = ui.halo; if (!h) return;
  if (!el){ h.hidden = true; suivi = null; return; }
  if (flash){ h.classList.remove("flash"); void h.offsetWidth; h.classList.add("flash"); if (C.mode !== "balayage") { suivi = el; placerHalo(); setTimeout(function(){ if (suivi === el && C.mode !== "balayage") surbrillance(null); }, 500); } return; }
  suivi = el; placerHalo();
}
function placerHalo(){
  if (!suivi || !ui.halo) return;
  if (!visible(suivi)){ ui.halo.hidden = true; return; }
  var r = suivi.getBoundingClientRect(), m = 6;
  Object.assign(ui.halo.style, { left:(r.left - m) + "px", top:(r.top - m) + "px", width:(r.width + 2*m) + "px", height:(r.height + 2*m) + "px" });
  ui.halo.hidden = false;
}
addEventListener("resize", placerHalo);
setInterval(placerHalo, 250);

/* ---------- Interface ---------- */
var CSS = '\
[data-arcadia-ui]{box-sizing:border-box;font-family:"Fredoka","Baloo 2","Trebuchet MS",system-ui,sans-serif;-webkit-tap-highlight-color:transparent}\
[data-arcadia-ui] *{box-sizing:border-box}\
#arcadia-logo{position:fixed;z-index:2147483000;top:calc(10px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));\
 width:60px;height:60px;border-radius:50%;border:0;padding:0;background:#1e3f86;cursor:pointer;touch-action:none;\
 box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.9;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}\
#arcadia-logo img{width:100%;height:100%;display:block;border-radius:50%;pointer-events:none}\
#arcadia-logo:focus-visible{outline:4px solid #e8954a;outline-offset:3px}\
#arcadia-points{position:fixed;z-index:2147483000;top:calc(74px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));\
 width:60px;display:flex;justify-content:center;gap:6px;pointer-events:none;opacity:0;transition:opacity .2s}\
#arcadia-points.voir{opacity:1}\
#arcadia-points i{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.5);border:2px solid #1e3f86}\
#arcadia-points i.on{background:#e8954a}\
#arcadia-pause{position:fixed;z-index:2147482999;top:calc(10px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);\
 height:60px;min-width:60px;padding:0 18px;border-radius:30px;border:0;background:#1e3f86;color:#fff;font-size:28px;font-weight:700;\
 box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;gap:8px}\
#arcadia-pause span{font-size:18px}\
#arcadia-voile{position:fixed;inset:0;z-index:2147482998;background:rgba(14,30,66,.72);display:grid;place-items:center;color:#fff;\
 font-size:clamp(36px,8vw,72px);font-weight:700;text-align:center}\
#arcadia-voile small{display:block;font-size:clamp(18px,3vw,26px);font-weight:500;margin-top:10px}\
#arcadia-halo{position:fixed;z-index:2147482997;pointer-events:none;border-radius:22px;border:7px solid #ffd23f;\
 box-shadow:0 0 0 4px #1e3f86,0 0 28px 8px rgba(255,210,63,.75);transition:left .15s,top .15s,width .15s,height .15s}\
#arcadia-halo.flash{animation:arcadia-flash .5s}\
@keyframes arcadia-flash{40%{border-color:#fff;box-shadow:0 0 0 4px #e8954a,0 0 40px 16px rgba(255,255,255,.9)}}\
#arcadia-panneau{color-scheme:light;position:fixed;inset:0;z-index:2147483001;background:rgba(10,20,45,.6);display:grid;place-items:center;\
 padding:max(12px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))}\
#arcadia-panneau .a-carte{margin:0;gap:0;align-items:stretch;padding:0;background:#fbf8f1;color:#1d2a44;border-radius:22px;width:min(560px,100%);max-height:100%;overflow:auto;\
 box-shadow:0 20px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;border-top:8px solid #1e3f86}\
#arcadia-panneau .a-carte>*{flex:none}\
#arcadia-panneau .a-entete{display:flex;align-items:center;justify-content:flex-start;gap:14px;padding:16px 20px 10px;margin:0;min-height:0}\
#arcadia-panneau .a-entete img{width:52px;height:52px;border-radius:50%;flex:none}\
#arcadia-panneau h2{margin:0;font-size:24px;font-weight:700;line-height:1.1;color:#1e3f86}\
#arcadia-panneau .a-entete p{margin:2px 0 0;font-size:16px;color:#5b6475}\
#arcadia-panneau .a-section{margin:0;padding:10px 20px 14px;border-top:2px solid #ece4d3}\
#arcadia-panneau h3{margin:4px 0 10px;font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b4692b}\
#arcadia-panneau .a-opt{margin:0 0 10px}\
#arcadia-panneau .a-case{display:flex;align-items:center;gap:12px;min-height:48px;font-size:18px;cursor:pointer}\
#arcadia-panneau .a-case input{width:28px;height:28px;accent-color:#1e3f86;flex:none;margin:0}\
#arcadia-panneau .a-detail{margin:4px 0 6px 18px;padding:10px 14px;border-left:4px solid #e8954a;background:#fff;border-radius:0 12px 12px 0;display:flex;flex-direction:column;gap:10px}\
#arcadia-panneau .a-ligne{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:17px}\
#arcadia-panneau .a-ligne b{font-weight:600}\
#arcadia-panneau input[type=range]{flex:1;min-width:140px;height:32px;accent-color:#1e3f86}\
#arcadia-panneau .a-val{min-width:62px;font-weight:700;font-variant-numeric:tabular-nums}\
#arcadia-panneau .a-modes{display:flex;flex-direction:column;gap:6px}\
#arcadia-panneau .a-modes label{display:flex;align-items:center;gap:10px;min-height:44px;font-size:17px;padding:4px 10px;border:2px solid #e4dccb;border-radius:12px;background:#fbf8f1;cursor:pointer}\
#arcadia-panneau .a-modes input{width:24px;height:24px;accent-color:#1e3f86;margin:0}\
#arcadia-panneau .a-modes label:has(input:checked){border-color:#1e3f86;background:#eef3ff}\
#arcadia-panneau .a-entree{flex:1;min-width:120px;font-weight:600}\
#arcadia-panneau .a-entree.vide{color:#9a8f7a;font-weight:500}\
#arcadia-panneau button.a-bt{height:46px;padding:0 18px;border-radius:12px;border:0;background:#e9dfcb;color:#1d2a44;font:inherit;font-size:17px;font-weight:600;cursor:pointer}\
#arcadia-panneau button.a-bt.a-ecoute{background:#e8954a;color:#fff}\
#arcadia-panneau button.a-bt:focus-visible{outline:3px solid #1e3f86;outline-offset:2px}\
#arcadia-panneau .a-aide{margin:0;font-size:15px;color:#5b6475;line-height:1.35}\
#arcadia-panneau .a-vide-jeu{margin:0;font-size:16px;color:#5b6475}\
#arcadia-panneau .a-pied{margin:0;display:flex;flex-wrap:wrap;gap:10px;padding:14px 20px 18px;border-top:2px solid #ece4d3;align-items:center}\
#arcadia-panneau .a-pied .a-esp{flex:1}\
#arcadia-panneau .a-pied .a-quitter{background:#f6d9d4;color:#8c2318}\
#arcadia-panneau .a-pied .a-fermer{background:#1e3f86;color:#fff;padding:0 30px;font-size:19px}\
#arcadia-panneau .a-ce-jeu{font-size:17px}\
@media (max-width:480px){#arcadia-panneau .a-pied .a-esp{display:none}#arcadia-panneau .a-pied button{flex:1 1 auto}}\
';

function h(tag, attrs, html){
  var el = document.createElement(tag);
  for (var k in (attrs || {})) el.setAttribute(k, attrs[k]);
  if (html != null) el.innerHTML = html;
  return el;
}

function construire(){
  var st = h("style"); st.textContent = CSS; document.head.appendChild(st);

  ui.logo = h("button", { id:"arcadia-logo", "data-arcadia-ui":"", type:"button",
    "aria-label":"Paramètres : toucher 3 fois" }, '<img alt="" src="' + LOGO + '">');
  ui.points = h("div", { id:"arcadia-points", "data-arcadia-ui":"", "aria-hidden":"true" }, "<i></i><i></i><i></i>");
  ui.halo = h("div", { id:"arcadia-halo", "aria-hidden":"true", hidden:"" });
  ui.pause = h("button", { id:"arcadia-pause", "data-arcadia-ui":"", type:"button", hidden:"", "aria-label":"Pause" }, "❚❚ <span>Pause</span>");
  ui.voile = h("div", { id:"arcadia-voile", "data-arcadia-ui":"", hidden:"" }, "<div>Pause<small>Touche ▶ pour reprendre</small></div>");
  document.body.append(ui.halo, ui.voile, ui.pause, ui.logo, ui.points);

  /* 3 appuis pour ouvrir */
  var appuis = [], tm;
  function appui(){
    var t = performance.now();
    appuis = appuis.filter(function(x){ return t - x < 1500; }); appuis.push(t);
    var p = ui.points.children;
    for (var i = 0; i < 3; i++) p[i].classList.toggle("on", i < appuis.length);
    ui.points.classList.add("voir"); clearTimeout(tm);
    tm = setTimeout(function(){ ui.points.classList.remove("voir"); appuis = []; }, 1600);
    if (appuis.length >= 3){ appuis = []; ui.points.classList.remove("voir"); ouvrir(); }
  }
  ui.logo.addEventListener("pointerdown", function(e){ stop(e); appui(); });
  ui.logo.addEventListener("click", function(e){ stop(e); if (e.detail === 0) appui(); });
  ui.logo.addEventListener("contextmenu", function(e){ e.preventDefault(); });

  ui.pause.addEventListener("click", function(e){ stop(e); mettrePause(!A.enPause); });
  ui.voile.addEventListener("click", function(e){ stop(e); mettrePause(false); });
}

function mettrePause(v){
  A.enPause = v;
  ui.voile.hidden = !v;
  ui.pause.innerHTML = v ? "▶ <span>Reprendre</span>" : "❚❚ <span>Pause</span>";
  ui.pause.setAttribute("aria-label", v ? "Reprendre" : "Pause");
  try{ if (cfg.pause && cfg.pause.changer) cfg.pause.changer(v); }catch(e){}
  balayage.relancer();
}
function majPause(){
  var vis = false;
  try{ vis = !!(cfg.pause && (!cfg.pause.visible || cfg.pause.visible())); }catch(e){}
  ui.pause.hidden = !vis;
  if (!vis && A.enPause) mettrePause(false);
}

/* ---------- Panneau ---------- */
function ouvrir(){
  if (A.ouvert) return;
  A.ouvert = true;
  try{ if (cfg.ouvrir) cfg.ouvrir(); }catch(e){}
  if (cfg.pause && cfg.pause.changer && !A.enPause) try{ cfg.pause.changer(true); }catch(e){}
  balayage.relancer();
  dessinerPanneau();
}
function fermer(){
  if (!A.ouvert) return;
  if (detection) detection.fin(null);
  A.ouvert = false;
  ui.panneau.remove();
  if (cfg.ceJeu) { cfg.ceJeu.hidden = true; document.body.appendChild(cfg.ceJeu); }
  try{ if (cfg.fermer) cfg.fermer(); }catch(e){}
  if (cfg.pause && cfg.pause.changer && !A.enPause) try{ cfg.pause.changer(false); }catch(e){}
  majPause();
  balayage.relancer();
}
function sauver(){ ecrire(CLE_COMMUN, C); if (cfg.id) ecrire("arcadia-jeu-" + cfg.id, J); }

function caseDepliable(parent, libelle, cle, remplir){
  var bloc = h("div", { "class":"a-opt" });
  var lab = h("label", { "class":"a-case" });
  var inp = h("input", { type:"checkbox" }); inp.checked = !!C[cle];
  lab.append(inp, document.createTextNode(libelle));
  var det = h("div", { "class":"a-detail" });
  bloc.append(lab, det); parent.appendChild(bloc);
  function maj(){ det.hidden = !C[cle]; det.innerHTML = ""; if (C[cle]) remplir(det); }
  inp.addEventListener("change", function(){ C[cle] = inp.checked; sauver(); maj(); });
  maj();
}
function curseur(parent, libelle, min, max, pas, cle, unite){
  var l = h("div", { "class":"a-ligne" });
  var r = h("input", { type:"range", min:min, max:max, step:pas, "aria-label":libelle }); r.value = C[cle];
  var v = h("span", { "class":"a-val" });
  function aff(){ v.textContent = String(C[cle]).replace(".", ",") + " " + unite; }
  r.addEventListener("input", function(){ C[cle] = +r.value; aff(); sauver(); });
  l.append(h("b", null, libelle), r, v); aff(); parent.appendChild(l);
}
function detecteur(parent, libelle, lire, poser){
  var l = h("div", { "class":"a-ligne" });
  var nom = h("span", { "class":"a-entree" });
  var b = h("button", { "class":"a-bt", type:"button" }, "Détecter");
  function aff(){ var x = lire(); nom.textContent = (libelle ? libelle + " : " : "") + nomEntree(x); nom.classList.toggle("a-vide", !x); }
  b.addEventListener("click", function(){
    if (detection) detection.fin(null);
    b.textContent = "Appuie sur le contacteur…"; b.classList.add("a-ecoute");
    var depart = performance.now(), fini = false;
    var minuterie = setTimeout(function(){ detection && detection.fin(null); }, 12000);
    detection = { fin:function(x){
      if (fini) return;
      if (x && x.type === "souris" && performance.now() - depart < 250) return;
      fini = true; clearTimeout(minuterie); detection = null;
      b.textContent = "Détecter"; b.classList.remove("a-ecoute");
      if (x){ poser(x); sauver(); avale = x; }
      aff();
    }};
  });
  l.append(nom, b); aff(); parent.appendChild(l);
}

function dessinerPanneau(){
  var p = ui.panneau = h("div", { id:"arcadia-panneau", "data-arcadia-ui":"" });
  var carte = h("div", { "class":"a-carte", role:"dialog", "aria-modal":"true", "aria-labelledby":"arcadia-titre" });
  carte.appendChild(h("div", { "class":"a-entete" },
    '<img alt="" src="' + LOGO + '"><div><h2 id="arcadia-titre">Paramètres</h2><p></p></div>'));
  carte.querySelector(".a-entete p").textContent = cfg.titre || document.title || "";

  /* Pour tous les jeux */
  var s1 = h("div", { "class":"a-section" }); s1.appendChild(h("h3", null, "Pour tous les jeux"));
  caseDepliable(s1, "Ignorer les appuis trop rapprochés", "rapproche", function(d){
    curseur(d, "Attendre", .3, 3, .1, "delai", "s");
    d.appendChild(h("p", { "class":"a-aide" }, "Après un appui, les appuis suivants sont ignorés pendant ce temps."));
  });
  caseDepliable(s1, "Utiliser un contacteur", "contacteur", function(d){
    var modes = h("div", { "class":"a-modes", role:"radiogroup" });
    var TXT = { fonction:"Un contacteur par bouton", balayage:"Un seul contacteur, avec balayage", hasard:"Un seul contacteur, réaction au hasard" };
    var offerts = cfg.contacteur;
    if (offerts.indexOf(C.mode) < 0) C.mode = offerts[0];
    offerts.forEach(function(m){
      var lab = h("label"); var r = h("input", { type:"radio", name:"arcadia-mode", value:m });
      r.checked = C.mode === m;
      r.addEventListener("change", function(){ C.mode = m; balayage.attente = true; sauver(); remplirMode(); });
      lab.append(r, document.createTextNode(TXT[m])); modes.appendChild(lab);
    });
    var zone = h("div", { "class":"a-detail", style:"margin-left:0" });
    d.append(modes, zone);
    function remplirMode(){
      zone.innerHTML = "";
      if (C.mode === "fonction"){
        var liste = cibles();
        if (!liste.length) zone.appendChild(h("p", { "class":"a-aide" }, "Aucun bouton à associer sur cet écran."));
        liste.forEach(function(el, i){
          var n = nomCible(el, i);
          detecteur(zone, n, function(){ return J.entrees[n]; }, function(x){ J.entrees[n] = x; });
        });
        zone.appendChild(h("p", { "class":"a-aide" }, "Pour chaque bouton : appuie sur « Détecter », puis sur le contacteur à lui associer."));
      } else {
        detecteur(zone, "Contacteur", function(){ return C.unique; }, function(x){ C.unique = x; });
        var ec = h("label", { "class":"a-case" }), ei = h("input", { type:"checkbox" });
        ei.checked = !!C.ecran;
        ei.addEventListener("change", function(){ C.ecran = ei.checked; balayage.attente = true; sauver(); balayage.relancer(); });
        ec.append(ei, document.createTextNode("Tout l'écran sert aussi de contacteur"));
        zone.appendChild(ec);
        zone.appendChild(h("p", { "class":"a-aide" }, "N'importe quel appui sur l'écran compte comme un appui sur le contacteur : pratique pour jouer sans contacteur. Le logo ARCADIA et le bouton pause restent utilisables."));
        if (C.mode === "balayage"){
          curseur(zone, "Vitesse", .5, 5, .5, "vitesse", "s");
          var dem = h("div", { "class":"a-modes", role:"radiogroup", "aria-label":"Démarrage du balayage" });
          [["auto","Balayage continu : un appui valide"],["appui","Deux appuis : le 1er lance le balayage, le 2e valide"]].forEach(function(o){
            var lab = h("label"), r = h("input", { type:"radio", name:"arcadia-demarrage", value:o[0] });
            r.checked = C.demarrage === o[0];
            r.addEventListener("change", function(){ C.demarrage = o[0]; balayage.attente = true; sauver(); remplirMode(); });
            lab.append(r, document.createTextNode(o[1])); dem.appendChild(lab);
          });
          zone.appendChild(dem);
        }
        zone.appendChild(h("p", { "class":"a-aide" }, C.mode === "balayage"
          ? (C.demarrage === "appui"
            ? "Un premier appui fait apparaître le cadre jaune, qui passe d'un bouton à l'autre ; un second appui déclenche le bouton encadré. Le balayage s'arrête ensuite et attend. Sans réponse après 3 tours, il s'arrête aussi."
            : "Un cadre jaune passe d'un bouton à l'autre en continu ; un appui sur le contacteur déclenche le bouton encadré.")
          : "Chaque appui sur le contacteur déclenche un bouton choisi au hasard."));
      }
    }
    remplirMode();
  });
  carte.appendChild(s1);

  /* Ce jeu */
  var s2 = h("div", { "class":"a-section" }); s2.appendChild(h("h3", null, "Ce jeu"));
  if (cfg.ceJeu){ cfg.ceJeu.hidden = false; cfg.ceJeu.classList.add("a-ce-jeu"); s2.appendChild(cfg.ceJeu); }
  else s2.appendChild(h("p", { "class":"a-vide-jeu" }, "Ce jeu n'a pas de réglage particulier."));
  carte.appendChild(s2);

  /* Bas du panneau */
  var pied = h("div", { "class":"a-pied" });
  var reinit = h("button", { "class":"a-bt", type:"button" }, "↺ Réinitialiser");
  var confirme = false;
  reinit.addEventListener("click", function(){
    if (!confirme){ confirme = true; reinit.textContent = "Sûr ? Touche encore"; setTimeout(function(){ confirme = false; reinit.textContent = "↺ Réinitialiser"; }, 3000); return; }
    C = Object.assign({}, DEFAUT); J = { entrees:{} };
    effacer(CLE_COMMUN); if (cfg.id) effacer("arcadia-jeu-" + cfg.id);
    try{ if (cfg.reinitialiser) cfg.reinitialiser(); }catch(e){}
    reinits.forEach(function(f){ try{ f(); }catch(e){} });
    p.remove(); dessinerPanneau();
  });
  pied.appendChild(reinit);
  if (DANS_LUDO){
    var q = h("button", { "class":"a-bt a-quitter", type:"button" }, "Quitter le jeu");
    q.addEventListener("click", function(){ try{ parent.postMessage("ludo-quitter", "*"); }catch(e){} });
    pied.appendChild(q);
  }
  pied.appendChild(h("span", { "class":"a-esp" }));
  var f = h("button", { "class":"a-bt a-fermer", type:"button" }, "Fermer");
  f.addEventListener("click", fermer);
  pied.appendChild(f);
  carte.appendChild(pied);

  p.appendChild(carte);
  p.addEventListener("pointerdown", function(e){ if (e.target === p) fermer(); });
  document.body.appendChild(p);
  f.focus({ preventScroll:true });
}

/* ---------- API ---------- */
A = window.Arcadia = {
  ouvert:false, enPause:false,
  init:function(o){
    Object.assign(cfg, o || {});
    if (cfg.id) J = Object.assign({ entrees:{} }, lire("arcadia-jeu-" + cfg.id) || {});
    if (cfg.ceJeu){ cfg.ceJeu.hidden = true; }
    var go = function(){ if (!ui.logo) construire(); majPause(); balayage.relancer(); };
    if (document.body) go(); else addEventListener("DOMContentLoaded", go);
  },
  ouvrir:function(){ ouvrir(); }, fermer:function(){ fermer(); },
  majPause:function(){ if (ui.pause) majPause(); },
  relancer:function(){ balayage.relancer(); },
  /* Ajoute une action à « Réinitialiser » (en plus de cfg.reinitialiser) */
  surReinit:function(f){ if (typeof f === "function") reinits.push(f); }
};
})();
