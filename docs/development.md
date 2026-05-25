# Development

How to work on Ident locally. For contribution norms and how to report issues,
see [CONTRIBUTING.md](https://github.com/Ident-1090/Ident/blob/main/CONTRIBUTING.md).

## Repository layout

- `ident/` — the React web UI.
- `identd/` — the Go service and the embedded release binary.
- `packaging/` — Docker, systemd, and package assets.
- `docs/` — this documentation site.

Development runs the frontend and the service separately; release builds embed the
web UI into `identd`.

## Running it locally

The frontend dev server:

```sh
cd ident
pnpm install
pnpm dev
```

The service, pointed at receiver data (or at the fixture below):

```sh
cd identd
go run .
```

For UI work without a live receiver, there is a self-contained dev stack with
generated receiver data:

```sh
docker compose -f docker-compose.dev.yaml up
```

You can also generate fixture receiver files directly with
`node scripts/generate-receiver-fixture.mjs` and point the service at them.

To work on these docs:

```sh
cd docs
pnpm docs:dev
```

## Checks

Run the ones that apply to your change:

```sh
cd ident
pnpm test
pnpm build
pnpm check

cd ../identd
go test ./...
```

## Wire schemas

The Ident-owned websocket and HTTP payload schemas live in `schemas/ident/` and
are generated from the Go wire structs. After changing a wire struct, regenerate
them:

```sh
cd identd
IDENT_UPDATE_SCHEMAS=1 go test . -run TestIdentSchemasAreCurrent -count=1
go test . -run TestIdentSchemasAreCurrent -count=1
```

The ordinary Go test fails when a committed schema is stale, so CI and the
pre-commit hook both enforce freshness.

## Pre-commit hook

The hook at `ident/.husky/pre-commit` runs three checks: `gofmt` over `identd/`,
the schema-freshness check above, and formatting of staged JS, TS, and JSON files.
Husky installs it from `ident/`'s `prepare` script, so run `pnpm install` inside
`ident/` at least once for the hook to fire. If a commit fails with "gofmt would
rewrite", run `gofmt -w identd/` and re-stage.

## Building a release

```sh
./scripts/build-identd.sh
```

This builds the web app, stages it for embedding, and writes the `identd` binary.
Nix users can run `nix run .#build-identd` instead.
