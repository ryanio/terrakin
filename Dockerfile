# Terrakin: one container serves the API, WebSocket, and the built client.
# Build: docker build -t terrakin .
# (If Docker Hub rate-limits you: --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-slim)
# Run:   docker run -p 8787:8787 -v terrakin-data:/data terrakin

ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/sim/package.json packages/sim/
COPY packages/protocol/package.json packages/protocol/
COPY packages/cards/package.json packages/cards/
COPY packages/ui/package.json packages/ui/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/admin/package.json packages/admin/
# Optional extra CA certs for networks with a TLS proxy:
#   docker build --secret id=ca,src=/path/to/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca corepack enable \
 && NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    pnpm build \
 && NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm --filter @terrakin/server deploy --prod --legacy /out \
 && cp -r packages/client/dist /out/public

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8787 \
    TERRAKIN_DATA_DIR=/data \
    TERRAKIN_STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build /out .
COPY scripts/docker/entrypoint.sh /usr/local/bin/terrakin-entrypoint
# The entrypoint fixes /data ownership as root, then drops to the unprivileged `node` user.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["terrakin-entrypoint"]
CMD ["node_modules/.bin/tsx", "src/main.ts"]
