FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install --global pnpm@12.5.1

COPY --chown=node:node . .
RUN chown -R node:node /app

USER node

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

EXPOSE 8787

CMD ["./node_modules/.bin/tsx", "--tsconfig", "apps/server/tsconfig.json", "apps/server/src/main.ts"]

