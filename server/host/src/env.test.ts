import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts reads process.env once when it loads, so each case imports a fresh copy.
async function load(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  return import("./env.ts");
}

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("leaves DEBUG_TOOLS off by default, in production too", async () => {
    expect(await load({ APP_ENV: "production", DEBUG_TOOLS: undefined })).toMatchObject({
      APP_ENV: "production",
      DEBUG_TOOLS: false,
    });
  });

  it("turns DEBUG_TOOLS on with DEBUG_TOOLS=on and keeps APP_ENV", async () => {
    expect(await load({ APP_ENV: "production", DEBUG_TOOLS: "on" })).toMatchObject({
      APP_ENV: "production",
      DEBUG_TOOLS: true,
    });
  });
});
