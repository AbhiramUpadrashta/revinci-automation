# Hosted Revinci Test Automation — Playwright image ships Chromium + all system libraries.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
ENV NODE_ENV=production HOSTED=1 HOST=0.0.0.0 PORT=4600 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
EXPOSE 4600
CMD ["node", "server.js"]
