# syntax=docker/dockerfile:1.6

# ─── Stage 1: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Build-time configuration. Wired into the static bundle via Vite's
# `import.meta.env.VITE_*` and into the nginx upstream substitution.
ARG VITE_API_BASE_URL=/api
ARG VITE_HEXSTRIKE_URL=/api
ARG BACKEND_URL=http://hexstrike-backend:8888

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

ARG BACKEND_URL=http://hexstrike-backend:8888

# Copy built assets and nginx template
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.tpl

# Substitute the backend upstream into the nginx config at build time.
# (Kept as a sed pass rather than envsubst so $vars in the config aren't clobbered.)
RUN sed "s|__BACKEND_URL__|${BACKEND_URL}|g" /etc/nginx/conf.d/default.conf.tpl > /etc/nginx/conf.d/default.conf \
 && rm /etc/nginx/conf.d/default.conf.tpl \
 && nginx -t

# Non-root user with writable nginx state dirs
RUN addgroup -g 1001 -S hexstrike \
 && adduser -S hexstrike -u 1001 \
 && chown -R hexstrike:hexstrike /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
 && touch /var/run/nginx.pid \
 && chown -R hexstrike:hexstrike /var/run/nginx.pid

USER hexstrike

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
