# Builder stage: install deps + build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Runner stage: production runtime only
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --production --legacy-peer-deps
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/server ./server
COPY --from=builder /app/README.md ./README.md
EXPOSE 3000
ENV PORT=3000

# For better experience in Baota / container panels
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server/index.js"]
