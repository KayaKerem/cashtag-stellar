# Build context = repo root:
#   docker build -f services/verifier/Dockerfile -t cliprail-verifier .
FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/verifier/package.json services/verifier/
RUN pnpm install --frozen-lockfile --filter verifier --config.confirmModulesPurge=false

COPY config ./config
COPY fixtures ./fixtures
COPY services/verifier ./services/verifier

WORKDIR /app/services/verifier
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["pnpm", "start"]
