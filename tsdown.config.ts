import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "neutral",
  deps: {
    neverBundle: [/^better-auth/, /^better-call/, /^@better-fetch\//, /^@atcute\//],
    onlyBundle: ["valibot"],
  },
});
