import {
  OAuthClient,
  buildPublicClientMetadata,
  OAuthCallbackError,
} from "@atcute/oauth-node-client";
import {
  LocalActorResolver,
  CompositeDidDocumentResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  CompositeHandleResolver,
  DohJsonHandleResolver,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

import type { AtprotoPluginOptions } from "./types.js";
import { atprotoSchema } from "./types.js";
import { DbSessionStore, DbStateStore } from "./stores.js";

function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function buildMetadata(baseURL: string, options: AtprotoPluginOptions) {
  const isLoopback = isLoopbackUrl(baseURL);
  const callbackPath = options.callbackPath ?? "/atproto/callback";
  const scope = options.scope ?? "atproto transition:generic";
  const isConfidential = !!options.keyset?.length;

  // baseURL already includes basePath (e.g. "http://localhost:3456/api/auth"),
  // so append callbackPath to it for the full redirect URI.
  // For loopback, ATProto spec requires 127.0.0.1 (not "localhost") in redirect URIs.
  const redirectUri = isLoopback
    ? `http://127.0.0.1:${new URL(baseURL).port}${new URL(baseURL).pathname}${callbackPath}`
    : `${baseURL}${callbackPath}`;

  if (isLoopback) {
    // ATProto spec only allows public clients on loopback (client_id must be HTTPS
    // for confidential clients). Keyset is ignored — warn if provided.
    if (isConfidential) {
      console.warn(
        "[atproto] keyset provided but baseURL is loopback — " +
          "falling back to public client mode. Use an HTTPS baseURL for confidential client support.",
      );
    }
    return {
      redirect_uris: [redirectUri],
      scope,
    } as ReturnType<typeof buildPublicClientMetadata>;
  }

  if (isConfidential) {
    const clientId = `${baseURL}${options.clientMetadataPath ?? "/oauth-client-metadata.json"}`;
    return {
      client_id: clientId,
      client_name: options.clientName,
      client_uri: options.clientUri,
      logo_uri: options.logoUri,
      tos_uri: options.tosUri,
      policy_uri: options.policyUri,
      redirect_uris: [redirectUri],
      scope,
      grant_types: ["authorization_code", "refresh_token"] as const,
      response_types: ["code"] as const,
      application_type: "web" as const,
      token_endpoint_auth_method: "private_key_jwt" as const,
      dpop_bound_access_tokens: true,
      jwks_uri: `${baseURL}${options.jwksPath ?? "/.well-known/jwks.json"}`,
    };
  }

  // Discoverable public client (non-loopback, no keyset)
  const clientId = `${baseURL}${options.clientMetadataPath ?? "/oauth-client-metadata.json"}`;
  return buildPublicClientMetadata({
    client_id: clientId,
    client_name: options.clientName,
    client_uri: options.clientUri,
    logo_uri: options.logoUri,
    tos_uri: options.tosUri,
    policy_uri: options.policyUri,
    redirect_uris: [redirectUri],
    scope,
  });
}

function createActorResolver() {
  return new LocalActorResolver({
    handleResolver: new CompositeHandleResolver({
      methods: {
        dns: new DohJsonHandleResolver({
          dohUrl: "https://cloudflare-dns.com/dns-query",
        }),
        http: new WellKnownHandleResolver(),
      },
    }),
    didDocumentResolver: new CompositeDidDocumentResolver({
      methods: {
        plc: new PlcDidDocumentResolver(),
        web: new WebDidDocumentResolver(),
      },
    }),
  });
}

const ATPROTO_ERROR_CODES = {
  INVALID_HANDLE: {
    code: "INVALID_HANDLE",
    message: "Invalid ATProto handle or DID",
  },
  AUTHORIZATION_FAILED: {
    code: "AUTHORIZATION_FAILED",
    message: "Failed to start ATProto authorization",
  },
  CALLBACK_FAILED: {
    code: "CALLBACK_FAILED",
    message: "ATProto OAuth callback failed",
  },
  SESSION_NOT_FOUND: {
    code: "SESSION_NOT_FOUND",
    message: "No ATProto session found for the current user",
  },
};

/**
 * ATProto OAuth plugin for better-auth.
 *
 * Integrates ATProto OAuth 2.1 (DPoP + PAR + PKCE) via @atcute/oauth-node-client.
 * Supports both confidential (with keyset) and public client modes.
 */
export const atproto = (options: AtprotoPluginOptions) => {
  let oauthClient: OAuthClient;

  return {
    id: "atproto",

    schema: atprotoSchema,

    init(ctx: { baseURL: string; adapter: unknown }) {
      const baseURL = ctx.baseURL;
      const adapter = ctx.adapter as import("./stores.js").DbAdapter;

      const sessionStore = new DbSessionStore(adapter);
      const stateStore = new DbStateStore(adapter);

      const metadata = buildMetadata(baseURL, options);
      const actorResolver = createActorResolver();

      // Confidential mode only works with HTTPS baseURL — loopback forces public client
      const useConfidential = !!options.keyset?.length && !isLoopbackUrl(baseURL);

      if (useConfidential) {
        oauthClient = new OAuthClient({
          metadata,
          keyset: options.keyset!,
          actorResolver,
          stores: { sessions: sessionStore, states: stateStore },
        } as ConstructorParameters<typeof OAuthClient>[0]);
      } else {
        oauthClient = new OAuthClient({
          metadata,
          actorResolver,
          stores: { sessions: sessionStore, states: stateStore },
        } as ConstructorParameters<typeof OAuthClient>[0]);
      }
    },

    endpoints: {
      atprotoClientMetadata: createAuthEndpoint(
        options.clientMetadataPath ?? "/oauth-client-metadata.json",
        { method: "GET" },
        async (ctx) => {
          return ctx.json(oauthClient.metadata);
        },
      ),

      atprotoJwks: createAuthEndpoint(
        options.jwksPath ?? "/.well-known/jwks.json",
        { method: "GET" },
        async (ctx) => {
          const jwks = oauthClient.jwks;
          if (!jwks) {
            throw APIError.fromStatus("NOT_FOUND", {
              message: "JWKS not available (public client mode)",
            });
          }
          return ctx.json(jwks);
        },
      ),

      signInAtproto: createAuthEndpoint(
        options.signInPath ?? "/sign-in/atproto",
        {
          method: "POST",
          body: z.object({
            handle: z.string().describe("ATProto handle (e.g. user.bsky.social) or DID"),
            callbackURL: z.string().describe("URL to redirect to after sign-in").optional(),
          }),
        },
        async (ctx) => {
          const { handle, callbackURL } = ctx.body;

          if (!handle || handle.length < 3) {
            throw APIError.from("BAD_REQUEST", ATPROTO_ERROR_CODES.INVALID_HANDLE);
          }

          try {
            const result = await oauthClient.authorize({
              target: {
                type: "account",
                identifier: handle as `${string}.${string}`,
              },
              state: callbackURL ? JSON.stringify({ callbackURL }) : undefined,
            });

            return ctx.json({
              url: result.url.toString(),
              redirect: true,
            });
          } catch (e) {
            console.error("[atproto] authorize failed:", e);
            throw APIError.from("INTERNAL_SERVER_ERROR", ATPROTO_ERROR_CODES.AUTHORIZATION_FAILED);
          }
        },
      ),

      atprotoCallback: createAuthEndpoint(
        options.callbackPath ?? "/atproto/callback",
        {
          method: "GET",
          query: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            iss: z.string().optional(),
            error: z.string().optional(),
            error_description: z.string().optional(),
          }),
        },
        async (ctx) => {
          if (ctx.query.error) {
            const errorUrl = `${ctx.context.baseURL}/error?error=${ctx.query.error}`;
            throw ctx.redirect(errorUrl);
          }

          try {
            const params = new URLSearchParams();
            if (ctx.query.code) params.set("code", ctx.query.code);
            if (ctx.query.state) params.set("state", ctx.query.state);
            if (ctx.query.iss) params.set("iss", ctx.query.iss);

            const { session: oauthSession, state: userState } = await oauthClient.callback(params);

            const did = oauthSession.did;

            // Resolve handle and PDS from the session's token info
            const tokenInfo = await oauthSession.getTokenInfo(false);
            const pdsUrl = tokenInfo.aud;

            // Try to resolve handle from DID
            let handle = did as string;
            try {
              const actorResolver = createActorResolver();
              const resolved = await actorResolver.resolve(did);
              handle = resolved.handle;
            } catch {
              // Fall back to DID as handle
            }

            // Find or create user + account in better-auth
            const existingAccount = await ctx.context.internalAdapter.findAccountByProviderId(
              did,
              "atproto",
            );

            let userId: string;

            if (existingAccount) {
              userId = existingAccount.userId;
            } else {
              const newUser = await ctx.context.internalAdapter.createUser({
                name: handle,
                email: `${did}@atproto.invalid`,
                emailVerified: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              });

              await ctx.context.internalAdapter.createAccount({
                userId: newUser.id,
                providerId: "atproto",
                accountId: did,
              });

              userId = newUser.id;
            }

            // Update atprotoSession with user info
            const existingAtprotoSession = await ctx.context.adapter.findOne<{ id: string }>({
              model: "atprotoSession",
              where: [{ field: "did", value: did }],
            });

            if (existingAtprotoSession) {
              await ctx.context.adapter.update({
                model: "atprotoSession",
                where: [{ field: "did", value: did }],
                update: {
                  userId,
                  handle,
                  pdsUrl,
                  updatedAt: new Date(),
                },
              });
            } else {
              await ctx.context.adapter.create({
                model: "atprotoSession",
                data: {
                  did,
                  sessionData: "{}",
                  userId,
                  handle,
                  pdsUrl,
                  updatedAt: new Date(),
                },
              });
            }

            // Create better-auth session
            const foundUser = await ctx.context.internalAdapter.findUserById(userId);
            if (!foundUser) {
              throw APIError.from("INTERNAL_SERVER_ERROR", ATPROTO_ERROR_CODES.CALLBACK_FAILED);
            }

            const session = await ctx.context.internalAdapter.createSession(userId);

            await setSessionCookie(ctx, {
              session,
              user: foundUser,
            });

            // Parse callbackURL from state
            let callbackURL = "/";
            if (userState) {
              try {
                const parsed = typeof userState === "string" ? JSON.parse(userState) : userState;
                if (parsed.callbackURL && typeof parsed.callbackURL === "string") {
                  callbackURL = parsed.callbackURL;
                }
              } catch {
                // Ignore parse errors
              }
            }

            // Validate redirect URL to prevent open redirects
            if (!callbackURL.startsWith("/") || callbackURL.startsWith("//")) {
              callbackURL = "/";
            }

            throw ctx.redirect(callbackURL);
          } catch (e) {
            // Re-throw redirects and API responses (status may be a string like "FOUND" or a number)
            if (e && typeof e === "object" && ("statusCode" in e || "status" in e)) {
              throw e;
            }
            if (e instanceof OAuthCallbackError) {
              const errorUrl = `${ctx.context.baseURL}/error?error=${e.error}`;
              throw ctx.redirect(errorUrl);
            }
            throw APIError.from("INTERNAL_SERVER_ERROR", ATPROTO_ERROR_CODES.CALLBACK_FAILED);
          }
        },
      ),

      atprotoGetSession: createAuthEndpoint("/atproto/session", { method: "GET" }, async (ctx) => {
        const { getSessionFromCtx } = await import("better-auth/api");
        const currentSession = await getSessionFromCtx(ctx);
        if (!currentSession) {
          throw APIError.fromStatus("UNAUTHORIZED", {
            message: "Not authenticated",
          });
        }

        const atprotoSession = await ctx.context.adapter.findOne<{
          did: string;
          handle: string;
          pdsUrl: string;
        }>({
          model: "atprotoSession",
          where: [
            {
              field: "userId",
              value: currentSession.user.id,
            },
          ],
        });

        if (!atprotoSession) {
          throw APIError.from("NOT_FOUND", ATPROTO_ERROR_CODES.SESSION_NOT_FOUND);
        }

        return ctx.json({
          did: atprotoSession.did,
          handle: atprotoSession.handle,
          pdsUrl: atprotoSession.pdsUrl,
        });
      }),

      atprotoSignOut: createAuthEndpoint("/atproto/sign-out", { method: "POST" }, async (ctx) => {
        const { getSessionFromCtx } = await import("better-auth/api");
        const currentSession = await getSessionFromCtx(ctx);
        if (!currentSession) {
          throw APIError.fromStatus("UNAUTHORIZED", {
            message: "Not authenticated",
          });
        }

        const atprotoSession = await ctx.context.adapter.findOne<{
          did: string;
        }>({
          model: "atprotoSession",
          where: [
            {
              field: "userId",
              value: currentSession.user.id,
            },
          ],
        });

        if (atprotoSession) {
          try {
            await oauthClient.revoke(atprotoSession.did as `did:${string}:${string}`);
          } catch {
            // Best effort revocation
          }
        }

        return ctx.json({ success: true });
      }),
    },

    $ERROR_CODES: ATPROTO_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};
