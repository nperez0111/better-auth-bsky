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

// Sign in
const { data } = await client.signIn.atproto({
  handle: "user.bsky.social",
  callbackURL: "/dashboard",
});
window.location.href = data.url;

// Check session
const session = await client.atproto.getSession();

// Sign out
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

  // Optional — OAuth scopes (default: "atproto transition:generic")
  scope: "atproto transition:generic",

  // Optional — private keys for confidential client mode
  // If omitted, runs as a public client (shorter token lifetime)
  keyset: [privateJwk],

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

| Method | Path                          | Purpose                                                |
| ------ | ----------------------------- | ------------------------------------------------------ |
| GET    | `/oauth-client-metadata.json` | OAuth client metadata document                         |
| GET    | `/.well-known/jwks.json`      | Public JWKS (confidential mode only)                   |
| POST   | `/sign-in/atproto`            | Start OAuth flow (`{ handle, callbackURL? }`)          |
| GET    | `/atproto/callback`           | OAuth callback (handles code exchange + user creation) |
| GET    | `/atproto/session`            | Current user's ATProto info (DID, handle, PDS)         |
| POST   | `/atproto/sign-out`           | Revoke ATProto OAuth session                           |

## Database Schema

The plugin adds two tables via better-auth's migration system:

**`atprotoSession`** — persists OAuth sessions for `@atcute/oauth-node-client`:

| Column        | Type   | Notes                                     |
| ------------- | ------ | ----------------------------------------- |
| `id`          | string | PK                                        |
| `did`         | string | Unique, the user's DID                    |
| `sessionData` | string | JSON blob (DPoP key, tokens, auth method) |
| `userId`      | string | FK to `user.id`                           |
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

3. **Callback**: PDS redirects back to `/atproto/callback`. The plugin exchanges the code for tokens (with DPoP proof), creates or finds a user/account in better-auth, persists the ATProto session, creates a better-auth session cookie, and redirects to the `callbackURL`.

4. **Session restoration**: On server restart, `oauthClient.restore(did)` rehydrates sessions from the database and handles token refresh automatically.

5. **Authenticated API calls**: Retrieve the `OAuthSession` via `oauthClient.restore(did)` and use it as a fetch handler for `@atcute/client`.

## Identity Mapping

- DID is the permanent identifier, mapped via `account.providerId = "atproto"`, `account.accountId = did`
- Email uses `{did}@atproto.invalid` (RFC 2606 reserved TLD — same pattern as better-auth's phone/anonymous plugins)
- Handle is tracked in `atprotoSession.handle` but may change over time

## Development

```bash
bun install
bun run build       # build with tsdown
bun run test        # vitest run
bun run test:watch  # vitest watch
bun run check       # lint + typecheck + fmt check
```

## License

MIT
