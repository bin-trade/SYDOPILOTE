@echo off
title EXTRACTOR PWA
cd /d "%~dp0"
echo Lancement de la PWA EXTRACTOR sur http://127.0.0.1:5173/
start "" "http://127.0.0.1:5173/"
python -m http.server 5173
pause
