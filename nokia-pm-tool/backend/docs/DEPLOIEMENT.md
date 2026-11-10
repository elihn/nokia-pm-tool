# Guide de Déploiement et d'Exploitation du Système de Licences NOKIA PM TOOL

Ce guide détaille l'architecture, la configuration et le déploiement en production du système professionnel de gestion des licences pour l'application Android **NOKIA PM TOOL**.

---

## 1. Principes et Architecture de Sécurité

- **Modèle Hybride :**
  - **Activation initiale obligatoire en ligne :** un smartphone doit contacter le backend pour enregistrer son empreinte matérielle et obtenir son jeton signé.
  - **30 jours d'utilisation consécutive 100% hors-ligne :** pendant 30 jours complets, le technicien peut saisir des données, prendre des photos certifiées avec TimeStamp Camera Free, générer et exporter tous les rapports Excel Nokia PM sans aucune connexion Internet.
  - **Synchronisation automatique et silencieuse :** dès que le téléphone retrouve du réseau, l'application synchronise son statut et renouvelle la fenêtre de 30 jours d'autonomie hors-ligne.
- **Règle stricte 1 Licence = 1 Smartphone :**
  - L'application génère une paire de clés matérielle non exportable via **Android Keystore** et un identifiant d'installation unique.
  - Le serveur associe de façon univoque la licence à l'appareil. Toute tentative d'activation de la même clé sur un autre téléphone est automatiquement bloquée. L'administrateur peut dissocier un appareil depuis le tableau de bord en cas de changement de smartphone.
- **Cryptographie Asymétrique Ed25519 (RFC 8032) :**
  - **Clé Privée Serveur (32 octets) :** conservée exclusivement dans les secrets sécurisés du backend Supabase / Node.js. Aucune clé privée n'est présente dans l'APK.
  - **Clé Publique Serveur (32 octets) :** intégrée dans l'application mobile (`Ed25519Verifier.kt`) pour vérifier l'authenticité mathématique des jetons.
  - Clé Publique Client (Hex) : `291443119ec1d1f8b189bb9873d690e1d37c67948fba1b1baf035ba312fb8074`
- **Protection Anti-Altération d'Horloge (Anti-Rollback) :**
  - Un recul manuel de l'horloge système du téléphone de plus d'une heure bloque immédiatement l'export et exige une reconnexion.
- **Non-destructivité des données :**
  - L'expiration ou la suspension d'une licence bloque uniquement l'exportation de nouveaux fichiers Excel. Toutes les saisies, photos et brouillons locaux restent **strictement préservés et accessibles**.

---

## 2. Déploiement sur Supabase Cloud

### Étape 1 : Créer la base de données PostgreSQL
1. Rendez-vous sur votre console [Supabase Cloud](https://app.supabase.com) et créez un projet.
2. Ouvrez l'éditeur **SQL Editor**.
3. Copiez et exécutez l'intégralité du script `/backend/database/schema.sql`.
   - Ce script crée les tables `admin_users`, `technicians`, `licenses`, `devices`, `license_logs`.
   - Il configure les index de performance et les règles de sécurité Row Level Security (RLS).

### Étape 2 : Configurer les Secrets d'environnement
Dans la console Supabase, allez dans **Project Settings > Edge Functions > Secrets** (ou via le CLI Supabase) et ajoutez :
```bash
# Clé privée Ed25519 (Hexadécimal de 64 caractères)
supabase secrets set ED25519_PRIVATE_KEY="24726a9eb1aaa3b78226b9f8e58e7fffc53dd2a1fd43fbcb8463c7e3d14358f0"

# Secret d'administration pour sécuriser les appels admin-api
supabase secrets set ADMIN_SECRET_KEY="votre_secret_admin_securise"
```

### Étape 3 : Déployer les Edge Functions Deno
À la racine du projet backend, déployez les 3 fonctions :
```bash
# 1. Activation de licence (client mobile)
supabase functions deploy activate-license --no-verify-jwt

# 2. Synchronisation de validité 30 jours (client mobile)
supabase functions deploy sync-license --no-verify-jwt

# 3. API d'administration pour le tableau de bord
supabase functions deploy admin-api --no-verify-jwt
```

---

## 3. Tableau de Bord Web d'Administration

Le tableau de bord se trouve dans le fichier `/backend/admin/index.html`.

### Fonctionnalités disponibles :
1. **Statistiques en temps réel :** licences actives, total des licences émises, techniciens enregistrés, téléphones liés.
2. **Gestion des techniciens :** ajout de techniciens avec nom, société, e-mail, téléphone et notes.
3. **Création de licences :**
   - Attribution à un technicien ou licence libre.
   - Sélection de la durée : **1 Mois (30 jours)**, **3 Mois**, **6 Mois**, **1 An**, ou **Permanente**.
   - Clé personnalisée ou génération automatique au format `NOKIA-XXXX-XXXX-XXXX`.
4. **Actions sur les licences existantes :**
   - **Suspendre / Réactiver :** gèle temporairement les droits d'exportation d'un technicien.
   - **Révoquer :** bannit définitivement la licence.
   - **Prolonger (Renew) :** prolonge la durée de validité (ex. ajout de 3 mois ou 1 an).
   - **Délier l'appareil (Unbind) :** libère la liaison 1:1, permettant au technicien de réactiver sa licence sur un nouveau smartphone suite à un changement de matériel ou une perte.
5. **Journal d'Audit :** historique horodaté de toutes les activations, rejets, modifications de statut et adresses IP.

### Hébergement du Tableau de Bord :
- **Option A :** Ouvrir directement le fichier `index.html` dans n'importe quel navigateur moderne.
- **Option B :** L'héberger sur Supabase Storage (bucket public), Vercel, Netlify, Cloudflare Pages ou GitHub Pages.
- **Option C :** Via le serveur Node.js inclus (`http://localhost:3001/admin/`).

---

## 4. Serveur Standalone Node.js (Alternative / Environnement de Test)

Pour un déploiement autonome (sur VPS Linux, conteneur Docker, ou environnement interne d'entreprise sans Supabase), un serveur complet prêt à l'emploi est inclus dans `/backend/server/server.js`.

### Lancement :
```bash
node backend/server/server.js
```
- Port par défaut : `3001` (ou via la variable d'environnement `LICENSE_SERVER_PORT`).
- Interface d'administration accessible à : `http://<ip-serveur>:3001/admin/`
- Points de terminaison API : `http://<ip-serveur>:3001/api/activate`, `http://<ip-serveur>:3001/api/sync`

---

## 5. Configuration de l'Application Mobile Android

### Connexion au serveur de licence :
1. Par défaut, l'application est configurée pour pointer vers l'environnement local ou de test (`http://10.0.2.2:3001`).
2. Pour pointer vers votre backend de production Supabase :
   - Dans l'application Nokia PM Tool, appuyez sur le badge **Licence** en haut à droite.
   - Déroulez **Paramètres Serveur Avancés**.
   - Saisissez l'URL de votre fonction Supabase (ex: `https://<votre-projet>.supabase.co/functions/v1/activate-license` ou `https://licence.votredomaine.com`).
   - Appuyez sur **Enregistrer l'URL**.
3. Vous pouvez également définir `DEFAULT_SERVER_URL` directement dans `LicenseManager.kt` ligne 51 avant de générer l'APK de release.

---

## 6. Synthèse des Clés Cryptographiques

| Rôle | Emplacement | Type | Clé |
|---|---|---|---|
| **Clé Publique** | APK Android (`Ed25519Verifier.kt`) | Ed25519 Public Key (Hex) | `291443119ec1d1f8b189bb9873d690e1d37c67948fba1b1baf035ba312fb8074` |
| **Clé Privée** | Backend Supabase / Node.js | Ed25519 Private Key (Hex) | `24726a9eb1aaa3b78226b9f8e58e7fffc53dd2a1fd43fbcb8463c7e3d14358f0` |

*Note de sécurité : la clé privée ne doit JAMAIS être partagée publiquement ni incluse dans le code source Android.*
