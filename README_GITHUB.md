# EXTRACTOR — PWA GitHub Pages

Ce dossier est autonome et peut être envoyé dans un dépôt GitHub pour héberger la PWA de vérification des rapports.

## Publication GitHub Pages

1. Créer un dépôt GitHub vide.
2. Envoyer **le contenu de ce dossier** à la racine du dépôt, notamment `index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, `styles.css` et `assets/`.
3. Dans GitHub : `Settings` → `Pages`.
4. Choisir `Deploy from a branch`.
5. Sélectionner la branche principale et le dossier `/ (root)`.
6. Enregistrer, puis attendre l'URL publiée.

La PWA utilise déjà l'URL du pilote des rapports configurée dans `config.js`.

## Important

- Le site doit être ouvert en HTTPS pour que le scan caméra fonctionne.
- La vérification des rapports déjà synchronisés fonctionne hors connexion.
- Le bouton de synchronisation nécessite Internet.
- Pour modifier le pilote, changer uniquement `apiUrl` dans `config.js`.
- Les icônes `icon-192.png` et `icon-512.png` sont déjà incluses pour l'installation PWA.
- Aucun secret ni mot de passe n'est stocké dans cette PWA.

## Test local

```powershell
python -m http.server 5173
```

Puis ouvrir `http://127.0.0.1:5173/`.
