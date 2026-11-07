# EXTRACTOR PWA

Version web installable du vérificateur de rapports.

## Fonctions

- vérification manuelle d'un contenu QR EXTRACTOR ;
- scan caméra avec `BarcodeDetector` lorsque le navigateur le prend en charge ;
- registre Google Sheets synchronisé dans `localStorage` ;
- vérification hors connexion des rapports déjà synchronisés ;
- historique local ;
- installation comme application grâce au manifeste PWA ;
- icônes PNG dans `assets/icon-192.png` et `assets/icon-512.png` (sources JPG/ICO conservées).

## Lancer en local

Depuis ce dossier, servir les fichiers avec un serveur HTTP (le service worker ne fonctionne pas correctement avec `file://`) :

```powershell
python -m http.server 5173
```

Puis ouvrir `http://127.0.0.1:5173/`.
