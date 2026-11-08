#!/usr/bin/env python3
"""Construit la collection privée de la ludothèque (dossier collection/).

Chaque jeu est compressé puis chiffré (AES-256-GCM). La clé des jeux est elle-même
chiffrée avec une clé tirée du code d'activation (PBKDF2-SHA256). Sans le code,
les fichiers publiés sur GitHub sont illisibles.

Utilisation :
  python3 outils/construire_collection.py --code CODE --liste liste.json \
      --sources DOSSIER_DES_JEUX [--three three.min.js] [--miniatures DOSSIER_CACHE]

  liste.json : {"categories": [...], "jeux": [{"id","nom","categorie","emoji","couleur","source","internet"?}]}
  DOSSIER_DES_JEUX/<id>/index.html : le fichier HTML de chaque jeu.

  Pour retrouver la liste actuelle (avec le code) :
  python3 outils/construire_collection.py --code CODE --exporter-liste liste.json

  Pour ajouter des jeux sans avoir les sources de tous les autres :
  ajouter --garder-existants ; un jeu de la liste sans fichier dans DOSSIER_DES_JEUX
  garde alors sa version chiffrée actuelle (et sa miniature). Dans ce mode, aucun jeu
  déjà publié n'est retiré : ceux qui manquent dans la liste sont conservés.
  Pour retirer un jeu, construire sans --garder-existants.
  Variable LUDO_CHROME : chemin d'un Chrome à utiliser pour les miniatures.
"""
import argparse, base64, gzip, hashlib, json, os, re, secrets, sys, time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, "collection")
ITERATIONS = 250_000
THREE_CDN = re.compile(r'<script[^>]*src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"[^>]*>\s*</script>')

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode

def normaliser(code):
    return re.sub(r"[^A-Z0-9]", "", code.upper())

def cle_du_code(code, sel, iterations):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sel, iterations=iterations)
    return kdf.derive(normaliser(code).encode())

def chiffrer(cle, donnees):
    iv = secrets.token_bytes(12)
    return iv + AESGCM(cle).encrypt(iv, donnees, None)

def dechiffrer(cle, blob):
    return AESGCM(cle).decrypt(blob[:12], blob[12:], None)

def cle_des_jeux(code):
    chemin = os.path.join(SORTIE, "cle.json")
    if os.path.exists(chemin):
        c = json.load(open(chemin))
        k = cle_du_code(code, unb64(c["sel"]), c["iterations"])
        try:
            return dechiffrer(k, unb64(c["cle"]))
        except Exception:
            sys.exit("Code incorrect pour la collection existante.")
    os.makedirs(SORTIE, exist_ok=True)
    sel, cle = secrets.token_bytes(16), secrets.token_bytes(32)
    k = cle_du_code(code, sel, ITERATIONS)
    json.dump({"v": 1, "sel": b64(sel), "iterations": ITERATIONS, "cle": b64(chiffrer(k, cle))},
              open(chemin, "w"), indent=1)
    return cle

def lire_catalogue(cle):
    chemin = os.path.join(SORTIE, "catalogue.bin")
    if not os.path.exists(chemin):
        return None
    return json.loads(gzip.decompress(dechiffrer(cle, open(chemin, "rb").read())))

def preparer_html(html, three):
    if three and THREE_CDN.search(html):
        html = THREE_CDN.sub(lambda m: "<script>" + three + "</script>", html)
    return html

def miniature(html, cache):
    """Capture l'écran de départ du jeu (Chromium sans affichage)."""
    h = hashlib.sha256(html.encode()).hexdigest()[:16]
    fichier = os.path.join(cache, h + ".jpg")
    if not os.path.exists(fichier):
        from playwright.sync_api import sync_playwright
        tmp = os.path.join(cache, "_jeu.html")
        open(tmp, "w").write(html)
        with sync_playwright() as p:
            chrome = os.environ.get("LUDO_CHROME")
            nav = p.chromium.launch(executable_path=chrome or None, args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
            page = nav.new_page(viewport={"width": 960, "height": 600})
            page.add_init_script("window.alert=()=>{};window.confirm=()=>false;window.prompt=()=>null;")
            try:
                page.goto("file://" + tmp, wait_until="load", timeout=30000)
            except Exception:
                pass
            page.wait_for_timeout(3000)
            page.screenshot(path=fichier, type="jpeg", quality=70,
                            clip={"x": 0, "y": 0, "width": 960, "height": 600})
            nav.close()
        from PIL import Image
        im = Image.open(fichier).convert("RGB").resize((480, 300), Image.LANCZOS)
        im.save(fichier, "JPEG", quality=72, optimize=True)
    return "data:image/jpeg;base64," + b64(open(fichier, "rb").read())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True)
    ap.add_argument("--liste")
    ap.add_argument("--sources")
    ap.add_argument("--three")
    ap.add_argument("--miniatures")
    ap.add_argument("--exporter-liste")
    ap.add_argument("--garder-existants", action="store_true")
    a = ap.parse_args()

    cle = cle_des_jeux(a.code)
    ancien = lire_catalogue(cle)

    if a.exporter_liste:
        if not ancien:
            sys.exit("Pas encore de collection.")
        jeux = [{k: v for k, v in j.items() if k not in ("fichier", "taille", "empreinte", "miniature")} for j in ancien["jeux"]]
        json.dump({"categories": ancien["categories"], "jeux": jeux}, open(a.exporter_liste, "w"), ensure_ascii=False, indent=1)
        print("Liste exportée :", a.exporter_liste)
        return

    liste = json.load(open(a.liste))
    three = open(a.three).read() if a.three else None
    os.makedirs(os.path.join(SORTIE, "j"), exist_ok=True)
    if a.miniatures:
        os.makedirs(a.miniatures, exist_ok=True)

    garder, entrees = set(), []
    anciens = {e["id"]: e for e in (ancien or {}).get("jeux", [])}
    if a.garder_existants and ancien:
        # Sécurité : en mode ajout, un jeu déjà publié qui manque dans la liste (ajouté depuis
        # une autre conversation, par exemple) est conservé tel quel, avec sa catégorie.
        presents = {j["id"] for j in liste["jeux"]}
        for e in ancien["jeux"]:
            if e["id"] not in presents:
                print("  conservé ", e["id"], "(absent de la liste)")
                liste["jeux"].append({k: v for k, v in e.items() if k not in ("fichier", "taille", "empreinte", "miniature")})
        for c in ancien["categories"]:
            if c not in liste["categories"]:
                liste["categories"].append(c)
    for j in liste["jeux"]:
        source = os.path.join(a.sources, j["id"], "index.html")
        if a.garder_existants and not os.path.exists(source) and j["id"] in anciens:
            e = anciens[j["id"]]
            e = dict(j, fichier=e["fichier"], taille=e["taille"], empreinte=e["empreinte"],
                     **({"miniature": e["miniature"]} if e.get("miniature") else {}))
            garder.add(os.path.basename(e["fichier"]))
            entrees.append(e)
            continue
        html = preparer_html(open(os.path.join(a.sources, j["id"], "index.html"), encoding="utf-8").read(), three)
        donnees = html.encode("utf-8")
        empreinte = hashlib.sha256(donnees).hexdigest()[:12]
        nom_fichier = f"{j['id']}-{empreinte}.bin"
        chemin = os.path.join(SORTIE, "j", nom_fichier)
        if not os.path.exists(chemin):
            open(chemin, "wb").write(chiffrer(cle, gzip.compress(donnees, 9, mtime=0)))
            print("  chiffré  ", j["id"], f"{len(donnees)//1024} Ko")
        garder.add(nom_fichier)
        e = dict(j, fichier="j/" + nom_fichier, taille=os.path.getsize(chemin), empreinte=empreinte)
        if a.miniatures:
            try:
                e["miniature"] = miniature(html, a.miniatures)
            except Exception as err:
                print("  pas de miniature pour", j["id"], err)
        entrees.append(e)

    for f in os.listdir(os.path.join(SORTIE, "j")):
        if f not in garder:
            os.remove(os.path.join(SORTIE, "j", f))
            print("  retiré   ", f)

    catalogue = {"version": int(time.time()), "categories": liste["categories"], "jeux": entrees}
    open(os.path.join(SORTIE, "catalogue.bin"), "wb").write(
        chiffrer(cle, gzip.compress(json.dumps(catalogue, ensure_ascii=False).encode(), 9, mtime=0)))
    total = sum(e["taille"] for e in entrees)
    print(f"Collection : {len(entrees)} jeux, {total/1e6:.1f} Mo")

if __name__ == "__main__":
    main()
