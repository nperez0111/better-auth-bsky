# better-auth-bsky

A [better-auth](https://better-auth.com) plugin that adds ATProto / Bluesky OAuth 2.1 authentication using [`@atcute/oauth-node-client`](https://npm.im/@atcute/oauth-node-client). Supports DPoP, PAR, and PKCE — the standard way to authenticate ATProto/Bluesky users without app passwords.

## Installation

```bash
bun add better-auth-bsky better-auth @atcute/oauth-node-client
```

## Usage

### Server

```typescript
import { betterAuth } from "better-auth";
import { atproto } from "better-auth-bsky";

export const auth = betterAuth({
  // ... your config
  plugins: [
    atproto({
      clientName: "My App",
    }),
  ],
});
```

### Client

```typescript
import { createAuthClient } from "better-auth/client";
import { atprotoClient } from "better-auth-bsky/client";

const client = createAuthClient({
  plugins: [atprotoClient()],
});

// Sign in — returns { url, redirect: true }
const { data } = await client.signIn.atproto({
  handle: "user.bsky.social",
  callbackURL: "/dashboard",
});
window.location.href = data.url;

// Check ATProto session
const session = await client.atproto.getSession();

// Restore ATProto session (lightweight token refresh check)
const status = await client.atproto.restore();

// Sign out (revokes ATProto OAuth session)
await client.atproto.signOut();
```

## Configuration

```typescript
atproto({
  // Required
  clientName: "My App",

  // Optional — app identity shown during authorization
  clientUri: "https://myapp.com",
  logoUri: "https://myapp.com/logo.png",
  tosUri: "https://myapp.com/tos",
  policyUri: "https://myapp.com/privacy",

  // Optional — OAuth scopes (default: "atproto")
  // Accepts a string or array of scope strings (e.g. from @atcute/oauth-types scope builders)
  // The base "atproto" scope is always included automatically
  scope: "atproto",

  // Optional — private keys for confidential client mode
  // If omitted, runs as a public client (shorter token lifetime)
  keyset: [privateJwk],

  // Optional — block new user creation (existing users can still sign in)
  disableSignUp: false,

  // Optional — custom profile-to-user field mapping
  // Called during sign-in to populate user name, email, and image
  mapProfileToUser: (profile) => ({
    name: profile.displayName || profile.handle,
    image: profile.avatar,
  }),

  // Optional — override endpoint paths
  clientMetadataPath: "/oauth-client-metadata.json", // default
  jwksPath: "/.well-known/jwks.json", // default
  callbackPath: "/atproto/callback", // default
  signInPath: "/sign-in/atproto", // default
});
```

## Public vs Confidential Client

The plugin auto-detects the client type based on whether `keyset` is provided.

|                              | Public              | Confidential           |
| ---------------------------- | ------------------- | ---------------------- |
| Config                       | No `keyset`         | `keyset: [privateJwk]` |
| `token_endpoint_auth_method` | `none`              | `private_key_jwt`      |
| Max session lifetime         | 14 days             | 180 days               |
| JWKS endpoint                | Not served          | Serves public keys     |
| Loopback support             | Yes (auto-detected) | Yes (dev only)         |

### Generating a keypair

```typescript
import { generateAtprotoKeypair } from "better-auth-bsky";

const privateJwk = await generateAtprotoKeypair();
// Store securely — do NOT commit to version control
```

## Endpoints

All paths are relative to better-auth's `basePath`.

| Method | Path                          | Purpose                                                       |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| GET    | `/oauth-client-metadata.json` | OAuth client metadata document                                |
| GET    | `/.well-known/jwks.json`      | Public JWKS (confidential mode only)                          |
| POST   | `/sign-in/atproto`            | Start OAuth flow (`{ handle, callbackURL? }`)                 |
| GET    | `/atproto/callback`           | OAuth callback (code exchange, profile sync, user management) |
| GET    | `/atproto/session`            | Current user's ATProto info (DID, handle, PDS)                |
| POST   | `/atproto/restore`            | Lightweight session check with token refresh                  |
| POST   | `/atproto/sign-out`           | Revoke ATProto OAuth session                                  |

Additionally, `getAtprotoClient` is a server-only endpoint (not exposed over HTTP). It returns an authenticated `@atcute/client` `Client` and `OAuthSession` for making XRPC calls on behalf of a user:

```typescript
const { client, session } = await auth.api.getAtprotoClient({
  body: { did: "did:plc:abc123" },
  // or: { userId: "user-id" }
});
```

### Rate Limiting

The plugin applies rate limits to sensitive endpoints:

- `/sign-in/atproto`: 5 requests per 60 seconds
- `/atproto/callback`: 10 requests per 60 seconds

## Database Schema

The plugin extends the `user` table and adds two new tables via better-auth's migration system.

**`user` table extensions:**

| Column          | Type   | Notes                            |
| --------------- | ------ | -------------------------------- |
| `atprotoDid`    | string | Unique, the user's permanent DID |
| `atprotoHandle` | string | Current ATProto handle           |

**`atprotoSession`** — persists OAuth sessions for `@atcute/oauth-node-client`:

| Column        | Type   | Notes                                     |
| ------------- | ------ | ----------------------------------------- |
| `id`          | string | PK                                        |
| `did`         | string | Unique, the user's DID                    |
| `sessionData` | string | JSON blob (DPoP key, tokens, auth method) |
| `userId`      | string | FK to `user.id` (cascade delete)          |
| `handle`      | string | ATProto handle (can change)               |
| `pdsUrl`      | string | User's PDS endpoint                       |
| `updatedAt`   | date   |                                           |

**`atprotoState`** — temporary OAuth authorization states (~10min TTL):

| Column      | Type   | Notes                                       |
| ----------- | ------ | ------------------------------------------- |
| `id`        | string | PK                                          |
| `stateKey`  | string | Unique, the OAuth state parameter           |
| `stateData` | string | JSON blob (DPoP key, PKCE verifier, issuer) |
| `expiresAt` | number | Unix timestamp                              |

## How it Works

1. **Sign-in**: Client POSTs handle to `/sign-in/atproto`. The plugin resolves the handle to a DID, discovers the user's PDS and authorization server, generates PKCE + DPoP keys, sends a PAR request, and returns the authorization URL.

2. **Authorization**: User authorizes at their PDS authorization server (e.g. bsky.social).

3. **Callback**: PDS redirects back to `/atproto/callback`. The plugin exchanges the code for tokens (with DPoP proof), fetches the user's profile (display name, avatar, etc.), then either finds an existing user, links to a currently-logged-in user, or creates a new user. Profile fields are synced to the user record, the ATProto session is persisted, a better-auth session cookie is set, and the user is redirected to the `callbackURL`.

4. **Account linking**: If a user is already signed in via another method and completes the ATProto OAuth flow, their ATProto account is linked to their existing user. This respects better-auth's `account.accountLinking.enabled` configuration.

5. **Session restoration**: On server restart, `oauthClient.restore(did)` rehydrates sessions from the database and handles token refresh automatically. The `/atproto/restore` endpoint exposes this to the client.

6. **Authenticated API calls**: Use `auth.api.getAtprotoClient({ body: { did } })` server-side to get an authenticated `@atcute/client` `Client` for making XRPC calls on behalf of a user.

## Identity Mapping

- **DID** is the permanent identifier, stored as `account.accountId` with `account.providerId = "atproto"`, and on the user record as `atprotoDid`
- **Email** uses a deterministic placeholder: `{did}@atproto.invalid` (RFC 2606 reserved TLD). Override via `mapProfileToUser` if you have access to the user's email
- **Handle** is tracked on both `atprotoSession.handle` and `user.atprotoHandle`, and updated on each sign-in
- **Profile** data (display name, avatar, banner, bio) is fetched on sign-in and mapped to user fields via `mapProfileToUser`

## Exports

### `better-auth-bsky` (main)

| Export                      | Type     | Description                                       |
| --------------------------- | -------- | ------------------------------------------------- |
| `atproto`                   | function | Server plugin factory                             |
| `atprotoClient`             | function | Client plugin factory                             |
| `generateAtprotoKeypair`    | function | Generate ES256 keypair for confidential mode      |
| `extractPublicJwk`          | function | Extract public JWK from a private JWK             |
| `fetchAtprotoProfilePublic` | function | Fetch a profile via the Bluesky public API        |
| `atprotoPlaceholderEmail`   | function | Generate deterministic placeholder email from DID |
| `DbSessionStore`            | class    | Database-backed OAuth session store               |
| `DbStateStore`              | class    | Database-backed OAuth state store                 |
| `atprotoSchema`             | object   | Database schema definition for migrations         |
| `AtprotoPluginOptions`      | type     | Plugin configuration options                      |
| `AtprotoProfile`            | type     | Profile data shape from ATProto                   |

### `better-auth-bsky/client`

| Export          | Type     | Description           |
| --------------- | -------- | --------------------- |
| `atprotoClient` | function | Client plugin factory |

## Development

```bash
bun install
bun run build       # build with tsdown
bun run test        # vitest run
bun run test:watch  # vitest watch
bun run check       # lint + typecheck + fmt check
bun run demo        # interactive demo with Cloudflare tunnel
bun run demo:local  # demo on localhost only (no tunnel)
```

## License

MIT
