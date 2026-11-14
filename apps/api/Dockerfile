# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:20-bookworm-slim AS base
# openssl: required by the Prisma query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.34.6
WORKDIR /repo

FROM base AS build
# Toolchain for native modules (argon2) when no prebuilt binary is picked up; build stage only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @printbox/api...
RUN pnpm turbo run build --filter=@printbox/api...
# Self-contained production folder: dist, prisma/, prod node_modules (shared package included).
RUN pnpm --filter @printbox/api deploy --prod --legacy /out \
  && cd /out && ./node_modules/.bin/prisma generate

FROM base AS runtime
# DOCX → PDF (LibreOffice Writer, no GUI) and PDF thumbnails (Poppler).
# Fonts: Liberation + Carlito/Caladea (metric-compatible with Arial/Times/Calibri/Cambria, so
# Word layouts keep their pagination) and Noto for Arabic.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer-nogui poppler-utils \
    fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
# npm (et son tar embarqué) ne sert pas à l'exécution : retiré pour réduire la surface d'attaque.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production \
  HOME=/tmp
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Seeding stays a manual, one-off step.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
