# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Add non-root user
RUN addgroup -g 1001 -S hexstrike && \
    adduser -S hexstrike -u 1001 && \
    chown -R hexstrike:hexstrike /usr/share/nginx/html && \
    chown -R hexstrike:hexstrike /var/cache/nginx && \
    chown -R hexstrike:hexstrike /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R hexstrike:hexstrike /var/run/nginx.pid

# Switch to non-root user
USER hexstrike

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080 || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
