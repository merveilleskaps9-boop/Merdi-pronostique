# Football Pronostics AI

Application web locale d'analyse automatisee de paris football avec intelligence artificielle.

## Fonctionnalites

- Analyse automatique chaque soir a 20h00 ET (America/Toronto)
- Rapport de performance chaque matin a 07h00 ET
- 15 tickets generes par analyse : 5 Haute Performance + 5 Securite + 5 Securite+HP
- Couverture de 30+ championnats (Europe, Ameriques, Asie, competitions continentales)
- Donnees en temps reel : fixtures, cotes, statistiques des equipes
- Interface web complete avec historique et journal d'activite

---

## Prerequis

- Node.js version 18 ou superieure
- Acces a Internet
- 3 cles API (toutes disponibles gratuitement)

---

## Installation

### Etape 1 : Installer Node.js (si pas encore fait)

Telecharger depuis : https://nodejs.org (version LTS recommandee)

### Etape 2 : Copier le projet

Placer le dossier `football-pronostics` ou vous voulez sur votre ordinateur.

### Etape 3 : Installer les dependances

Ouvrir un terminal dans le dossier du projet et executer :

```bash
npm install
```

### Etape 4 : Configurer les cles API

Copier le fichier `.env.example` en `.env` :

```bash
cp .env.example .env
```

Ouvrir le fichier `.env` et remplir vos cles (voir section suivante).

### Etape 5 : Demarrer l'application

```bash
npm start
```

Ouvrir votre navigateur et aller sur : http://localhost:3000

---

## Obtenir les cles API gratuitement

### 1. API-Football (100 requetes/jour gratuit)

1. Aller sur https://rapidapi.com
2. Creer un compte gratuit
3. Rechercher "API-Football" par api-sports
4. Cliquer "Subscribe to Test" sur le plan Free
5. Copier la cle `X-RapidAPI-Key` dans votre tableau de bord RapidAPI

### 2. The Odds API (500 requetes/mois gratuit)

1. Aller sur https://the-odds-api.com
2. Cliquer "Get API Key" et creer un compte gratuit
3. Copier votre cle API depuis le tableau de bord

### 3. Anthropic Claude API (requis)

1. Aller sur https://console.anthropic.com
2. Connectez-vous avec votre compte Anthropic
3. Aller dans Settings > API Keys
4. Creer une nouvelle cle et la copier

Note : L'API Anthropic n'est pas gratuite mais vous avez peut-etre deja des credits via votre abonnement Claude.ai Pro.
Le cout estimé pour 15 tickets/soir est d'environ 0.05 a 0.10$ par analyse.

---

## Utilisation

### Interface web

1. **Tableau de bord** : Vue d'ensemble, journal d'activite, prochain rapport
2. **Tickets du jour** : Visualisation des 15 tickets avec filtres par type
3. **Historique** : Toutes les analyses passees avec taux de reussite
4. **Configuration** : Gestion des cles API et consommation

### Lancement manuel

Cliquer "Lancer une analyse" sur le tableau de bord ou l'onglet Tickets.

### Automatisation

L'analyse se lance automatiquement a 20h00 ET et le rapport a 07h00 ET
tant que l'application est en cours d'execution.

Pour garder l'app active en permanence sous Windows, utiliser :
```bash
npm install -g pm2
pm2 start src/server.js --name pronostics
pm2 save
pm2 startup
```

---

## Structure du projet

```
football-pronostics/
  src/
    server.js          Serveur Express + routes API
    analyzer.js        Generation des tickets via Claude AI
    apiFootball.js     Integration API-Football (fixtures + stats)
    apiOdds.js         Integration The Odds API (cotes)
    scheduler.js       Taches cron automatiques
    storage.js         Lecture/ecriture des donnees JSON
  public/
    index.html         Interface web SPA
    css/main.css       Styles
    js/app.js          Logique frontend
  data/                Tickets et rapports sauvegardes (JSON)
  logs/                Journal d'activite
  .env.example         Modele de configuration
  package.json         Dependances Node.js
```

---

## Cout mensuel estime

| Service | Plan | Cout |
|---------|------|------|
| API-Football | Free (100 req/jour) | 0$/mois |
| The Odds API | Free (500 req/mois) | 0$/mois |
| Anthropic API | Pay-as-you-go | ~2-3$/mois |
| **Total** | | **~2-3$/mois** |

Si vous depassez les limites gratuites, le plan payant API-Football coute ~10$/mois.
