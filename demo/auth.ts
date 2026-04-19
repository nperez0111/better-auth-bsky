import { existsSync } from "node:fs";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import Database from "bun:sqlite";
import { atproto } from "../src/index.js";

const db = new Database("demo.db");

const KEY_PATH = "atproto-key.json";
const keyset = existsSync(KEY_PATH) ? [await Bun.file(KEY_PATH).json()] : undefined;

if (keyset) {
  console.log("Loaded ATProto keypair — running as confidential client");
} else {
  console.log("No atproto-key.json found — running as public client (loopback)");
  console.log("Run: bun run demo/generate-keypair.ts to enable confidential mode");
}

export function createAuth(baseURL: string) {
  const options = {
    database: db,
    baseURL,
    basePath: "/api/auth",
    secret: "demo-secret-at-least-32-characters-long",
    plugins: [
      atproto({
        clientName: "ATProto Demo App",
        keyset,
      }),
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(options);
}
