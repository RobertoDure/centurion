# Build context is the repository root:
#   docker compose -f infra/docker-compose.yml build jev-mock
FROM node:22-alpine

RUN npm install -g pnpm@12.8.1

WORKDIR /app

# Manifests first so the dependency layer is cached independently of sources.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/jev-mock/package.json ./apps/jev-mock/package.json

# The build context only carries the jev-mock slice of the workspace, and the
# repository lockfile also records sibling projects (e.g. apps/api). Regenerate
# from the manifests present here instead of requiring a frozen match.
RUN pnpm install --no-frozen-lockfile

# Source-exported packages: no build step needed. The server runs with tsx.
COPY packages/contracts/src ./packages/contracts/src
COPY apps/jev-mock/src ./apps/jev-mock/src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@centurion/jev-mock", "exec", "tsx", "src/index.ts"]
