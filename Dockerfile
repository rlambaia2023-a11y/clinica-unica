FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server.mjs"]
