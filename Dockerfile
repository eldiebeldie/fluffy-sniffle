# ==========================================
# fluffy-sniffle - GitHub Health Analyzer (.NET 10)
# Multi-stage Dockerfile for High Performance & Security
# ==========================================

# 1. Build & Publish Stage
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

# Copy project file and restore dependencies first for optimal Docker layer caching
COPY fluffy-sniffle.csproj ./
RUN dotnet restore fluffy-sniffle.csproj

# Copy remaining source code and resources
COPY . ./

# Build and publish release binaries
RUN dotnet publish fluffy-sniffle.csproj -c Release -o /app/publish /p:UseAppHost=false

# 2. Runtime Stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime

# Metadata
LABEL maintainer="EldieBeldie <eldargr@gmail.com>"
LABEL description="GitHub repository health analyzer: stale branches, open PRs, and contributor analytics (.NET 10)"

# Ensure CA certificates are present for HTTPS GitHub API requests
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Set default production environment
ENV ASPNETCORE_ENVIRONMENT=Production \
    PORT=3000 \
    ASPNETCORE_URLS=http://+:3000

# Copy published application
COPY --from=build /app/publish ./
COPY config.json ./
COPY README.md ./

# Create reports directory and set proper permissions
RUN mkdir -p /app/reports && \
    addgroup -g 1000 appgroup && \
    adduser -u 1000 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app

# Run as non-root user
USER appuser

EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/data || exit 1

# Start ASP.NET Core server
ENTRYPOINT ["dotnet", "fluffy-sniffle.dll"]
