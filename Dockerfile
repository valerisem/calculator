# Node 22 + LibreOffice (for PDF export of the proposal decks) with the template fonts.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress fonts-inter fonts-dejavu-core fontconfig curl ca-certificates \
  && mkdir -p /usr/share/fonts/truetype/montserrat \
  && for w in Regular Medium SemiBold Bold ExtraBold Black; do \
       curl -fsSL -o /usr/share/fonts/truetype/montserrat/Montserrat-$w.ttf \
         https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-$w.ttf; \
     done \
  && fc-cache -f \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
