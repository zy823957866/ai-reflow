FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@12.5.1

COPY --chown=node:node . .
RUN chown -R node:node /app

USER node

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM nginx:1.29-alpine

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

