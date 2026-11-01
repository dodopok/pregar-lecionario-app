# Imagem da API do Pregar. Contexto de build: raiz do repositório (monorepo).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/editor/package.json packages/editor/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --workspace @pregar/api --workspace @pregar/core --include-workspace-root=false
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build --workspace @pregar/api

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/editor/package.json packages/editor/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --workspace @pregar/api --workspace @pregar/core --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
