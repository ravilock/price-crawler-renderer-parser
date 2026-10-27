FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./package.json
RUN npm install && npx playwright install --with-deps chromium
COPY src ./src
CMD ["npm","start"]
