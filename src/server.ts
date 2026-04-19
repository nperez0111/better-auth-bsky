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
import { Client } from "@atcute/client";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

import { isDid } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons";

import type { AtprotoPluginOptions, AtprotoProfile } from "./types.js";
import { atprotoSchema } from "./types.js";
import { DbSessionStore, DbStateStore } from "./stores.js";

// ────────────────────────── Helpers ──────────────────────────

/** Safely extract a string field from an unknown record. */
function getString(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" ? v : undefined;
}

/** Parse a JSON response body into a plain record. */
async function parseJsonResponse(resp: Response): Promise<Record<string, unknown>> {
  const body: unknown = await resp.json();
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    // oxlint-disable-next-line no-unsafe-type-assertion -- validated above
    return body as Record<string, unknown>;
  }
  return {};
}

/** Convert a string to a Did, validating at runtime. Returns undefined if invalid. */
function toDid(value: string): Did | undefined {
  return isDid(value) ? value : undefined;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Normalize scope option to a single space-joined string. Always includes "atproto" as the base. */
function normalizeScope(scope: string | string[] | undefined): string {
  if (!scope) return "atproto";
  const joined = Array.isArray(scope) ? scope.join(" ") : scope;
  // Ensure the mandatory "atproto" base scope is present
  const parts = joined.split(/\s+/).filter(Boolean);
  if (!parts.includes("atproto")) {
    parts.unshift("atproto");
  }
  return parts.join(" ");
}

function buildMetadata(baseURL: string, options: AtprotoPluginOptions) {
  const isLoopback = isLoopbackUrl(baseURL);
  const callbackPath = options.callbackPath ?? "/atproto/callback";
  const scope = normalizeScope(options.scope);
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
    // oxlint-disable-next-line no-unsafe-type-assertion -- loopback client_id format per ATProto spec
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

// ────────────────────────── Profile Fetching ──────────────────────────

/**
 * Fetch an ATProto profile using the Bluesky public API.
 * This is a fallback when an authenticated session is not available.
 */
export async function fetchAtprotoProfilePublic(did: string): Promise<AtprotoProfile | null> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await parseJsonResponse(resp);
    return {
      did: getString(data, "did") ?? did,
      handle: getString(data, "handle") ?? did,
      displayName: getString(data, "displayName"),
      avatar: getString(data, "avatar"),
      banner: getString(data, "banner"),
      description: getString(data, "description"),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch an ATProto profile using an authenticated XRPC client.
 * Falls back to the public API if the authenticated call fails.
 */
async function fetchAtprotoProfile(oauthClient: OAuthClient, did: string): Promise<AtprotoProfile> {
  // Try authenticated fetch first via the OAuth session's DPoP-bound fetch
  try {
    const validDid = toDid(did);
    if (!validDid) throw new Error(`Invalid DID: ${did}`);
    const oauthSession = await oauthClient.restore(validDid);
    const resp = await oauthSession.handle(
      `/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    );
    if (!resp.ok) throw new Error(`Profile fetch failed: ${resp.status}`);
    const profile = await parseJsonResponse(resp);
    return {
      did: getString(profile, "did") ?? did,
      handle: getString(profile, "handle") ?? did,
      displayName: getString(profile, "displayName"),
      avatar: getString(profile, "avatar"),
      banner: getString(profile, "banner"),
      description: getString(profile, "description"),
    };
  } catch {
    // Fall back to public API
  }

  const publicProfile = await fetchAtprotoProfilePublic(did);
  if (publicProfile) return publicProfile;

  // Last resort: return minimal profile with just the DID
  return { did, handle: did };
}

// ────────────────────────── Placeholder Email ──────────────────────────

/**
 * Generate a deterministic placeholder email for an ATProto DID.
 * ATProto doesn't expose user emails, but better-auth requires one.
 * Uses the RFC 2606 reserved `.invalid` TLD.
 */
export function atprotoPlaceholderEmail(did: string): string {
  // Replace colons with underscores for email compatibility
  return `${did.replaceAll(":", "_")}@atproto.invalid`;
}

// ────────────────────────── Error Codes ──────────────────────────

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
  SIGNUP_DISABLED: {
    code: "SIGNUP_DISABLED",
    message: "New user registration via ATProto is disabled",
  },
  ACCOUNT_LINKING_DISABLED: {
    code: "ACCOUNT_LINKING_DISABLED",
    message: "Account linking is not enabled",
  },
};

// ────────────────────────── Plugin ──────────────────────────

/**
 * ATProto OAuth plugin for better-auth.
 *
 * Integrates ATProto OAuth 2.1 (DPoP + PAR + PKCE) via @atcute/oauth-node-client.
 * Supports both confidential (with keyset) and public client modes.
 */
export const atproto = (options: AtprotoPluginOptions) => {
  let oauthClient: OAuthClient;

  const signInPath = options.signInPath ?? "/sign-in/atproto";
  const callbackPath = options.callbackPath ?? "/atproto/callback";

  return {
    id: "atproto",

    schema: atprotoSchema,

    rateLimit: [
      { pathMatcher: (path: string) => path === signInPath, window: 60, max: 5 },
      { pathMatcher: (path: string) => path === callbackPath, window: 60, max: 10 },
    ],

    init(ctx: { baseURL: string; adapter: unknown }) {
      const baseURL = ctx.baseURL;
      // oxlint-disable-next-line no-unsafe-type-assertion -- better-auth types adapter as unknown
      const adapter = ctx.adapter as import("./stores.js").DbAdapter;

      const sessionStore = new DbSessionStore(adapter);
      const stateStore = new DbStateStore(adapter);

      const metadata = buildMetadata(baseURL, options);
      const actorResolver = createActorResolver();

      // Confidential mode only works with HTTPS baseURL — loopback forces public client
      const useConfidential = !!options.keyset?.length && !isLoopbackUrl(baseURL);

      if (useConfidential) {
        // oxlint-disable-next-line no-unsafe-type-assertion -- OAuthClient overloaded constructor
        oauthClient = new OAuthClient({
          metadata,
          keyset: options.keyset!,
          actorResolver,
          stores: { sessions: sessionStore, states: stateStore },
        } as ConstructorParameters<typeof OAuthClient>[0]);
      } else {
        // oxlint-disable-next-line no-unsafe-type-assertion -- OAuthClient overloaded constructor
        oauthClient = new OAuthClient({
          metadata,
          actorResolver,
          stores: { sessions: sessionStore, states: stateStore },
        } as ConstructorParameters<typeof OAuthClient>[0]);
      }
    },

    endpoints: {
      // ── Client metadata & JWKS ──

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

      // ── Sign-in ──

      signInAtproto: createAuthEndpoint(
        signInPath,
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
            // oxlint-disable-next-line no-unsafe-type-assertion -- validated above
            const identifier = handle as `${string}.${string}`;
            const result = await oauthClient.authorize({
              target: {
                type: "account",
                identifier,
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

      // ── OAuth callback ──

      atprotoCallback: createAuthEndpoint(
        callbackPath,
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

            // Resolve PDS URL from the session's token info
            const tokenInfo = await oauthSession.getTokenInfo(false);
            const pdsUrl = tokenInfo.aud;

            // Fetch full profile (authenticated, then public fallback)
            const profile = await fetchAtprotoProfile(oauthClient, did);

            // Apply custom profile mapping (or defaults)
            const mappedFields = options.mapProfileToUser
              ? options.mapProfileToUser(profile)
              : {
                  name: profile.displayName || profile.handle,
                  image: profile.avatar,
                };

            const email = mappedFields.email || atprotoPlaceholderEmail(did);

            // ── Determine user: existing account, account linking, or new user ──

            // 1. Check for existing atproto account by DID
            const existingAccount = await ctx.context.internalAdapter.findAccountByProviderId(
              did,
              "atproto",
            );

            let userId: string;

            if (existingAccount) {
              // Existing ATProto user — update profile fields
              userId = existingAccount.userId;
              await ctx.context.internalAdapter.updateUser(userId, {
                name: mappedFields.name,
                image: mappedFields.image,
                atprotoDid: did,
                atprotoHandle: profile.handle,
              });
            } else {
              // 2. Check if user is currently logged in (account linking scenario)
              const { getSessionFromCtx } = await import("better-auth/api");
              const currentSession = await getSessionFromCtx(ctx).catch(() => null);

              if (currentSession) {
                // User is logged in — try to link the ATProto account
                const linkingEnabled =
                  ctx.context.options.account?.accountLinking?.enabled !== false;

                if (!linkingEnabled) {
                  throw APIError.from("FORBIDDEN", ATPROTO_ERROR_CODES.ACCOUNT_LINKING_DISABLED);
                }

                await ctx.context.internalAdapter.linkAccount({
                  userId: currentSession.user.id,
                  providerId: "atproto",
                  accountId: did,
                  accessToken: "atproto-session",
                  refreshToken: "atproto-session",
                  scope: normalizeScope(options.scope),
                });

                userId = currentSession.user.id;

                // Update profile fields on the existing user
                await ctx.context.internalAdapter.updateUser(userId, {
                  atprotoDid: did,
                  atprotoHandle: profile.handle,
                  ...(mappedFields.image ? { image: mappedFields.image } : {}),
                });
              } else {
                // 3. No existing account, no current session — create new user
                if (options.disableSignUp) {
                  throw APIError.from("FORBIDDEN", ATPROTO_ERROR_CODES.SIGNUP_DISABLED);
                }

                const newUser = await ctx.context.internalAdapter.createUser({
                  name: mappedFields.name || profile.handle,
                  email,
                  emailVerified: false,
                  image: mappedFields.image || null,
                  atprotoDid: did,
                  atprotoHandle: profile.handle,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });

                await ctx.context.internalAdapter.createAccount({
                  userId: newUser.id,
                  providerId: "atproto",
                  accountId: did,
                  accessToken: "atproto-session",
                  refreshToken: "atproto-session",
                  scope: normalizeScope(options.scope),
                });

                userId = newUser.id;
              }
            }

            // ── Update atprotoSession with user info ──

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
                  handle: profile.handle,
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
                  handle: profile.handle,
                  pdsUrl,
                  updatedAt: new Date(),
                },
              });
            }

            // ── Create better-auth session ──

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
            // Re-throw redirects and API responses
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

      // ── Get session (returns ATProto info for the current user) ──

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

        // Include profile fields from the user record
        // oxlint-disable-next-line no-unsafe-type-assertion -- plugin schema extends user
        const user = currentSession.user as Record<string, unknown>;

        return ctx.json({
          did: atprotoSession.did,
          handle: atprotoSession.handle,
          pdsUrl: atprotoSession.pdsUrl,
          atprotoDid: getString(user, "atprotoDid") ?? null,
          atprotoHandle: getString(user, "atprotoHandle") ?? null,
        });
      }),

      // ── Restore (lightweight session check without full profile fetch) ──

      atprotoRestore: createAuthEndpoint("/atproto/restore", { method: "POST" }, async (ctx) => {
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
          where: [{ field: "userId", value: currentSession.user.id }],
        });

        if (!atprotoSession) {
          return ctx.json({ active: false });
        }

        // Try to restore the OAuth session (token refresh if needed)
        try {
          const validDid = toDid(atprotoSession.did);
          if (!validDid) return ctx.json({ active: false });
          await oauthClient.restore(validDid);
          return ctx.json({
            active: true,
            did: atprotoSession.did,
            handle: atprotoSession.handle,
          });
        } catch {
          return ctx.json({ active: false });
        }
      }),

      // ── Sign out (revoke ATProto session) ──

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
            const validDid = toDid(atprotoSession.did);
            if (validDid) await oauthClient.revoke(validDid);
          } catch {
            // Best effort revocation
          }
        }

        return ctx.json({ success: true });
      }),

      // ── Server-only: get authenticated XRPC client ──
      // Path-less endpoint — only callable via auth.api.getAtprotoClient(),
      // not exposed over HTTP, not inferred as a client action.

      getAtprotoClient: createAuthEndpoint(
        {
          method: "POST",
          body: z.object({
            did: z.string().optional(),
            userId: z.string().optional(),
          }),
          metadata: { SERVER_ONLY: true as const },
        },
        async (ctx) => {
          const { did: inputDid, userId } = ctx.body;

          let did: string | undefined = inputDid;

          if (!did && userId) {
            const atprotoSession = await ctx.context.adapter.findOne<{ did: string }>({
              model: "atprotoSession",
              where: [{ field: "userId", value: userId }],
            });
            if (atprotoSession) {
              did = atprotoSession.did;
            }
          }

          if (!did) {
            throw APIError.from("BAD_REQUEST", ATPROTO_ERROR_CODES.SESSION_NOT_FOUND);
          }

          const validDid = toDid(did);
          if (!validDid) {
            throw APIError.from("BAD_REQUEST", ATPROTO_ERROR_CODES.INVALID_HANDLE);
          }

          const oauthSession = await oauthClient.restore(validDid);
          const client = new Client({ handler: oauthSession });

          return { client, session: oauthSession };
        },
      ),
    },

    $ERROR_CODES: ATPROTO_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};
