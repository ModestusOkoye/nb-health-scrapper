FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npx playwright install chromium

COPY . .

# Railway runs this on a cron schedule via the start command
CMD ["node", "scraper.js"]
