# EXTRACTOR PWA — v2

Application de vérification des rapports **entièrement pilotée par le scan** : on pointe la caméra sur le QR du rapport, le verdict s'affiche. Aucune saisie manuelle.

## Écrans
| Écran | Rôle |
|---|---|
| **Scanner** (accueil) | Caméra plein écran, lampe, changement de caméra, import d'une photo de QR |
| **Résultat** | Verdict plein écran (authentique / non conforme / introuvable / non reconnu) + détail des contrôles |
| **Historique** | Résultats passés, filtrables, consultables hors connexion |
| **Registre** | Rapports synchronisés, état de la synchronisation, filtre par agence |
| **Réglages** | Son, vibration, synchronisation auto, installation, effacement des données |

## Fonctionnement
- Le registre est téléchargé depuis `apiUrl` (`config.js`, action `syncReports`) puis vérifié **localement** : l'app marche sans réseau.
- Si un rapport est inconnu et qu'Internet est disponible, l'app synchronise toute seule puis revérifie.
- Décodage QR : `BarcodeDetector` quand le navigateur l'offre, sinon **jsQR** embarqué (iPhone, Firefox). Rien n'est chargé depuis Internet : polices et scripts sont dans le dossier.
- Contrat QR inchangé : `{ system:"EXTRACTOR", report_id, agency, period, report_date, control_code }`.

## Lancer en local
```
python -m http.server 5173
```
puis ouvrir http://127.0.0.1:5173/ (le scan caméra exige HTTPS ou localhost).

## Mettre à jour chez les utilisateurs
Modifier `CACHE` dans `sw.js` (ex. `extractor-pwa-3`) avant de republier.
