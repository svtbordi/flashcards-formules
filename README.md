# Formules BCPST

Application installable (téléphone Android ou iPhone, ordinateur) pour apprendre les théorèmes, définitions, propriétés et formules de mathématiques du programme BCPST 2021, avec la répétition espacée (algorithme FSRS, bibliothèque [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), licence MIT). Les formules sont affichées avec [KaTeX](https://katex.org) (licence MIT). Même base que l'application de définitions de SVT ([flashcards-definition](https://github.com/svtbordi/flashcards-definition)), sans suivi par l'enseignant : tout reste sur le téléphone de l'élève.

## Ce que fait l'application

- Deux jeux de cartes. **Fiches** : intitulé au recto (« Formule de Bayes », « Rang de la transposée »…), énoncé au verso, rangées par chapitre du programme (BCPST 1, BCPST 2, hors des chapitres du programme). **Formulaire** (pages 98 à 104 de l'ouvrage) : une égalité par carte, membre de gauche au recto, membre de droite au verso (trigonométrie, primitives usuelles, développements limités usuels).
- Révisions espacées du jour : cartes déjà commencées selon leur calendrier, et nouvelles cartes (15 par jour par défaut, dans l'ordre du programme) prises dans les chapitres que l'élève a cochés dans « Mes chapitres vus en cours ».
- Entraînement libre sur un ou plusieurs chapitres, le formulaire entier, la dernière sélection ou les chapitres commencés.
- Échauffement par QCM (10 questions) proposé avant les flashcards d'un entraînement libre, pour toutes les parties : le recto est affiché, il faut retrouver le verso parmi quatre propositions. Les leurres sont les versos d'autres cartes, pris d'abord dans la même famille de formules (formulaire), puis dans le même chapitre et du même type (définition, théorème…). Une erreur au QCM compte comme « Raté » ; une bonne réponse ne compte pas comme « Su ».
- Fiches orange (place dans le programme à confirmer) : affichées avec une mention invitant à signaler.
- Signalement (⚠ au verso d'une carte, sur une question de QCM corrigée ou dans la recherche) : erreur dans l'énoncé ou la formule, coquille, non-conformité au programme, formule mal affichée, question de QCM ambiguë, autre. Suggestions et demandes depuis l'accueil.
- Recherche d'une fiche par mot-clé, sommaire par chapitre. Pas de recherche pendant une séance.
- Progression par chapitre, cartes les plus ratées, objectif quotidien, jours d'affilée, rappel quotidien (.ics), sauvegarde et restauration, fonctionnement hors connexion.

## Mettre à jour les fiches (enseignant)

La source est `source/fiches_maths.xlsx` (onglets « Fiches » et « Formulaire »).

1. Modifier le tableur : corriger un intitulé ou un contenu (LaTeX entre `$…$`), ou choisir dans « Ta décision » : « Passer en noir / orange / rouge », « Supprimer ».
2. Sur GitHub, dossier `source/`, « Add file », « Upload files », même nom de fichier, valider.
3. La publication se refait seule en une à deux minutes. Les élèves reçoivent la nouvelle version à la prochaine ouverture avec connexion (Réglages, « Vérifier s'il existe une nouvelle version »).

Règles appliquées : les lignes rouges et « Supprimer » sont écartées ; les orange restent, avec la mention « à confirmer ». **Ne jamais changer un ID** : il porte la progression des élèves. Pour ajouter une carte, lui donner un nouvel ID (M461…, F060…). Une fiche de l'onglet « Fiches » citée en « Fiche d'origine » dans le Formulaire n'est pas reprise dans le jeu principal. Le tableur est refusé (publication en échec, message dans l'onglet Actions) si une partie du programme est inconnue, si un ID est en double ou si un `$` manque.

## Signalements

`www/config.json` contient l'adresse du script Google de l'application de SVT : les signalements de maths arrivent dans le même tableur, onglet « Signalements », avec le préfixe « [Maths] » et l'ID de la carte dans la colonne « Terme », le contenu LaTeX dans « Définition affichée ». Aucune modification du script n'est nécessaire. Pour un tableur à part : déployer une copie de `tools/signalement.gs` du dépôt de SVT et mettre sa nouvelle adresse dans `config.json`. Vider l'adresse masque le bouton ⚠.

## Mise en ligne (une seule fois)

Dans le dépôt : Settings, Pages, « Source : GitHub Actions ». L'adresse est `https://svtbordi.github.io/flashcards-formules/`. Sur iPhone, ouvrir dans Safari puis Partager, « Sur l'écran d'accueil ». Sur Android, menu du navigateur puis « Installer l'application ».

Cette application et celle de SVT sont sur la même origine (`svtbordi.github.io`) : elles utilisent des clés de stockage et des noms de cache distincts (`fc-formules-…`), et le service worker ne supprime que ses propres caches.

## Développement

```
npm install
npm run data     # tableur -> www/data/cartes.json et chapitres.json
npm run serve    # http://localhost:8765
npm test         # parcours complet dans un téléphone simulé (QCM, flashcards, signalements interceptés, rendu de toutes les formules)
```

- `www/` : l'application (HTML, CSS, JavaScript sans compilation). `www/vendor/` : ts-fsrs 5.4.2 et KaTeX 0.16.22 (polices woff2 seulement).
- `tools/build_data.py` : convertit le tableur ; la liste des chapitres du programme y est définie.

## Limites connues

- Les leurres du QCM sont d'autres énoncés du même chapitre : ils se reconnaissent parfois au sujet traité plutôt qu'à une erreur fine (signe, hypothèse oubliée). Des leurres rédigés à la main (énoncés faux plausibles) seraient plus exigeants.
- Pas de notification push. Sur iPhone, installer l'application sur l'écran d'accueil pour que Safari ne l'efface pas.
