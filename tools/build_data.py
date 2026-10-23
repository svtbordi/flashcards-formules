"""Construit www/data/cartes.json et chapitres.json à partir du tableur source (onglets « Fiches » et « Formulaire »).

Usage : python tools/build_data.py source/fiches_maths.xlsx www/data
Les fiches rouges (hors programme) ou marquées « Supprimer » dans « Ta décision » sont écartées ;
« Passer en noir / orange / rouge » remplace le statut proposé. L'ID porte la progression des élèves : ne jamais le changer.
"""
import datetime, json, re, sys
import openpyxl

XLSX, OUT = sys.argv[1], sys.argv[2]

# Parties du programme 2021 (ordre du programme), avec le libellé utilisé dans la colonne « Partie du programme »
CHAPITRES = [
    ('O1', 'BCPST1', 'Outils 1 – Logique, ensembles'), ('O2', 'BCPST1', 'Outils 2 – Nombres réels'),
    ('O3', 'BCPST1', 'Outils 3 – Trigonométrie'), ('O4', 'BCPST1', 'Outils 4 – Nombres complexes'),
    ('O5', 'BCPST1', 'Outils 5 – Méthodes de calcul'), ('O6', 'BCPST1', 'Outils 6 – Vocabulaire des applications'),
    ('O7', 'BCPST1', 'Outils 7 – Dénombrement'), ('A1', 'BCPST1', 'Analyse 1 – Suites réelles usuelles'),
    ('A2', 'BCPST1', 'Analyse 2 – Fonctions réelles usuelles'), ('A3', 'BCPST1', 'Analyse 3 – Dérivées, primitives, intégrales'),
    ('A4', 'BCPST1', 'Analyse 4 – Équations différentielles linéaires'), ('AL1', 'BCPST1', 'Algèbre linéaire 1 – Systèmes linéaires'),
    ('AL2', 'BCPST1', 'Algèbre linéaire 2 – Matrices'), ('G1', 'BCPST1', 'Géométrie 1'),
    ('S1', 'BCPST1', 'Statistique 1'), ('POL1', 'BCPST1', 'Algèbre – Polynômes réels'),
    ('A5', 'BCPST1', 'Analyse 5 – Suites réelles'), ('A6', 'BCPST1', 'Analyse 6 – Limites, continuité'),
    ('A7', 'BCPST1', 'Analyse 7 – Dérivation'), ('A8', 'BCPST1', 'Analyse 8 – Intégration sur un segment'),
    ('A9', 'BCPST1', 'Analyse 9 – Développements limités'), ('A10', 'BCPST1', 'Analyse 10 – Fonctions de deux variables'),
    ('AL3', 'BCPST1', 'Algèbre linéaire 3 – Kⁿ et sous-espaces'), ('AL4', 'BCPST1', 'Algèbre linéaire 4 – Applications linéaires et matrices'),
    ('PR1', 'BCPST1', 'Probabilités 1 – Concepts de base'), ('PR2', 'BCPST1', 'Probabilités 2 – Variables sur un univers fini'),
    ('B_AN1', 'BCPST2', 'Analyse 1 – Séries réelles'), ('B_AN2', 'BCPST2', 'Analyse 2 – Intégrales généralisées'),
    ('B_POL', 'BCPST2', 'Algèbre – Polynômes'), ('B_AL1', 'BCPST2', 'Algèbre linéaire 1 – Espaces vectoriels'),
    ('B_AL2', 'BCPST2', 'Algèbre linéaire 2 – Applications linéaires et matrices'), ('B_AL3', 'BCPST2', 'Algèbre linéaire 3 – Valeurs propres'),
    ('B_GEO', 'BCPST2', 'Géométrie – Produit scalaire dans Rⁿ'), ('B_PR1', 'BCPST2', 'Probabilités 1 – Concepts de base'),
    ('B_PR2', 'BCPST2', 'Probabilités 2 – Variables discrètes'), ('B_PR3', 'BCPST2', 'Probabilités 3 – Couples discrets'),
    ('B_PR4', 'BCPST2', 'Probabilités 4 – Variables à densité'), ('B_PR5', 'BCPST2', 'Probabilités 5 – Théorèmes limites'),
    ('HP', 'Autres', 'Hors des chapitres du programme'),
    ('F-TRIG', 'Formulaire', 'Trigonométrie'), ('F-PRIM', 'Formulaire', 'Primitives usuelles'),
    ('F-DL', 'Formulaire', 'Développements limités usuels en 0'),
]
PAR_LIBELLE = {f'{y} · {t}': c for c, y, t in CHAPITRES if y.startswith('BCPST')}
PAR_LIBELLE['Hors des chapitres du programme'] = 'HP'
PAR_RUBRIQUE = {t: c for c, y, t in CHAPITRES if y == 'Formulaire'}
DECISION = {'passer en noir': 'N', 'passer en orange': 'O', 'passer en rouge': 'R'}


def rows(ws):
    it = ws.iter_rows(values_only=True)
    head = [str(h or '').strip() for h in next(it)]
    for r in it:
        d = {h: ('' if v is None else str(v).strip()) for h, v in zip(head, r)}
        if d.get('ID'):
            yield d


def statut(d):
    dec = d.get('Ta décision', '').lower()
    if dec == 'supprimer':
        return None
    st = DECISION.get(dec) or {'n': 'N', 'o': 'O', 'r': 'R'}.get(d['Statut'][:1].lower())
    return None if st in (None, 'R') else st


def question(card, d):
    # recto affiché : rappel des objets utilisés (contexte) puis la consigne ; sans consigne, l'intitulé sert de question
    if d.get('Contexte (rappel en tête de carte)'):
        card['ctx'] = d['Contexte (rappel en tête de carte)']
    if d.get('Question (recto)'):
        card['q'] = d['Question (recto)']


wb = openpyxl.load_workbook(XLSX, read_only=True)
cards, erreurs, ids = [], [], set()
form = list(rows(wb['Formulaire']))
remplacees = {d["Fiche d'origine"] for d in form if d.get("Fiche d'origine")}

for d in rows(wb['Fiches']):
    if d['ID'] in remplacees:  # reprise dans le Formulaire, une égalité par carte
        continue
    st = statut(d)
    if not st:
        continue
    chap = PAR_LIBELLE.get(d['Partie du programme'])
    if not chap:
        erreurs.append(f"{d['ID']} : partie inconnue « {d['Partie du programme']} »")
        continue
    card = {'id': d['ID'], 'deck': 'fiches', 'chap': chap, 'recto': d['Intitulé'], 'verso': d['Réponse (verso)']}
    question(card, d)
    if d.get('Type'):
        card['type'] = d['Type']
    if st == 'O':
        card['orange'] = 1
    cards.append(card)

for d in form:
    st = statut(d)
    if not st:
        continue
    chap = PAR_RUBRIQUE.get(d['Rubrique'])
    if not chap:
        erreurs.append(f"{d['ID']} : rubrique inconnue « {d['Rubrique']} »")
        continue
    card = {'id': d['ID'], 'deck': 'formulaire', 'chap': chap, 'recto': d['Recto'], 'verso': d['Verso']}
    question(card, d)
    if d.get("Fiche d'origine"):  # famille de formules : leurres du QCM pris d'abord dans la même famille
        card['fam'] = d["Fiche d'origine"]
    if st == 'O':
        card['orange'] = 1
    cards.append(card)

for c in cards:
    if c['id'] in ids:
        erreurs.append(f"{c['id']} : ID en double")
    ids.add(c['id'])
    for k in ('recto', 'verso', 'ctx', 'q'):
        if k in ('recto', 'verso') and not c[k] or c.get(k, '').count('$') % 2:
            erreurs.append(f"{c['id']} : {k} vide ou nombre de $ impair")
if erreurs:
    sys.exit('Tableur refusé :\n' + '\n'.join(erreurs))

order = {c: i for i, (c, _, _) in enumerate(CHAPITRES)}
cards.sort(key=lambda c: (order[c['chap']], c['id']))
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')
json.dump({'version': stamp, 'matiere': 'Mathématiques', 'cards': cards},
          open(f'{OUT}/cartes.json', 'w', encoding='utf8'), ensure_ascii=False)
used = {c['chap'] for c in cards}
json.dump([{'code': c, 'group': y, 'title': t} for c, y, t in CHAPITRES if c in used],
          open(f'{OUT}/chapitres.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
n_form = sum(c['deck'] == 'formulaire' for c in cards)
print(len(cards) - n_form, 'fiches,', n_form, 'cartes du formulaire,', sum('orange' in c for c in cards), 'orange')
