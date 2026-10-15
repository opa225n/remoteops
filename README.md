# RemoteOps

Outil interne de maintenance à distance : un tableau de bord web pour voir
l'état d'un parc de postes et s'y connecter (écran + clavier/souris), et un
agent léger à installer sur chaque poste à dépanner.

Construit à partir de zéro avec des briques ouvertes et documentées
(WebRTC, Electron, Node.js) — **pas** dérivé d'un logiciel commercial fermé.
Voir « Origine et limites » en bas de page.

## Architecture

```
┌──────────────┐        WebSocket (signalisation)        ┌──────────────┐
│  Tableau de  │ ───────────────────────────────────────▶│   Serveur    │
│  bord (web)  │◀─────────────────────────────────────── │ (le vôtre)   │
└──────┬───────┘                                          └──────┬───────┘
       │                                                         │
       │              WebRTC (vidéo + clavier/souris)            │ WebSocket
       │          directe entre navigateur et agent,             │
       └─────────────────────────────────────────────────────────┘
                                                                   │
                                                          ┌────────▼───────┐
                                                          │  Agent (poste  │
                                                          │  à dépanner)   │
                                                          └────────────────┘
```

- **`server/`** — API + tableau de bord statique + relais de signalisation
  WebSocket. Vous l'hébergez vous-même (VPS, machine du bureau, etc.).
  Le serveur ne voit jamais l'écran ni les frappes : il ne fait que mettre
  en contact l'agent et le navigateur (échange SDP/ICE WebRTC), qui se
  connectent ensuite directement.
- **`controller/`** — pages web du tableau de bord, servies statiquement
  par le serveur (pas de build, HTML/CSS/JS simples).
- **`agent/`** — application Electron à installer sur chaque poste à
  dépanner : capture l'écran, reçoit les clics/frappes et les injecte
  (via [nut-js](https://nutjs.dev)).

## Démarrage rapide

### 1. Serveur

```bash
cd server
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# collez le résultat dans .env (SESSION_SECRET=...)
npm start
```

Ouvrez `http://localhost:3000` (ou le port choisi) : la première visite
propose de créer le compte administrateur. La console où tourne `npm
start` affiche alors un **jeton d'installation** à copier dans le
formulaire — c'est ce qui empêche quelqu'un d'autre sur le réseau de
créer ce premier compte avant vous.

### 2. Ajouter un poste

Dans le tableau de bord : **Ajouter un poste** → donnez-lui un nom →
**Générer le code**. Le code est valable 15 minutes, à usage unique.

### 3. Agent (sur le poste à dépanner)

```bash
cd agent
npm install
npm start
```

Au premier lancement, l'agent demande l'adresse du serveur et le code
généré à l'étape précédente. Une fois enrôlé, il reste en arrière-plan
(icône système) et apparaît « En ligne » dans le tableau de bord.

### 4. Se connecter

Dans le tableau de bord, cliquez **Se connecter** sur un poste en ligne :
l'écran s'affiche, cliquez dedans pour activer le clavier et la souris.

## Portée de cette première version — à savoir avant d'y mettre en production

Ceci est une base fonctionnelle, pas un produit fini. Avant un usage
régulier sur un vrai parc, prévoyez de traiter les points suivants :

- **NAT/pare-feu stricts** : seul un serveur **STUN** public (Google) est
  configuré par défaut. Sur un réseau d'entreprise avec NAT symétrique ou
  pare-feu strict, la connexion WebRTC peut échouer sans un serveur
  **TURN** auto-hébergé (ex. [coturn](https://github.com/coturn/coturn)).
  Non inclus ici : à ajouter si des connexions échouent en pratique.
- **Électron non empaqueté** : l'agent se lance avec `npm start` (Node +
  Electron installés sur le poste). Pour une vraie distribution, empaqueter
  avec `electron-builder` ou `electron-forge` (non fait ici) et prévoir
  un lancement automatique au démarrage de la session.
- **Disposition clavier** : la correspondance clavier (`agent/src/keymap.js`)
  suppose une disposition proche de l'US QWERTY au niveau des codes
  physiques ; certains symboles peuvent être décalés sur d'autres
  dispositions. Les lettres, chiffres et touches de commande fonctionnent
  normalement.
- **Un seul moniteur** : capture l'écran principal uniquement. Le choix du
  moniteur n'est pas encore exposé dans l'interface.
- **Pas de transfert de fichiers ni de presse-papiers partagé** : non
  implémenté dans cette version.
- **Stockage des postes/comptes** : fichier JSON (`server/data/db.json`),
  adapté à un parc modeste. Pour un grand nombre de postes ou plusieurs
  administrateurs simultanés, migrer vers une vraie base de données.
- **HTTPS** : à mettre en place vous-même (reverse proxy comme Caddy/Nginx)
  pour tout accès au tableau de bord au-delà de `localhost`. WebRTC exige
  une origine sécurisée (HTTPS) pour fonctionner dans un navigateur, sauf
  en local.
- **Icône de l'agent** : `nativeImage.createEmpty()` par défaut dans
  `agent/src/main.js` — remplacez par un vrai fichier `.png`/`.ico` avant
  diffusion interne.
- **Tests** : validé par un test de bout en bout du serveur (authentification,
  enrôlement, relais WebSocket) dans cet environnement. L'agent Electron
  (capture d'écran, injection d'entrées) n'a **pas** pu être testé ici,
  faute d'affichage graphique dans ce bac à sable : testez-le sur un vrai
  poste avant de vous y fier.

## Sécurité — ce qui est fait, ce qui reste à votre charge

- Mots de passe admin hachés (bcrypt), sessions signées (HMAC), limiteur
  de débit sur la connexion et l'enrôlement, jetons d'agent et codes
  d'enrôlement générés de façon cryptographiquement aléatoire.
- Le serveur de signalisation ne relaie que ce qui est nécessaire à la
  négociation WebRTC : il ne voit jamais le flux vidéo ni les entrées une
  fois la session établie.
- **À votre charge** : HTTPS en production, mise à jour des dépendances,
  politique de mots de passe plus stricte si besoin, journalisation/alerte
  si vous voulez un historique d'audit des connexions (non inclus).
- Un poste ne peut être enrôlé que via un code généré par un administrateur
  déjà connecté : aucune inscription libre possible depuis Internet.

## Origine et limites

Ce projet a été conçu et écrit à partir de zéro (protocoles ouverts,
bibliothèques publiques), **sans** reprendre le fonctionnement interne
d'AnyDesk ou d'un autre logiciel commercial fermé : une analyse faite plus
tôt dans ce même travail avait servi à comprendre les grandes lignes d'un
outil de ce type, mais n'a pas été utilisée comme plan de construction —
reproduire l'implémentation d'un logiciel propriétaire à partir de sa
décompilation pose un problème de droits, indépendamment de la capacité
technique à le faire.
