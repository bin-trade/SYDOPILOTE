# Publication sur GitHub Pages
1. Créer un dépôt GitHub vide.
2. Envoyer **le contenu de ce dossier** à la racine du dépôt (y compris `.nojekyll`).
3. `Settings` → `Pages` → `Deploy from a branch` → branche principale, dossier `/ (root)`.
4. Ouvrir l'URL publiée en **HTTPS** (obligatoire pour la caméra), puis « Ajouter à l'écran d'accueil ».

Pour changer de serveur de registre : modifier uniquement `apiUrl` dans `config.js`.

Le service doit répondre avec `service: "EXTRACTOR_REPORT_REGISTRY"`. Après synchronisation, l'application propose les agences reçues dans `agencies` et bloque le scan tant qu'aucune agence n'est sélectionnée.
Aucun secret n'est stocké dans l'application.
