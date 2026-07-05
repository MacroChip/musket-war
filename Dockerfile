# ---- build: typecheck everything and bundle the client ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
RUN npm run build

# ---- runtime: server + built client, production deps only ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.base.json ./
COPY shared/src shared/src
COPY server/src server/src
COPY server/tsconfig.json server/
COPY --from=build /app/client/dist client/dist

ENV PORT=8080
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# tsx runs the TypeScript server directly; invoked straight from .bin so the
# process gets signals (clean `docker compose down`) without npm in the way.
CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
