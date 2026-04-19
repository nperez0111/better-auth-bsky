import type { PublicJwk } from "@atcute/oauth-crypto";
import {
  type ClientAssertionPrivateJwk,
  generateClientAssertionKey,
} from "@atcute/oauth-node-client";

/** Private key fields to strip when extracting a public JWK. */
const PRIVATE_KEY_FIELDS = new Set(["d", "p", "q", "dp", "dq", "qi"]);

/**
 * Generates an ES256 keypair for ATProto confidential client authentication.
 * The returned JWK includes private key material and should be stored securely.
 */
export async function generateAtprotoKeypair(kid?: string): Promise<ClientAssertionPrivateJwk> {
  return generateClientAssertionKey(kid ?? "atproto-key", "ES256");
}

/**
 * Extracts the public portion of a JWK by stripping private key fields.
 * Safe to serve at the JWKS endpoint.
 */
export function extractPublicJwk(privateJwk: ClientAssertionPrivateJwk): PublicJwk {
  const entries = Object.entries(privateJwk).filter(([key]) => !PRIVATE_KEY_FIELDS.has(key));
  // oxlint-disable-next-line no-unsafe-type-assertion -- Object.fromEntries loses type info
  return Object.fromEntries(entries) as PublicJwk;
}
