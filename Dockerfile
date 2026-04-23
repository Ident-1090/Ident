# syntax=docker/dockerfile:1

FROM node:25-bookworm AS web
WORKDIR /src/ident
COPY ident/package.json ident/pnpm-lock.yaml ./
RUN PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@").pop()')" \
  && npm install -g "pnpm@${PNPM_VERSION}" \
  && pnpm install --frozen-lockfile
COPY ident/ ./
RUN pnpm build

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY identd/go.mod identd/go.sum ./identd/
RUN cd identd && go mod download
COPY identd/ ./identd/
COPY --from=web /src/ident/dist/ ./identd/web/
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
RUN cd identd && CGO_ENABLED=0 go build -tags embed -trimpath \
  -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildDate=${BUILD_DATE}" \
  -o /out/identd .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates \
  && addgroup -S ident \
  && adduser -S -G ident ident
USER ident
ENV IDENT_ADDR=:8080 \
  IDENT_DATA_DIR=/run/readsb
EXPOSE 8080
COPY --from=build /out/identd /usr/local/bin/identd
ENTRYPOINT ["/usr/local/bin/identd"]
