FROM node:22-alpine

WORKDIR /app
COPY package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY fixtures ./fixtures

USER node
CMD ["node", "src/cli.js", "sync"]
