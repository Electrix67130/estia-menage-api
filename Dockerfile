FROM node:24-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production : l'app tourne via tsx (pas de build), donc on garde toutes les
# dépendances — tsx/typescript en font partie. On ne fixe PAS NODE_ENV pendant
# `npm ci`, sinon les devDeps (dont tsx) seraient omises et l'image cassée ;
# NODE_ENV=production est fourni au runtime par le compose/env_file.
FROM base AS production
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
