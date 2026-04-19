import { describe, it, expect, vi } from "vitest";
import { atproto, fetchAtprotoProfilePublic, atprotoPlaceholderEmail } from "./server.js";

describe("atproto plugin factory", () => {
  const baseOptions = {
    clientName: "Test App",
    clientUri: "https://example.com",
  };

  it("returns a plugin with id 'atproto'", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.id).toBe("atproto");
  });

  it("includes the database schema with user extensions", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.schema).toBeDefined();
    expect(plugin.schema).toHaveProperty("user");
    expect(plugin.schema).toHaveProperty("atprotoSession");
    expect(plugin.schema).toHaveProperty("atprotoState");

    // Verify user schema has atprotoDid and atprotoHandle
    expect(plugin.schema.user.fields).toHaveProperty("atprotoDid");
    expect(plugin.schema.user.fields.atprotoDid.unique).toBe(true);
    expect(plugin.schema.user.fields.atprotoDid.required).toBe(false);
    expect(plugin.schema.user.fields).toHaveProperty("atprotoHandle");
    expect(plugin.schema.user.fields.atprotoHandle.required).toBe(false);
  });

  it("exposes error codes including new ones", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.$ERROR_CODES).toEqual({
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
    });
  });

  it("has an init function", () => {
    const plugin = atproto(baseOptions);
    expect(typeof plugin.init).toBe("function");
  });

  it("defines all expected endpoints including new ones", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.endpoints).toHaveProperty("atprotoClientMetadata");
    expect(plugin.endpoints).toHaveProperty("atprotoJwks");
    expect(plugin.endpoints).toHaveProperty("signInAtproto");
    expect(plugin.endpoints).toHaveProperty("atprotoCallback");
    expect(plugin.endpoints).toHaveProperty("atprotoGetSession");
    expect(plugin.endpoints).toHaveProperty("atprotoRestore");
    expect(plugin.endpoints).toHaveProperty("atprotoSignOut");
    expect(plugin.endpoints).toHaveProperty("getAtprotoClient");
  });

  describe("rate limiting", () => {
    it("has rate limit rules for sign-in and callback", () => {
      const plugin = atproto(baseOptions);
      expect(plugin.rateLimit).toBeDefined();
      expect(plugin.rateLimit).toHaveLength(2);

      // Sign-in rate limit: 5 per 60s
      const signInRule = plugin.rateLimit[0]!;
      expect(signInRule.window).toBe(60);
      expect(signInRule.max).toBe(5);
      expect(signInRule.pathMatcher("/sign-in/atproto")).toBe(true);
      expect(signInRule.pathMatcher("/other")).toBe(false);

      // Callback rate limit: 10 per 60s
      const callbackRule = plugin.rateLimit[1]!;
      expect(callbackRule.window).toBe(60);
      expect(callbackRule.max).toBe(10);
      expect(callbackRule.pathMatcher("/atproto/callback")).toBe(true);
      expect(callbackRule.pathMatcher("/other")).toBe(false);
    });

    it("rate limit paths match custom path options", () => {
      const plugin = atproto({
        ...baseOptions,
        signInPath: "/custom/sign-in",
        callbackPath: "/custom/callback",
      });

      expect(plugin.rateLimit[0]!.pathMatcher("/custom/sign-in")).toBe(true);
      expect(plugin.rateLimit[0]!.pathMatcher("/sign-in/atproto")).toBe(false);

      expect(plugin.rateLimit[1]!.pathMatcher("/custom/callback")).toBe(true);
      expect(plugin.rateLimit[1]!.pathMatcher("/atproto/callback")).toBe(false);
    });
  });

  describe("disableSignUp option", () => {
    it("accepts disableSignUp option", () => {
      const plugin = atproto({ ...baseOptions, disableSignUp: true });
      expect(plugin).toBeDefined();
      expect(plugin.id).toBe("atproto");
    });
  });

  describe("mapProfileToUser option", () => {
    it("accepts mapProfileToUser callback", () => {
      const plugin = atproto({
        ...baseOptions,
        mapProfileToUser: (profile) => ({
          name: profile.displayName ?? profile.handle,
          image: profile.avatar,
        }),
      });
      expect(plugin).toBeDefined();
      expect(plugin.id).toBe("atproto");
    });
  });

  describe("plugin initialization", () => {
    it("initializes without error for loopback URL (public client)", () => {
      const plugin = atproto(baseOptions);
      const mockAdapter = {
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      };

      expect(() =>
        plugin.init({
          baseURL: "http://localhost:3000/api/auth",
          adapter: mockAdapter,
        }),
      ).not.toThrow();
    });

    it("initializes without error for 127.0.0.1 URL (public client)", () => {
      const plugin = atproto(baseOptions);
      const mockAdapter = {
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      };

      expect(() =>
        plugin.init({
          baseURL: "http://127.0.0.1:3000/api/auth",
          adapter: mockAdapter,
        }),
      ).not.toThrow();
    });

    it("warns when keyset is provided with loopback URL", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const plugin = atproto({
        ...baseOptions,
        // oxlint-disable-next-line no-unsafe-type-assertion -- test mock keyset
        keyset: [{ kty: "EC", crv: "P-256", kid: "k1", alg: "ES256" } as any],
      });
      const mockAdapter = {
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      };

      plugin.init({
        baseURL: "http://localhost:3000/api/auth",
        adapter: mockAdapter,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("keyset provided but baseURL is loopback"),
      );
      warnSpy.mockRestore();
    });

    it("initializes without error for HTTPS URL (confidential client)", () => {
      const plugin = atproto({
        ...baseOptions,
        // oxlint-disable-next-line no-unsafe-type-assertion -- test mock keyset
        keyset: [{ kty: "EC", crv: "P-256", kid: "k1", alg: "ES256" } as any],
      });
      const mockAdapter = {
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      };

      expect(() =>
        plugin.init({
          baseURL: "https://example.com/api/auth",
          adapter: mockAdapter,
        }),
      ).not.toThrow();
    });

    it("initializes as public client for HTTPS URL without keyset", () => {
      const plugin = atproto(baseOptions);
      const mockAdapter = {
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      };

      expect(() =>
        plugin.init({
          baseURL: "https://example.com/api/auth",
          adapter: mockAdapter,
        }),
      ).not.toThrow();
    });
  });

  describe("custom path options", () => {
    it("accepts custom path configuration", () => {
      const plugin = atproto({
        ...baseOptions,
        clientMetadataPath: "/custom/metadata.json",
        jwksPath: "/custom/jwks.json",
        callbackPath: "/custom/callback",
        signInPath: "/custom/sign-in",
      });

      // Plugin should still create successfully
      expect(plugin.id).toBe("atproto");
      expect(plugin.endpoints).toBeDefined();
    });
  });

  describe("scope configuration", () => {
    it("uses default scope when not specified", () => {
      const plugin = atproto(baseOptions);
      expect(plugin).toBeDefined();
    });

    it("accepts a custom scope string", () => {
      const plugin = atproto({
        ...baseOptions,
        scope: "atproto transition:generic transition:chat.bsky",
      });
      expect(plugin).toBeDefined();
    });

    it("accepts scope as an array of strings", () => {
      const plugin = atproto({
        ...baseOptions,
        scope: ["atproto", "rpc?lxm=app.bsky.actor.getProfile&aud=*"],
      });
      expect(plugin).toBeDefined();
    });

    it("accepts scope array without explicit 'atproto' (auto-prepended)", () => {
      const plugin = atproto({
        ...baseOptions,
        scope: ["rpc?lxm=app.bsky.actor.getProfile&aud=*"],
      });
      expect(plugin).toBeDefined();
    });
  });
});

describe("atprotoPlaceholderEmail", () => {
  it("generates a deterministic placeholder email from a DID", () => {
    const email = atprotoPlaceholderEmail("did:plc:abc123");
    expect(email).toBe("did_plc_abc123@atproto.invalid");
  });

  it("uses the .invalid TLD", () => {
    const email = atprotoPlaceholderEmail("did:web:example.com");
    expect(email).toMatch(/@atproto\.invalid$/);
  });

  it("replaces all colons with underscores", () => {
    const email = atprotoPlaceholderEmail("did:plc:xyz789");
    expect(email).not.toContain(":");
    expect(email).toBe("did_plc_xyz789@atproto.invalid");
  });
});

describe("fetchAtprotoProfilePublic", () => {
  it("is a function", () => {
    expect(typeof fetchAtprotoProfilePublic).toBe("function");
  });

  it("returns null on network error", async () => {
    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    // oxlint-disable-next-line no-unsafe-type-assertion -- test mock
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    const result = await fetchAtprotoProfilePublic("did:plc:abc123");
    expect(result).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it("returns null on non-OK response", async () => {
    const originalFetch = globalThis.fetch;
    // oxlint-disable-next-line no-unsafe-type-assertion -- test mock
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    const result = await fetchAtprotoProfilePublic("did:plc:abc123");
    expect(result).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it("returns profile data on successful response", async () => {
    const originalFetch = globalThis.fetch;
    // oxlint-disable-next-line no-unsafe-type-assertion -- test mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          did: "did:plc:abc123",
          handle: "user.bsky.social",
          displayName: "Test User",
          avatar: "https://example.com/avatar.jpg",
          description: "Hello world",
        }),
    }) as unknown as typeof fetch;

    const result = await fetchAtprotoProfilePublic("did:plc:abc123");
    expect(result).toEqual({
      did: "did:plc:abc123",
      handle: "user.bsky.social",
      displayName: "Test User",
      avatar: "https://example.com/avatar.jpg",
      banner: undefined,
      description: "Hello world",
    });

    globalThis.fetch = originalFetch;
  });
});
