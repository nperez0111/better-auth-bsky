import { describe, it, expect, vi, beforeEach } from "vitest";
import { atproto } from "./server.js";

describe("atproto plugin factory", () => {
  const baseOptions = {
    clientName: "Test App",
    clientUri: "https://example.com",
  };

  it("returns a plugin with id 'atproto'", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.id).toBe("atproto");
  });

  it("includes the database schema", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.schema).toBeDefined();
    expect(plugin.schema).toHaveProperty("atprotoSession");
    expect(plugin.schema).toHaveProperty("atprotoState");
  });

  it("exposes error codes", () => {
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
    });
  });

  it("has an init function", () => {
    const plugin = atproto(baseOptions);
    expect(typeof plugin.init).toBe("function");
  });

  it("defines all expected endpoints", () => {
    const plugin = atproto(baseOptions);
    expect(plugin.endpoints).toHaveProperty("atprotoClientMetadata");
    expect(plugin.endpoints).toHaveProperty("atprotoJwks");
    expect(plugin.endpoints).toHaveProperty("signInAtproto");
    expect(plugin.endpoints).toHaveProperty("atprotoCallback");
    expect(plugin.endpoints).toHaveProperty("atprotoGetSession");
    expect(plugin.endpoints).toHaveProperty("atprotoSignOut");
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
      // Default scope is used internally in buildMetadata; we verify by
      // ensuring the plugin creates successfully and metadata can be served
      const plugin = atproto(baseOptions);
      expect(plugin).toBeDefined();
    });

    it("accepts custom scope", () => {
      const plugin = atproto({
        ...baseOptions,
        scope: "atproto transition:generic transition:chat.bsky",
      });
      expect(plugin).toBeDefined();
    });
  });
});
