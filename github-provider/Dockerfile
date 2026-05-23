FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js consumer.js minioClient.js ./
EXPOSE 3002
CMD ["node", "server.js"]
