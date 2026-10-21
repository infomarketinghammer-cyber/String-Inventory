FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src

RUN mkdir -p /data
EXPOSE 3000
# SQLite file lives on the /data volume. `db push` creates/updates the tables from schema.prisma,
# the seed is idempotent, and db:verify fails the container loudly if any balance doesn't reconcile.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run db:seed && npm run db:verify && npm start"]
