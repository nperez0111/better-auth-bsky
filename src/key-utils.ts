import {
  type ClientAssertionPrivateJwk,
  generateClientAssertionKey,
} from "@atcute/oauth-node-client";

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
export function extractPublicJwk(privateJwk: ClientAssertionPrivateJwk): Record<string, unknown> {
  const {
    d: _d,
    p: _p,
    q: _q,
    dp: _dp,
    dq: _dq,
    qi: _qi,
    ...publicJwk
  } = privateJwk as unknown as Record<string, unknown>;
  return publicJwk;
}
