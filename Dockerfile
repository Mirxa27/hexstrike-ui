# syntax=docker/dockerfile:1.6

# ─── Stage 1: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Build-time configuration. Wired into the static bundle via Vite's
# `import.meta.env.VITE_*` and into the nginx upstream substitution.
ARG VITE_API_BASE_URL=/api
ARG VITE_HEXSTRIKE_URL=/api
ARG BACKEND_URL=http://hexstrike-backend:8888/api

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_HEXSTRIKE_URL=$VITE_HEXSTRIKE_URL

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build (typecheck + bundle)
COPY . .
RUN npm run typecheck && npm run build

# ─── Stage 2: Runtime ──────────────────────────────────────────────────
FROM nginx:alpine

# Copy built assets and nginx config
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Non-root user with writable nginx state dirs
RUN addgroup -g 1001 -S hexstrike \
 && adduser -S hexstrike -u 1001 \
 && chown -R hexstrike:hexstrike /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
 && mkdir -p /var/run/nginx \
 && touch /var/run/nginx.pid \
 && chown -R hexstrike:hexstrike /var/run/nginx /var/run/nginx.pid

# Remove nginx user directive from default config (conflicts with non-root)
RUN sed -i '/^user /d' /etc/nginx/nginx.conf

USER hexstrike

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
