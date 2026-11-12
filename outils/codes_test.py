#!/usr/bin/env python3
"""Codes de test de la ludothèque : un code qui n'ouvre qu'une partie de la collection.

Même format que la page outils/acces.html (qui fait la même chose dans le navigateur).
Fichier produit : collection/acces.json (à publier avec le reste du dépôt).

  python3 outils/codes_test.py --code CODE_COMPLET lister
  python3 outils/codes_test.py --code CODE_COMPLET jeux                       # ids des jeux de la collection
  python3 outils/codes_test.py --code CODE_COMPLET creer "IME Les Lilas" --jeux ferme,feux-artifice [--code-test TEST-XXXX-XXXX]
  python3 outils/codes_test.py --code CODE_COMPLET modifier TEST-XXXX-XXXX [--nom ...] [--ajouter id,id] [--retirer id,id] [--jeux id,id]
  python3 outils/codes_test.py --code CODE_COMPLET supprimer TEST-XXXX-XXXX

Format de collection/acces.json :
  {"v":1, "sel", "iterations", "codes":[{"id","tag","cle","liste","admin"}]}
  bits  = PBKDF2-SHA256(code normalisé, sel, iterations, 32 octets)
  tag   = sha256("ludo-tag:" + bits)[:24 hex]          → retrouve l'entrée du code
  cle   = AES-GCM(bits, clé des jeux + clé du code)      → ce que reçoit la tablette
  liste = AES-GCM(clé du code, {"jeux":[ids]})           → relue à chaque mise à jour
  admin = AES-GCM(clé des jeux, {"nom","code","kc"})     → pour cette page / ce script
"""
import argparse, base64, gzip, hashlib, json, os, re, secrets, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLL = os.path.join(RACINE, "collection")
FICHIER = os.path.join(COLL, "acces.json")
LETTRES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode
norm = lambda c: re.sub(r"[^A-Z0-9]", "", c.upper())

def bits(code, sel, it):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sel, iterations=it).derive(norm(code).encode())
def enc(k, d):
    iv = secrets.token_bytes(12); return b64(iv + AESGCM(k).encrypt(iv, d, None))
def dec(k, s):
    b = unb64(s) if isinstance(s, str) else s; return AESGCM(k).decrypt(b[:12], b[12:], None)
def tag(bt):
    return hashlib.sha256(b"ludo-tag:" + bt).hexdigest()[:24]

def ouvrir(code):
    info = json.load(open(os.path.join(COLL, "cle.json")))
    try:
        cle = dec(bits(code, unb64(info["sel"]), info["iterations"]), info["cle"])
    except Exception:
        sys.exit("Ce n'est pas le code complet de la collection.")
    cat = json.loads(gzip.decompress(dec(cle, open(os.path.join(COLL, "catalogue.bin"), "rb").read())))
    acc = json.load(open(FICHIER)) if os.path.exists(FICHIER) else {"v": 1, "sel": b64(secrets.token_bytes(16)), "iterations": 250000, "codes": []}
    codes = []
    for c in acc["codes"]:
        a = json.loads(dec(cle, c["admin"]))
        codes.append(dict(id=c["id"], tag=c["tag"], cle=c["cle"], nom=a["nom"], code=a["code"], kc=a["kc"],
                          jeux=json.loads(dec(unb64(a["kc"]), c["liste"]))["jeux"]))
    return info, cle, cat, acc, codes

def ecrire(cle, acc, codes):
    out = {"v": 1, "sel": acc["sel"], "iterations": acc["iterations"], "codes": []}
    for c in codes:
        out["codes"].append({"id": c["id"], "tag": c["tag"], "cle": c["cle"],
            "liste": enc(unb64(c["kc"]), json.dumps({"jeux": c["jeux"]}).encode()),
            "admin": enc(cle, json.dumps({"nom": c["nom"], "code": c["code"], "kc": c["kc"]}, ensure_ascii=False).encode())})
    open(FICHIER, "w").write(json.dumps(out, indent=1) + "\n")
    print("Écrit :", os.path.relpath(FICHIER, RACINE))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True, help="code complet de la collection")
    ap.add_argument("action", choices=["lister", "jeux", "creer", "modifier", "supprimer"])
    ap.add_argument("cible", nargs="?", help="nom (creer) ou code de test (modifier/supprimer)")
    ap.add_argument("--jeux"); ap.add_argument("--ajouter"); ap.add_argument("--retirer")
    ap.add_argument("--nom"); ap.add_argument("--code-test")
    a = ap.parse_args()
    info, cle, cat, acc, codes = ouvrir(a.code)
    ids = [j["id"] for j in cat["jeux"]]
    noms = {j["id"]: j["nom"] for j in cat["jeux"]}
    def liste(s):
        l = [x.strip() for x in (s or "").split(",") if x.strip()]
        inconnus = [x for x in l if x not in ids]
        if inconnus: sys.exit("Jeux inconnus : " + ", ".join(inconnus) + " (voir l'action « jeux »)")
        return l
    def trouver(code):
        c = next((c for c in codes if norm(c["code"]) == norm(code or "")), None)
        if not c: sys.exit("Code de test introuvable.")
        return c

    if a.action == "jeux":
        for j in cat["jeux"]: print(f"{j['id']:32} {j.get('categorie',''):24} {j['nom']}")
        return
    if a.action == "lister":
        if not codes: print("Aucun code de test.")
        for c in codes:
            print(f"{c['code']}  {c['nom']}\n   " + ", ".join(noms.get(i, i + " (retiré)") for i in c["jeux"]))
        return
    if a.action == "creer":
        if not a.cible: sys.exit("Donne le nom du lieu.")
        code = (a.code_test or "TEST-" + "".join(secrets.choice(LETTRES) for _ in range(4)) + "-" + "".join(secrets.choice(LETTRES) for _ in range(4))).upper()
        if len(norm(code)) < 6: sys.exit("Code trop court.")
        try:
            dec(bits(code, unb64(info["sel"]), info["iterations"]), info["cle"]); sys.exit("C'est le code complet.")
        except SystemExit: raise
        except Exception: pass
        bt = bits(code, unb64(acc["sel"]), acc["iterations"])
        if any(c["tag"] == tag(bt) for c in codes): sys.exit("Ce code existe déjà.")
        kc = secrets.token_bytes(32)
        codes.append(dict(id=secrets.token_hex(6), tag=tag(bt), cle=enc(bt, cle + kc), nom=a.cible, code=code, kc=b64(kc), jeux=liste(a.jeux)))
        print("Code créé :", code)
    elif a.action == "modifier":
        c = trouver(a.cible)
        if a.nom: c["nom"] = a.nom
        if a.jeux is not None: c["jeux"] = liste(a.jeux)
        c["jeux"] += [x for x in liste(a.ajouter) if x not in c["jeux"]]
        r = set(liste(a.retirer)); c["jeux"] = [x for x in c["jeux"] if x not in r]
        print(c["code"], ":", len(c["jeux"]), "jeux")
    elif a.action == "supprimer":
        c = trouver(a.cible); codes.remove(c); print("Supprimé :", c["code"])
    ecrire(cle, acc, codes)

if __name__ == "__main__":
    main()
