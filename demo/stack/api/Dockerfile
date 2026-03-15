FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json /app/
RUN npm install --no-audit --no-fund
COPY src /app/src
EXPOSE 8000
CMD ["npm", "run", "start"]
