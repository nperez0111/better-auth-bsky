import type { Did } from "@atcute/lexicons";
import type {
  SessionStore,
  StateStore,
  StoredSession,
  StoredState,
} from "@atcute/oauth-node-client";

/**
 * A generic better-auth adapter interface matching the subset we need.
 * This avoids importing better-auth's full type tree.
 */
export interface DbAdapter {
  findOne: <T>(data: {
    model: string;
    where: { field: string; value: unknown }[];
  }) => Promise<T | null>;
  create: <T>(data: { model: string; data: Record<string, unknown> }) => Promise<T>;
  update: <T>(data: {
    model: string;
    where: { field: string; value: unknown }[];
    update: Record<string, unknown>;
  }) => Promise<T | null>;
  delete: (data: { model: string; where: { field: string; value: unknown }[] }) => Promise<void>;
  deleteMany: (data: {
    model: string;
    where: { field: string; value: unknown }[];
  }) => Promise<number>;
}

/** Database-backed session store for @atcute/oauth-node-client. */
export class DbSessionStore implements SessionStore {
  constructor(private adapter: DbAdapter) {}

  async get(did: Did): Promise<StoredSession | undefined> {
    const row = await this.adapter.findOne<{
      sessionData: string;
    }>({
      model: "atprotoSession",
      where: [{ field: "did", value: did }],
    });
    if (!row) return undefined;
    return JSON.parse(row.sessionData) as StoredSession;
  }

  async set(did: Did, session: StoredSession): Promise<void> {
    const data = JSON.stringify(session);
    const existing = await this.adapter.findOne<{ id: string }>({
      model: "atprotoSession",
      where: [{ field: "did", value: did }],
    });
    if (existing) {
      await this.adapter.update({
        model: "atprotoSession",
        where: [{ field: "did", value: did }],
        update: { sessionData: data, updatedAt: new Date() },
      });
    } else {
      await this.adapter.create({
        model: "atprotoSession",
        data: {
          did,
          sessionData: data,
          userId: "",
          handle: "",
          pdsUrl: "",
          updatedAt: new Date(),
        },
      });
    }
  }

  async delete(did: Did): Promise<void> {
    await this.adapter.delete({
      model: "atprotoSession",
      where: [{ field: "did", value: did }],
    });
  }

  async clear(): Promise<void> {
    // Delete all — use a wildcard-like approach by deleting where id exists
    await this.adapter.deleteMany({
      model: "atprotoSession",
      where: [{ field: "did", value: { operator: "ne", value: "" } }],
    });
  }
}

/** Database-backed state store for @atcute/oauth-node-client. */
export class DbStateStore implements StateStore {
  constructor(private adapter: DbAdapter) {}

  async get(stateKey: string): Promise<StoredState | undefined> {
    const row = await this.adapter.findOne<{
      stateData: string;
      expiresAt: number;
    }>({
      model: "atprotoState",
      where: [{ field: "stateKey", value: stateKey }],
    });
    if (!row) return undefined;
    if (row.expiresAt < Date.now()) {
      // Expired — clean it up
      await this.delete(stateKey);
      return undefined;
    }
    return JSON.parse(row.stateData) as StoredState;
  }

  async set(stateKey: string, state: StoredState): Promise<void> {
    const data = JSON.stringify(state);
    await this.adapter.create({
      model: "atprotoState",
      data: {
        stateKey,
        stateData: data,
        expiresAt: state.expiresAt,
      },
    });
  }

  async delete(stateKey: string): Promise<void> {
    await this.adapter.delete({
      model: "atprotoState",
      where: [{ field: "stateKey", value: stateKey }],
    });
  }

  async clear(): Promise<void> {
    await this.adapter.deleteMany({
      model: "atprotoState",
      where: [{ field: "stateKey", value: { operator: "ne", value: "" } }],
    });
  }
}
