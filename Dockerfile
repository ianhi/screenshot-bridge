FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc && cp -r src/public dist/public

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist/

ENV PORT=3456 HOST=0.0.0.0 OPEN_BROWSER=0
EXPOSE 3456

CMD ["node", "dist/index.js"]
