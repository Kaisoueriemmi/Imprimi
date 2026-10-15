# Décisions techniques

Choix faits sans demande explicite, avec leur raison. Le plus récent en bas de chaque phase.

## Phase 1 — Fondations

### D1. Versions des dépendances : majeures éprouvées plutôt que les toutes dernières

TypeScript **5.9**, NestJS **11**, Vitest **3**, ESLint **9**, Prisma **6**, Zod **4**, Next.js **15** (imposé).
Au moment de l'initialisation (oct. 2026), TypeScript 7 (compilateur natif) et NestJS 12 venaient de
sortir (quelques semaines). Le support des décorateurs/metadata dont Nest dépend et la compatibilité
de l'écosystème (typescript-eslint, SWC, Prisma) restent à confirmer. Migration à planifier quand
l'écosystème aura suivi.

### D2. Prisma 6 et `package.json#prisma`

Prisma 7 impose les driver adapters et `prisma.config.ts`. On reste sur Prisma 6, dont la
config `package.json#prisma` (commande de seed) affiche un avertissement de dépréciation, sans
effet. À migrer vers `prisma.config.ts` en même temps que le passage à Prisma 7.

### D3. Code de retrait unique « parmi les travaux actifs »

Prisma ne sait pas décrire un index unique partiel (`WHERE status IN (...)`), et un index ajouté à la
main en SQL serait supprimé par la migration suivante (dérive). Solution : deux colonnes.

- `pickupCode` : le code, conservé pour l'historique.
- `activePickupCode` : le même code tant que le travail est actif, `NULL` ensuite.
  L'index `UNIQUE` (les `NULL` ne se comparent pas) garantit l'unicité parmi les travaux actifs.

### D4. Clé de la borne et clé de l'écran dès le schéma initial

La Phase 5 exige une clé d'écran différente de la clé d'agent. `Kiosk.displayKeyHash` est créé dès
maintenant pour éviter une migration avec valeur par défaut sur une colonne `UNIQUE`.

### D5. Hachage des clés API : SHA-256 ; mots de passe : argon2id

Les clés API sont 256 bits aléatoires (`pbk_…` agent, `pbd_…` écran) : aucune attaque par
dictionnaire n'est possible, donc un SHA-256 suffit et permet la recherche par index unique.
Les mots de passe admin, eux, utilisent argon2id (19 MiB, t=2, p=1, minimum OWASP).

### D6. `paperLevelHint` : enum `UNKNOWN | OK | LOW | EMPTY`

Windows n'expose pas un niveau de papier fiable ; on stocke une indication déduite de
`PrinterStatus` (`PaperOut`, `PaperProblem`…), pas un pourcentage.

### D7. Règles de prix globales : unicité gérée par l'application

`@@unique([kioskId, colorMode])` ne bloque pas deux règles globales (`kioskId = NULL`) en
PostgreSQL. Le seed et (Phase 7) le service de tarifs font « chercher puis créer/modifier ».
Prix seed provisoires : N&B 0,100 DT/page, couleur 0,500 DT/page, −10 % en recto-verso.

### D8. Montants

Entiers en millimes partout ; affichage `formatMillimes()` du package shared : `0,250 DT`
(virgule décimale, espace fine insécable pour les milliers, espace insécable avant « DT »).

### D9. Machine à états : FAILED n'est pas terminal

`FAILED → QUEUED` (réimpression, Phase 7) et `FAILED → CANCELLED` (remboursement) sont permis.
Le fichier d'un travail FAILED est donc conservé jusqu'à l'annulation ou la purge de sécurité
(2 h, Phase 8) : c'est le « FAILED définitif » de la spec.

### D10. Stockage local : MinIO reconstruit par Chainguard

MinIO a cessé de publier ses images Docker (`minio/minio` n'existe plus sur Docker Hub, quay.io
exige une authentification). On utilise `cgr.dev/chainguard/minio` (MinIO compilé depuis les
sources, mis à jour) et `cgr.dev/chainguard/minio-client`, **épinglés par digest** car seul
`latest` est public. Le code ne dépend que de l'API S3 derrière `StorageService` : basculer vers
un autre stockage compatible S3 (RustFS, Garage, SeaweedFS, R2, Scaleway…) ne change que la config.

### D11. Tests de l'API : Vitest + SWC

Un seul runner (Vitest) dans tout le monorepo. Pour NestJS, le plugin `unplugin-swc` émet les
métadonnées de décorateurs nécessaires à l'injection de dépendances (esbuild ne le fait pas).

### D12. Next.js `output: 'standalone'` seulement dans l'image Docker

Le mode standalone crée des liens symboliques, refusés par Windows sans le mode développeur.
Il est activé par `NEXT_OUTPUT_STANDALONE=1`, positionné dans `apps/web/Dockerfile`.

### D13. Logs

pino (via nestjs-pino) : JSON en production, `pino-pretty` en développement. Les requêtes sont
journalisées sans en-têtes ni query string (jetons QR, URL pré-signées), `/health` et `/metrics`
ne sont pas journalisés. Un identifiant de requête (`x-request-id` ou UUID) accompagne chaque ligne.

### D14. Démarrage de l'API sans base disponible

Prisma se connecte à la première requête : l'API démarre et `/health` répond 503 tant que
PostgreSQL est indisponible, au lieu de planter. L'image Docker applique `prisma migrate deploy`
avant de démarrer ; le seed reste une action manuelle unique.

### D15. Helmet, CORS et `trust proxy` dès la Phase 1

Coût nul, et cela évite d'oublier : helmet actif, CORS limité à `CORS_ORIGINS`, `trust proxy = 1`
(Caddy devant l'API en production). Le durcissement complet reste en Phase 8.

### D16. Port PostgreSQL hôte configurable

`POSTGRES_PORT` (défaut 5432) : un PostgreSQL natif occupe souvent déjà 5432 sur le PC de dev.

## Phase 2 — Sessions QR et upload

### D17. Jeton QR → session client

Le QR porte un JWT HS256 de 90 s (`sub` = borne, `jti` = nonce aléatoire, audience `printbox:qr`).
Le téléphone l'échange (`POST /api/sessions`) contre un **jeton de session** de 30 min, signé avec
un **autre secret** (`SESSION_TOKEN_SECRET`, audience `printbox:session`), à envoyer en
`Authorization: Bearer` sur les appels suivants. Le jeton QR n'est donc exposé qu'une fois.
Toute anomalie (expiré, falsifié, autre borne) donne la même réponse 401 `QR_EXPIRED`
« Rescannez le QR sur la borne » : on ne renseigne pas un attaquant sur la cause.

### D18. Un même QR peut ouvrir jusqu'à 5 sessions

Deux clients devant la borne dans la même minute scannent le même QR : un jeton à usage unique
bloquerait le second. On autorise 5 sessions par `jti` (comptées en base), ce qui suffit
à empêcher qu'un QR photographié serve en boucle pendant ses 90 s.

### D19. Écran de borne authentifié par sa clé d'affichage

`POST /api/kiosks/:id/qr-token` exige `Authorization: Bearer pbd_…` (clé d'écran, distincte de
la clé d'agent `pbk_…`), et la clé doit appartenir à la borne de l'URL.

### D20. Upload : busboy vers un fichier temporaire

Le fichier est écrit en flux sur disque (jamais en mémoire), limité à 20 Mo par busboy. Un envoi
un peu trop gros est lu jusqu'au bout (l'excédent est jeté) pour que le téléphone reçoive un
413 lisible au lieu d'une connexion coupée ; au-delà de 80 Mo annoncés, la requête est coupée.
Le type réel est déterminé par les magic bytes (`%PDF-` dans le premier Kio, JPEG, PNG ; pour un
ZIP, présence de `[Content_Types].xml` **et** `word/document.xml`). L'extension et le
Content-Type du client sont ignorés. Un travail = un fichier ; 10 travaux max par session.

### D21. File de conversion dans PostgreSQL, pas de Redis

La table `JobFile` sert de file : `conversionStatus` PENDING → PROCESSING par un `UPDATE … WHERE
status = PENDING` atomique, donc plusieurs workers ne traitent jamais le même fichier. Un
fichier resté PROCESSING plus de 5 min (crash) repart en PENDING, et échoue après 3 tentatives.
Pas de Redis/BullMQ à opérer pour quelques dizaines de fichiers par heure.
En dev le worker tourne dans le process API (`CONVERSION_WORKER_ENABLED=true`) ; en Docker,
un service `worker` (même image, `node dist/worker.js`) le fait et l'API ne convertit pas.

### D22. Conversion

- **PDF** : conservé tel quel (c'est lui qu'on imprime), pages comptées avec pdf-lib.
  Un PDF chiffré avec seulement un mot de passe propriétaire (impression permise) est accepté ;
  s'il faut un mot de passe pour l'ouvrir, Poppler échoue et il est refusé (`PDF_ENCRYPTED`).
- **Images** : sharp applique l'orientation EXIF (photos de téléphone), limite à 3508 px
  (A4 à 300 dpi), aplatit la transparence sur blanc ; pdf-lib pose l'image sur une page A4
  orientée comme elle, marges 10 mm, centrée.
- **DOCX** : LibreOffice headless, profil utilisateur isolé par conversion, timeout 90 s.
  L'image embarque les polices Carlito/Caladea/Liberation (métriques identiques aux polices
  Office, la pagination est conservée) et Noto (arabe).
- **Miniature** : page 1 en WebP 360 px qualité 60 (léger en 4G). Sans Poppler (poste de dev
  Windows), la conversion réussit sans miniature.
- **Échec** : fichiers supprimés immédiatement du stockage, `deletedAt` renseigné, travail
  `FAILED` avec un code (`TOO_MANY_PAGES`, `PDF_ENCRYPTED`, `CORRUPTED_FILE`, `CONVERSION_FAILED`).

### D23. Clés de stockage anonymes

`files/<uuid>/original`, `document.pdf`, `thumb.webp` : ni le nom du fichier ni l'identité du
client n'apparaissent dans le stockage. Le nom d'origine (nettoyé, 200 caractères max) n'est
gardé qu'en base pour l'afficher au client, et n'est jamais journalisé.

### D24. Format d'erreur unique

Toutes les erreurs HTTP sont `{ statusCode, code, message }` (codes dans `@printbox/shared`,
message en français par défaut). Les messages internes du framework sont remplacés : le 404 par
défaut de Nest recopie l'URL, donc les jetons en query string.

### D25. Rate limiting

Deux compteurs (@nestjs/throttler) : par IP (120 req/min par défaut) et par jeton porteur
(session client ou clé de borne, haché). Ouverture de session : 10/min par IP. Upload :
15 / 10 min par session et 30 / 10 min par IP. `/health` n'est pas limité.

### D26. Testcontainers dès la Phase 2

Le parcours QR → session → upload → conversion est testé contre un vrai PostgreSQL
(`pnpm test:integration`, Docker requis), avec un stockage en mémoire. Testcontainers v11 :
la v12 exige Node ≥ 22.22, or le projet cible Node 20.
