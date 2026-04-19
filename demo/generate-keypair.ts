/**
 * Generates an ES256 keypair for ATProto confidential client authentication.
 * The private key is written to atproto-key.json (gitignored).
 *
 * Usage: bun run demo/generate-keypair.ts
 */
import { existsSync } from "node:fs";
import { generateAtprotoKeypair } from "../src/index.js";

const KEY_PATH = "atproto-key.json";

if (existsSync(KEY_PATH)) {
  console.log(`${KEY_PATH} already exists — delete it first if you want to regenerate.`);
  process.exit(0);
}

const key = await generateAtprotoKeypair("notation");
await Bun.write(KEY_PATH, JSON.stringify(key, null, 2) + "\n");
console.log(`Wrote private key to ${KEY_PATH}`);
console.log("Keep this file secret — do not commit it to version control.");
