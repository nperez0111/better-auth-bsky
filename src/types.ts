import type { ClientAssertionPrivateJwk } from "@atcute/oauth-node-client";

/** Profile data fetched from the ATProto network after OAuth sign-in. */
export type AtprotoProfile = {
  /** The user's permanent decentralized identifier (e.g. "did:plc:abc123"). */
  did: string;
  /** The user's current handle (e.g. "user.bsky.social"). */
  handle: string;
  /** Display name, if set. */
  displayName?: string;
  /** Avatar image URL, if set. */
  avatar?: string;
  /** Banner image URL, if set. */
  banner?: string;
  /** Bio / description text, if set. */
  description?: string;
};

/** Configuration options for the ATProto OAuth plugin. */
export type AtprotoPluginOptions = {
  /** Display name shown to users during OAuth authorization. */
  clientName: string;
  /** Homepage URL for the client application. */
  clientUri?: string;
  /** Logo URL shown during authorization. */
  logoUri?: string;
  /** Terms of service URL. */
  tosUri?: string;
  /** Privacy policy URL. */
  policyUri?: string;
  /**
   * OAuth scopes to request. Defaults to "atproto" (identity-only).
   * Accepts a single space-separated string or an array of scope strings
   * (e.g. from @atcute/oauth-types scope builders like `scope.rpc(...)`, `scope.repo(...)`).
   * The base "atproto" scope is always included automatically.
   */
  scope?: string | string[];

  /**
   * Private JWKs for confidential client mode (private_key_jwt auth).
   * If omitted, the plugin runs as a public client (shorter token lifetime).
   */
  keyset?: ClientAssertionPrivateJwk[];

  /**
   * When true, prevents new user creation via ATProto OAuth.
   * Existing users can still sign in. Returns FORBIDDEN for unknown DIDs.
   */
  disableSignUp?: boolean;

  /**
   * Custom mapping from an ATProto profile to better-auth user fields.
   * Called during sign-in/sign-up to populate user name, email, image, etc.
   * If not provided, defaults to mapping displayName to name and avatar to image.
   */
  mapProfileToUser?: (
    profile: AtprotoProfile,
  ) => Partial<{ name: string; email: string; image: string }>;

  /** Path for the OAuth client metadata document. Default: "/oauth-client-metadata.json" */
  clientMetadataPath?: string;
  /** Path for the JWKS endpoint. Default: "/.well-known/jwks.json" */
  jwksPath?: string;
  /** Path for the OAuth callback. Default: "/atproto/callback" */
  callbackPath?: string;
  /** Path for the sign-in endpoint. Default: "/sign-in/atproto" */
  signInPath?: string;
};

/** Database schema field definitions for better-auth plugin schema. */
export const atprotoSchema = {
  user: {
    fields: {
      atprotoDid: {
        type: "string" as const,
        unique: true,
        required: false,
        returned: true,
        input: false,
      },
      atprotoHandle: {
        type: "string" as const,
        required: false,
        returned: true,
        input: false,
      },
    },
  },
  atprotoSession: {
    fields: {
      did: { type: "string" as const, unique: true, required: true },
      sessionData: { type: "string" as const, required: true },
      userId: {
        type: "string" as const,
        required: true,
        references: { model: "user", field: "id", onDelete: "cascade" as const },
      },
      handle: { type: "string" as const, required: true },
      pdsUrl: { type: "string" as const, required: true },
      updatedAt: { type: "date" as const, required: true },
    },
  },
  atprotoState: {
    fields: {
      stateKey: { type: "string" as const, unique: true, required: true },
      stateData: { type: "string" as const, required: true },
      expiresAt: { type: "number" as const, required: true },
    },
  },
} as const;
