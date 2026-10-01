FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
