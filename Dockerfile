FROM node:24.1.0-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV ROTERMINAL_SERVER_PORT=8787
EXPOSE 8787

CMD ["npm", "run", "start:server"]
