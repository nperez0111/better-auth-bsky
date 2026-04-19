import { describe, it, expect } from "vitest";
import { atprotoSchema } from "./types.js";

describe("atprotoSchema", () => {
  it("defines the atprotoSession table", () => {
    expect(atprotoSchema).toHaveProperty("atprotoSession");
    expect(atprotoSchema.atprotoSession).toHaveProperty("fields");
  });

  it("defines the atprotoState table", () => {
    expect(atprotoSchema).toHaveProperty("atprotoState");
    expect(atprotoSchema.atprotoState).toHaveProperty("fields");
  });

  describe("atprotoSession fields", () => {
    const fields = atprotoSchema.atprotoSession.fields;

    it("has a unique, required 'did' field of type string", () => {
      expect(fields.did).toEqual({
        type: "string",
        unique: true,
        required: true,
      });
    });

    it("has a required 'sessionData' field of type string", () => {
      expect(fields.sessionData).toEqual({
        type: "string",
        required: true,
      });
    });

    it("has a required 'userId' field that references the user table", () => {
      expect(fields.userId.type).toBe("string");
      expect(fields.userId.required).toBe(true);
      expect(fields.userId.references).toEqual({
        model: "user",
        field: "id",
        onDelete: "cascade",
      });
    });

    it("has a required 'handle' field of type string", () => {
      expect(fields.handle).toEqual({
        type: "string",
        required: true,
      });
    });

    it("has a required 'pdsUrl' field of type string", () => {
      expect(fields.pdsUrl).toEqual({
        type: "string",
        required: true,
      });
    });

    it("has a required 'updatedAt' field of type date", () => {
      expect(fields.updatedAt).toEqual({
        type: "date",
        required: true,
      });
    });
  });

  describe("atprotoState fields", () => {
    const fields = atprotoSchema.atprotoState.fields;

    it("has a unique, required 'stateKey' field of type string", () => {
      expect(fields.stateKey).toEqual({
        type: "string",
        unique: true,
        required: true,
      });
    });

    it("has a required 'stateData' field of type string", () => {
      expect(fields.stateData).toEqual({
        type: "string",
        required: true,
      });
    });

    it("has a required 'expiresAt' field of type number", () => {
      expect(fields.expiresAt).toEqual({
        type: "number",
        required: true,
      });
    });
  });
});
