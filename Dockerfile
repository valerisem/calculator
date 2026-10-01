# Node 22 + LibreOffice (for PDF export of the proposal decks) with the template fonts.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress fonts-inter fonts-montserrat fonts-dejavu-core fontconfig \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
