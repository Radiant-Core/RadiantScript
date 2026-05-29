# BUILD IMAGE
# node:18-alpine is the highest LTS Node confirmed to work with the
# legacy Docusaurus 2.0.0-alpha.58 stack pinned in website/package.json.
# Newer Node majors (20/22) may work; bump only after verifying the docs
# build still succeeds.
FROM node:18-alpine AS build

WORKDIR /app

# Optional cache-bust: pass `--build-arg CACHE_BUST=$(date +%s)` to force a
# fresh `yarn` install without depending on an external HTTP service. The
# previous worldtimeapi.org cache-bust was both a supply-chain risk (build
# embedded bytes fetched from a third-party host) and a flaky build input.
ARG CACHE_BUST=0
RUN echo "cache_bust=${CACHE_BUST}" > /tmp/cache_bust

# Add app
COPY website /app

# website/ ships yarn.lock; use --frozen-lockfile for reproducible builds.
RUN yarn install --frozen-lockfile

# Remove potentially cached Docusaurus files
RUN rm -rf /app/.docusaurus /app/build

# Generate build
RUN yarn build

# ###############################################################################

# PROD IMAGE
FROM nginx:stable-alpine

# Copy build artifacts from the 'build environment'
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/build /usr/share/nginx/html
