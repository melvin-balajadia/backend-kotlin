# ─── Stage 1: Install Dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

# ─── Stage 2: Production Image ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# ─── Non-root User ────────────────────────────────────────────────────────────
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# ─── Copy Dependencies & Source ───────────────────────────────────────────────
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ─── Create Logs Directory ────────────────────────────────────────────────────
# Winston writes to logs/error.log and logs/combined.log
# This dir must exist before the app starts
RUN mkdir -p logs && chown -R appuser:appgroup /app

# ─── Notes ────────────────────────────────────────────────────────────────────
# certificates/ is intentionally NOT copied —
# bind-mounted at runtime via docker-compose so real certs
# are never baked into the image

# ─── Switch to Non-root User ──────────────────────────────────────────────────
USER appuser

EXPOSE 8088

CMD ["node", "index.js"]