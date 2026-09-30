FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
# The browser bundle plus the backend that serves it.
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
COPY --from=build /app/shared ./shared
# The email templates embed this logo as base64 at runtime, so the production
# image needs the source asset even though the bundle already contains it.
COPY --from=build /app/frontend/public/assets ./frontend/public/assets
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
