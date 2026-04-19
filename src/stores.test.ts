import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoredSession, StoredState } from "@atcute/oauth-node-client";
import { DbSessionStore, DbStateStore, type DbAdapter } from "./stores.js";

function createMockAdapter(): DbAdapter {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(0),
  };
}

// oxlint-disable-next-line no-unsafe-type-assertion -- test DID literal
const TEST_DID = "did:plc:abc123" as `did:${string}:${string}`;

// oxlint-disable-next-line no-unsafe-type-assertion -- test fixture
const TEST_SESSION: StoredSession = {
  dpopKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" },
  tokenSet: {
    access_token: "access-token",
    token_type: "DPoP",
    expires_at: Date.now() + 60_000,
    sub: TEST_DID,
    iss: "https://bsky.social",
    scope: "atproto transition:generic",
    refresh_token: "refresh-token",
  },
} as unknown as StoredSession;

describe("DbSessionStore", () => {
  let adapter: DbAdapter;
  let store: DbSessionStore;

  beforeEach(() => {
    adapter = createMockAdapter();
    store = new DbSessionStore(adapter);
  });

  describe("get", () => {
    it("returns undefined when session does not exist", async () => {
      const result = await store.get(TEST_DID);
      expect(result).toBeUndefined();
      expect(adapter.findOne).toHaveBeenCalledWith({
        model: "atprotoSession",
        where: [{ field: "did", value: TEST_DID }],
      });
    });

    it("returns parsed session when found", async () => {
      vi.mocked(adapter.findOne).mockResolvedValueOnce({
        sessionData: JSON.stringify(TEST_SESSION),
      });

      const result = await store.get(TEST_DID);
      expect(result).toEqual(TEST_SESSION);
    });
  });

  describe("set", () => {
    it("creates a new session when none exists", async () => {
      vi.mocked(adapter.findOne).mockResolvedValueOnce(null);
      await store.set(TEST_DID, TEST_SESSION);

      expect(adapter.create).toHaveBeenCalledWith({
        model: "atprotoSession",
        data: expect.objectContaining({
          did: TEST_DID,
          sessionData: JSON.stringify(TEST_SESSION),
          userId: "",
          handle: "",
          pdsUrl: "",
        }),
      });
    });

    it("updates an existing session", async () => {
      vi.mocked(adapter.findOne).mockResolvedValueOnce({ id: "existing-id" });
      await store.set(TEST_DID, TEST_SESSION);

      expect(adapter.update).toHaveBeenCalledWith({
        model: "atprotoSession",
        where: [{ field: "did", value: TEST_DID }],
        update: expect.objectContaining({
          sessionData: JSON.stringify(TEST_SESSION),
        }),
      });
      expect(adapter.create).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes the session by DID", async () => {
      await store.delete(TEST_DID);
      expect(adapter.delete).toHaveBeenCalledWith({
        model: "atprotoSession",
        where: [{ field: "did", value: TEST_DID }],
      });
    });
  });

  describe("clear", () => {
    it("deletes all sessions", async () => {
      await store.clear();
      expect(adapter.deleteMany).toHaveBeenCalledWith({
        model: "atprotoSession",
        where: [{ field: "did", value: { operator: "ne", value: "" } }],
      });
    });
  });
});

describe("DbStateStore", () => {
  let adapter: DbAdapter;
  let store: DbStateStore;

  // oxlint-disable-next-line no-unsafe-type-assertion -- test fixture
  const TEST_STATE: StoredState = {
    dpopKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" },
    expiresAt: Date.now() + 60_000,
    verifier: "test-verifier",
    issuer: "https://bsky.social",
  } as unknown as StoredState;

  beforeEach(() => {
    adapter = createMockAdapter();
    store = new DbStateStore(adapter);
  });

  describe("get", () => {
    it("returns undefined when state does not exist", async () => {
      const result = await store.get("test-key");
      expect(result).toBeUndefined();
      expect(adapter.findOne).toHaveBeenCalledWith({
        model: "atprotoState",
        where: [{ field: "stateKey", value: "test-key" }],
      });
    });

    it("returns parsed state when found and not expired", async () => {
      const futureState = { ...TEST_STATE, expiresAt: Date.now() + 60_000 };
      vi.mocked(adapter.findOne).mockResolvedValueOnce({
        stateData: JSON.stringify(futureState),
        expiresAt: futureState.expiresAt,
      });

      const result = await store.get("test-key");
      expect(result).toEqual(futureState);
    });

    it("returns undefined and cleans up when state is expired", async () => {
      const expiredState = { ...TEST_STATE, expiresAt: Date.now() - 1000 };
      vi.mocked(adapter.findOne).mockResolvedValueOnce({
        stateData: JSON.stringify(expiredState),
        expiresAt: expiredState.expiresAt,
      });

      const result = await store.get("test-key");
      expect(result).toBeUndefined();
      expect(adapter.delete).toHaveBeenCalledWith({
        model: "atprotoState",
        where: [{ field: "stateKey", value: "test-key" }],
      });
    });
  });

  describe("set", () => {
    it("creates a new state entry", async () => {
      await store.set("test-key", TEST_STATE);
      expect(adapter.create).toHaveBeenCalledWith({
        model: "atprotoState",
        data: {
          stateKey: "test-key",
          stateData: JSON.stringify(TEST_STATE),
          expiresAt: TEST_STATE.expiresAt,
        },
      });
    });
  });

  describe("delete", () => {
    it("deletes state by key", async () => {
      await store.delete("test-key");
      expect(adapter.delete).toHaveBeenCalledWith({
        model: "atprotoState",
        where: [{ field: "stateKey", value: "test-key" }],
      });
    });
  });

  describe("clear", () => {
    it("deletes all state entries", async () => {
      await store.clear();
      expect(adapter.deleteMany).toHaveBeenCalledWith({
        model: "atprotoState",
        where: [{ field: "stateKey", value: { operator: "ne", value: "" } }],
      });
    });
  });
});
