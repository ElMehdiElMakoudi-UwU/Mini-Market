# ---- Build stage: install deps (compiles better-sqlite3 if no prebuilt binary) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY public ./public

# Persistent volumes (mount these in Coolify)
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
