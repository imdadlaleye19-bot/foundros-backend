# FoundrOS — Backend réel

Vrai backend : base de données SQLite (fichier `foundros.db`), comptes utilisateurs avec mot de passe hashé (scrypt), sessions par token signé (HMAC), API REST, et le frontend servi directement par ce même serveur.

**Zéro dépendance externe.** Pas de npm install, pas d'Express, pas de Lovable, pas de Supabase. Tout repose sur les modules intégrés à Node.js (`http`, `node:sqlite`, `crypto`).

## Lancer en local

Il te faut juste Node.js 22 ou plus récent (déjà standard sur la plupart des machines/serveurs).

```bash
node server.js
```

Puis ouvre `http://localhost:3000` dans ton navigateur. Crée un compte, connecte-toi, génère des updates — tout est sauvegardé pour de vrai dans le fichier `foundros.db` à côté de `server.js`.

## Structure

```
foundros-backend/
├── server.js       → serveur HTTP + toutes les routes API
├── db.js           → accès base de données (SQLite)
├── auth.js         → hashing mot de passe + tokens de session
├── public/
│   └── index.html  → frontend (login/inscription + cockpit)
└── foundros.db     → généré automatiquement au premier lancement
```

## Routes API

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/register` | Créer un compte `{email, password, companyName}` |
| POST | `/api/login` | Se connecter `{email, password}` → retourne un token |
| GET | `/api/me` | Infos du compte connecté (nécessite le token) |
| GET / POST | `/api/updates` | Investor Hub — mises à jour investisseurs |
| DELETE | `/api/updates/:id` | Supprimer une update |
| GET / POST | `/api/expenses` | Finance — dépenses mensuelles |
| DELETE | `/api/expenses/:id` | Supprimer une dépense |
| GET / POST | `/api/contracts` | Legal — contrats suivis |
| DELETE | `/api/contracts/:id` | Supprimer un contrat |
| GET / POST | `/api/competitors` | Market Watch — concurrents suivis |
| DELETE | `/api/competitors/:id` | Supprimer un concurrent (+ ses notes) |
| GET / POST | `/api/competitors/:id/notes` | Journal d'observations sur un concurrent |
| GET / POST | `/api/feedback` | Voice of Customer — retours clients |
| DELETE | `/api/feedback/:id` | Supprimer un retour |

Pour les routes protégées, envoie le token dans l'en-tête : `Authorization: Bearer <token>`

## Les 5 modules

| Module | Ce qu'il fait réellement |
|---|---|
| **Investor Hub** | Update investisseur avec rédaction IA (Claude), historique, courbe ARR |
| **Finance** | Tu saisis tes dépenses mensuelles → calcul auto du burn moyen et projection du runway |
| **Legal** | Colle un contrat → l'IA extrait dates, préavis, parties clés. Alerte automatique si un préavis approche |
| **Market Watch** | Journal de veille : tu ajoutes tes concurrents et notes tes observations au fil de l'eau |
| **Voice of Customer** | Centralise tes retours clients → l'IA détecte les thèmes récurrents et la tendance générale |

**Important à savoir :** aucun de ces modules ne se connecte automatiquement à une vraie banque, un site concurrent ou une boîte mail — je n'ai pas accès à ce type d'intégration externe depuis cet environnement. Chaque module fonctionne sur la saisie manuelle + l'analyse IA, ce qui reste honnête et déjà bien plus rapide que du Google Sheets. Si tu veux plus tard de vraies connexions automatiques (API bancaire, scraping), ça demandera d'ajouter ces intégrations séparément, avec leurs propres clés d'accès.


## Sécurité — à savoir avant de mettre en ligne pour de vrais utilisateurs

- **Change `SESSION_SECRET`** avant toute mise en prod. Par défaut il vaut `change-this-secret-in-production`. Lance le serveur avec :
  ```bash
  SESSION_SECRET="une-longue-phrase-secrete-a-toi" node server.js
  ```
- Les mots de passe sont hashés avec **scrypt** (algorithme robuste, résistant au brute-force), jamais stockés en clair.
- Les sessions expirent après 30 jours.
- Ce serveur n'a **pas encore de HTTPS** — pour le mettre en ligne, il te faut soit un hébergeur qui gère le HTTPS automatiquement (Render, Railway, Fly.io — plans gratuits disponibles), soit configurer un certificat toi-même sur un VPS.

## Héberger pour de vrai (accessible depuis n'importe où, pas juste ton ordi)

Le code ne dépend d'aucun service — tu peux le déployer où tu veux. Les options les plus simples avec plan gratuit :

- **Railway.app** ou **Render.com** : tu connectes ton dépôt GitHub, ça détecte Node.js automatiquement, ça lance `node server.js`. Pense à définir la variable d'environnement `SESSION_SECRET`.
- **Un VPS** (si tu veux tout contrôler toi-même) : installe Node 22+, copie ces fichiers, lance avec `pm2` ou un service systemd pour que ça tourne en continu.

Dans les deux cas, la base de données `foundros.db` vit sur le serveur — pense à la sauvegarder régulièrement (`cp foundros.db foundros-backup-$(date +%F).db`).

## Limite actuelle

L'écriture de mise à jour investisseur utilise l'API Claude directement depuis le navigateur de l'utilisateur pour la rédaction IA — ça fonctionne dans l'environnement Claude, mais si tu héberges ce backend ailleurs et veux garder la rédaction IA, il faudra brancher ta propre clé API Anthropic côté serveur plutôt que depuis le frontend.
