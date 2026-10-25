# HireByte frontend: Vite build served by nginx, which also proxies /api to the Node API so the
# browser sees one origin (the session cookies are SameSite=Lax).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Real API on the same origin; never the fixture transport.
ENV VITE_API_BASE_URL=/api VITE_USE_FIXTURES=false
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
