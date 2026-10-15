# PrintBox

Borne d'impression en libre-service par QR code : le client scanne le QR affiché par la borne,
envoie son fichier depuis son téléphone, paie au comptoir avec un code de retrait, et l'agent
installé sur le PC Windows de la borne imprime puis supprime le fichier.

> Documentation complète (architecture, installation de l'agent, mode kiosque, déploiement) : Phase 9.

## Structure

| Dossier           | Rôle                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `apps/api`        | NestJS + Prisma (PostgreSQL 16) + Socket.IO                             |
| `apps/web`        | Next.js 15 : web app client (PWA), écran de borne, dashboard admin      |
| `apps/agent`      | Agent d'impression Windows (service, SumatraPDF)                        |
| `packages/shared` | Enums, schémas Zod, constantes, événements Socket.IO (source de vérité) |

Les choix techniques sont consignés dans [DECISIONS.md](DECISIONS.md).

## Démarrage local

Prérequis : Node.js ≥ 20, pnpm 10, Docker.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # remplacer les valeurs "change-me"
cp .env.example .env                         # variables de docker-compose
pnpm db:up                                   # PostgreSQL + MinIO + création du bucket
pnpm db:migrate
pnpm db:seed                                 # affiche UNE FOIS les clés de la borne et le mot de passe admin
pnpm dev                                     # api :3001, web :3000
```

Tout en conteneurs : `docker compose up -d --build` (le fichier `.env` doit définir `QR_TOKEN_SECRET`).

Si un PostgreSQL local occupe déjà le port 5432, mettez `POSTGRES_PORT=5433` dans `.env`
et le même port dans `DATABASE_URL` de `apps/api/.env`.

## Commandes

| Commande         | Effet                                 |
| ---------------- | ------------------------------------- |
| `pnpm build`     | build de tous les paquets (Turborepo) |
| `pnpm lint`      | ESLint                                |
| `pnpm typecheck` | `tsc --noEmit`                        |
| `pnpm test`      | Vitest                                |
| `pnpm format`    | Prettier                              |

`GET /health` : 200 si la base répond, 503 sinon.
