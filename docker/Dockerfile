# syntax=docker/dockerfile:1
# Multi-stage build: deps -> build -> runtime.

# ---- deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/workers/package.json packages/workers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Media toolchain: docx->pdf (LibreOffice Writer), pdf->png thumbnails
# (ghostscript + graphicsmagick), and HEIC decode (libheif) for sharp.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-core libreoffice-writer \
      ghostscript graphicsmagick \
      libheif1 \
      fonts-liberation \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY package.json ./

# Non-root user; /storage is a mounted volume owned by it.
RUN useradd -m -u 10001 darrow \
    && mkdir -p /storage \
    && chown -R darrow:darrow /storage /app \
    && chmod 700 /storage
USER darrow

ENV STORAGE_ROOT=/storage LIBREOFFICE_BIN=/usr/bin/libreoffice PORT=3000
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "docker/entrypoint.sh"]
