import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_SCHEMA_PATH, buildApiSchema } from "./apiSchema.ts";

describe("generated API schema", () => {
  it("the committed api.schema.json matches the contract (run `pnpm gen:api` if this fails)", () => {
    const committed = JSON.parse(readFileSync(new URL(API_SCHEMA_PATH, import.meta.url), "utf8"));
    expect(committed).toEqual(buildApiSchema());
  });

  it("describes join by code, its errors and the input message", () => {
    const schema = buildApiSchema();
    const join = schema.http["POST /api/rooms/join"];
    expect(join?.request?.required).toEqual(["code"]);
    expect(Object.keys(join?.responses ?? {})).toEqual(["200", "400", "404", "409"]);
    expect(schema.messages.clientToServer.input?.required).toEqual(["seq", "data"]);
    expect(Object.keys(schema.messages.serverToClient).sort()).toEqual([
      "debug:result",
      "debug:stats",
      "notice",
    ]);
  });
});
