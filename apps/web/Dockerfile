# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the build: next.config.ts uses them for image optimisation and the Content-Security-Policy.
ARG MEDIA_PUBLIC_URL=""
ARG MEDIA_UPLOAD_ORIGIN=""
ENV NEXT_TELEMETRY_DISABLED=1 MEDIA_PUBLIC_URL=$MEDIA_PUBLIC_URL MEDIA_UPLOAD_ORIGIN=$MEDIA_UPLOAD_ORIGIN
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
