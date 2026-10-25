# HireByte Node API. Build context is backend/ (see docker-compose.prod.yml) so prisma/ and
# contracts/ sit next to api/ exactly as they do in the repository.
FROM node:24-slim

# Prisma's migration engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/api
COPY prisma /app/prisma
COPY contracts /app/contracts
COPY api/package.json api/package-lock.json api/prisma.config.ts ./
# Dev dependencies stay installed: tsx runs the TypeScript directly, and the Prisma CLI applies
# migrations at start-up. npm ci also generates the Prisma client (postinstall).
RUN npm ci
COPY api/ ./

ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx tsx src/server.ts"]
