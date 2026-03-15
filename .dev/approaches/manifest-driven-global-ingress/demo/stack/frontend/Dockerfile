FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts index.html /app/
RUN npm install --no-audit --no-fund
COPY src /app/src
EXPOSE 3000
CMD ["npm", "run", "start"]
