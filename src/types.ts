import type { ClientAssertionPrivateJwk } from "@atcute/oauth-node-client";

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
  /** OAuth scopes to request. Defaults to "atproto transition:generic". */
  scope?: string;

  /**
   * Private JWKs for confidential client mode (private_key_jwt auth).
   * If omitted, the plugin runs as a public client (shorter token lifetime).
   */
  keyset?: ClientAssertionPrivateJwk[];

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
