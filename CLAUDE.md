# CLAUDE.md

## Project

better-auth-bsky — A better-auth plugin for AT Protocol OAuth sign-in.

## Commands

- `bun run build` — Build with tsdown (ESM + dts)
- `bun run test` — Run vitest
- `bun run test:watch` — Run vitest in watch mode
- `bun run typecheck` — Type-check without emitting
- `bun run lint` — Lint with oxlint (type-aware)
- `bun run fmt` — Format with oxfmt
- `bun run check` — Lint + typecheck + format check
- `bun install` — Install dependencies (always use bun, not npm)

## Architecture

Three entry points:

- `src/index.ts` — Barrel export re-exporting everything from server, client, stores, key-utils, and types.
- `src/server.ts` — Server plugin (`atproto()`). Wraps `@atcute/oauth-node-client` with better-auth endpoints, DB-backed state/session stores, and user/account management.
- `src/client.ts` — Client plugin (`atprotoClient()`). Provides `signIn.atproto()`, `atproto.getSession()`, `atproto.signOut()` actions.

Supporting modules:

- `src/types.ts` — Plugin options type (`AtprotoPluginOptions`) and database schema definition (`atprotoSchema`).
- `src/stores.ts` — `DbSessionStore` and `DbStateStore` classes implementing `@atcute/oauth-node-client` store interfaces backed by better-auth's DB adapter.
- `src/key-utils.ts` — `generateAtprotoKeypair()` and `extractPublicJwk()` for ES256 keypair management.

Key design decisions:

- AT Protocol OAuth is not standard OAuth — authorization servers are per-user (each PDS is its own AS), DPoP is mandatory, and client identity is a publicly-hosted metadata URL. This is why `genericOAuth` can't be used.
- Uses the `@atcute/*` ecosystem (community SDK) rather than the official `@atproto/*` SDK, for a lighter dependency footprint.
- Localhost uses the atproto loopback `client_id` format. Redirect URIs use `127.0.0.1` per RFC 8252. No private key or tunnel needed for dev.
- OAuth state and session stores are backed by the better-auth DB adapter (`atprotoState`, `atprotoSession` tables), not in-memory.
- Supports both public and confidential client modes. Confidential mode requires a `keyset` (JWK array), public mode is the default.
- AT Protocol doesn't expose user emails. A deterministic placeholder (`{did}@atproto.invalid`) is used for the required `email` field.
- Profile syncing maps atproto profile data (handle, display name, avatar, bio, banner) to better-auth user fields via `mapProfileToUser`.
- Rate limiting is applied to `/sign-in/atproto` (5/60s) and `/atproto/callback` (10/60s) via the plugin `rateLimit` property.
- Account linking in the callback respects `account.accountLinking.enabled` from the user's better-auth config.
- `disableSignUp` option prevents new user creation (returns FORBIDDEN for unknown DIDs).

## Schema

Extends `user` with: `atprotoDid` (unique), `atprotoHandle`.
Adds tables: `atprotoState` (ephemeral auth state, 10 min TTL), `atprotoSession` (persistent token storage keyed by DID, with userId FK, handle, pdsUrl).

## Style

- 2-space indentation, double quotes, semicolons, trailing commas
- 100 char line width (oxfmt)
- ESM only (`"type": "module"`)
- Separate concerns across files (types, stores, key-utils, server, client)
- `createAuthEndpoint` from `better-auth/api` for all endpoints
- `internalAdapter` for user/account/session CRUD; raw `adapter` for custom tables
- All test files are co-located with source (e.g., `server.test.ts` next to `server.ts`)
