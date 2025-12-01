FROM index.docker.io/library/node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY index.js ./
COPY lib/ ./lib/

CMD [ "npm", "run", "start" ]
