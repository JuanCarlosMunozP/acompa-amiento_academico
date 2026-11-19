FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# API servida por Nginx y reenviada al backend por HTTP dentro de la red Docker.
ARG EXPO_PUBLIC_API_URL=https://localhost:8446/api
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}

RUN npx expo export --platform web --output-dir dist

FROM nginx:stable-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint-local-https.sh /usr/local/bin/docker-entrypoint-local-https
# El script debe tener finales de línea Unix aunque se edite en Windows.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint-local-https \
    && chmod +x /usr/local/bin/docker-entrypoint-local-https
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-local-https"]
CMD ["nginx", "-g", "daemon off;"]
