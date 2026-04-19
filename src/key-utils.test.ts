import { describe, it, expect } from "vitest";
import { extractPublicJwk, generateAtprotoKeypair } from "./key-utils.js";

describe("key-utils", () => {
  it("generateAtprotoKeypair produces an ES256 private JWK", async () => {
    const jwk = await generateAtprotoKeypair("test-kid");
    const raw = jwk as unknown as Record<string, unknown>;
    expect(raw.kty).toBe("EC");
    expect(raw.crv).toBe("P-256");
    expect(raw.kid).toBe("test-kid");
    expect(raw.alg).toBe("ES256");
    expect(typeof raw.d).toBe("string");
  });

  it("extractPublicJwk strips private key fields", async () => {
    const priv = await generateAtprotoKeypair();
    const pub = extractPublicJwk(priv);
    expect(pub).not.toHaveProperty("d");
    expect(pub).not.toHaveProperty("p");
    expect(pub).not.toHaveProperty("q");
    expect(pub).toHaveProperty("x");
    expect(pub).toHaveProperty("y");
    expect(pub).toHaveProperty("kid");
  });
});
