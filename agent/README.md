# Agent RemoteOps

À installer sur chaque poste que vous voulez pouvoir dépanner à distance.

## Installation

```bash
npm install
npm start
```

Au premier lancement, une petite fenêtre demande :
- l'adresse du serveur RemoteOps (celle que vous avez déployée, ex.
  `https://remoteops.exemple.interne`) ;
- le code d'enrôlement à usage unique généré dans le tableau de bord ;
- un nom pour ce poste (optionnel).

Une fois enrôlé, l'agent se reconnecte automatiquement au serveur et reste
en arrière-plan (icône système). Fermer la fenêtre ne l'arrête pas ; utilisez
le menu de l'icône système pour **Quitter**.

## Permissions nécessaires sur le poste

- **Enregistrement de l'écran** : sur macOS, la première capture déclenche
  une demande d'autorisation système (Réglages Système → Confidentialité et
  sécurité → Enregistrement de l'écran) ; accordez-la à l'application puis
  relancez-la une fois.
- **Accessibilité / contrôle du pointeur et du clavier** (nécessaire à
  nut-js pour injecter les clics et les frappes) : sur macOS, Réglages
  Système → Confidentialité et sécurité → Accessibilité. Sur Linux sous
  Wayland, l'injection d'entrées peut être restreinte selon le compositeur ;
  testé principalement en pensant à X11/Windows/macOS.

## Ce qui n'est pas encore fait

- Empaquetage en application installable (`.exe`/`.dmg`/`.AppImage`) —
  prévoir `electron-builder` ou `electron-forge`.
- Démarrage automatique à l'ouverture de session.
- Choix du moniteur quand le poste en a plusieurs.
- Icône réelle (actuellement une icône vide, `nativeImage.createEmpty()`
  dans `src/main.js`).

## Tester une modification

Ce code n'a pas pu être testé dans l'environnement où il a été écrit (pas
d'affichage graphique disponible). Avant de déployer un changement sur
plusieurs postes, testez-le d'abord sur une seule machine : lancez `npm
start`, enrôlez-la, et vérifiez une session de contrôle complète (écran
visible, clic et frappe effectifs) depuis le tableau de bord.
