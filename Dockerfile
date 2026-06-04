# Grantd broker. Provide config via environment variables (or a mounted .env):
#   DATABASE_URL, ENCRYPTION_KEYRING, ENCRYPTION_ACTIVE_KID, API_KEY_SALT, PUBLIC_BASE_URL, PORT
# Run migrations once against your database with `npm run migrate` before first start.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8787
CMD ["npm", "start"]
