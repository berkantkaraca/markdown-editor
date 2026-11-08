FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY site ./site
COPY src ./src
COPY media/style.css media/icon.png ./media/
RUN npm run build:web

FROM nginx:alpine
COPY --from=build /app/out/web/ /usr/share/nginx/html/
EXPOSE 80
