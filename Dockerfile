# ==========================================
# fluffy-sniffle - GitHub Health Analyzer
# Dockerfile for Production Deployment
# ==========================================
FROM node:24-alpine

# Metadata
LABEL maintainer="EldieBeldie <eldargr@gmail.com>"
LABEL description="GitHub repository health analyzer: stale branches, open PRs, and contributor analytics"

# Ensure CA certificates are present for HTTPS GitHub API requests
RUN apk --no-cache add ca-certificates

# Create application directory
WORKDIR /app

# Set default production environment
ENV NODE_ENV=production \
    PORT=3000

# Copy dependency manifests first for optimal layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy application source code and configuration
COPY src/ ./src/
COPY config.json ./
COPY README.md ./

# Create reports directory and set proper permissions for non-root user
RUN mkdir -p reports && \
    chown -R node:node /app

# Use built-in non-root node user for container security
USER node

# Expose web dashboard port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/data || exit 1

# Start the server (without desktop browser auto-open)
CMD ["node", "src/server.js"]

