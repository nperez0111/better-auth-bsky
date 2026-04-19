import { describe, it, expect, vi } from "vitest";
import { atprotoClient } from "./client.js";

describe("atprotoClient", () => {
  it("returns a plugin with id 'atproto'", () => {
    const plugin = atprotoClient();
    expect(plugin.id).toBe("atproto");
  });

  it("infers server plugin type", () => {
    const plugin = atprotoClient();
    expect(plugin).toHaveProperty("$InferServerPlugin");
  });

  it("provides getActions function", () => {
    const plugin = atprotoClient();
    expect(typeof plugin.getActions).toBe("function");
  });

  describe("getActions", () => {
    it("returns signIn.atproto action", () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn();
      const actions = plugin.getActions(mockFetch as any);

      expect(actions.signIn).toBeDefined();
      expect(typeof actions.signIn.atproto).toBe("function");
    });

    it("returns atproto.getSession action", () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn();
      const actions = plugin.getActions(mockFetch as any);

      expect(actions.atproto).toBeDefined();
      expect(typeof actions.atproto.getSession).toBe("function");
    });

    it("returns atproto.signOut action", () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn();
      const actions = plugin.getActions(mockFetch as any);

      expect(typeof actions.atproto.signOut).toBe("function");
    });

    it("signIn.atproto calls $fetch with correct path and method", async () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn().mockResolvedValue({ url: "https://bsky.social/auth" });
      const actions = plugin.getActions(mockFetch as any);

      await actions.signIn.atproto({
        handle: "user.bsky.social",
        callbackURL: "/dashboard",
      });

      expect(mockFetch).toHaveBeenCalledWith("/sign-in/atproto", {
        method: "POST",
        body: { handle: "user.bsky.social", callbackURL: "/dashboard" },
      });
    });

    it("signIn.atproto works without callbackURL", async () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn().mockResolvedValue({ url: "https://bsky.social/auth" });
      const actions = plugin.getActions(mockFetch as any);

      await actions.signIn.atproto({ handle: "user.bsky.social" });

      expect(mockFetch).toHaveBeenCalledWith("/sign-in/atproto", {
        method: "POST",
        body: { handle: "user.bsky.social" },
      });
    });

    it("atproto.getSession calls $fetch with correct path and method", async () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn().mockResolvedValue({
        did: "did:plc:abc123",
        handle: "user.bsky.social",
        pdsUrl: "https://bsky.network",
      });
      const actions = plugin.getActions(mockFetch as any);

      await actions.atproto.getSession();

      expect(mockFetch).toHaveBeenCalledWith("/atproto/session", {
        method: "GET",
      });
    });

    it("atproto.signOut calls $fetch with correct path and method", async () => {
      const plugin = atprotoClient();
      const mockFetch = vi.fn().mockResolvedValue({ success: true });
      const actions = plugin.getActions(mockFetch as any);

      await actions.atproto.signOut();

      expect(mockFetch).toHaveBeenCalledWith("/atproto/sign-out", {
        method: "POST",
      });
    });
  });
});
