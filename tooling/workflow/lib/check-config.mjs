// Each game's tuning file (config/game.json) must match the zod schema its shared/index.ts exports
// under a name ending in "ConfigSchema" (e.g. SampleConfigSchema). Pure: the caller loads the module.

/** @param {unknown} value */
const isSchema = (value) =>
  typeof value === "object" && value !== null && typeof value.safeParse === "function";

/**
 * @param {{ configFile: string, sharedFile: string, shared: Record<string, unknown>, json: string }} input
 */
export function checkGameConfig({ configFile, sharedFile, shared, json }) {
  const schemas = Object.entries(shared).filter(([name, v]) => name.endsWith("ConfigSchema") && isSchema(v));
  if (schemas.length !== 1) {
    return [
      {
        rule: "schema",
        file: sharedFile,
        message: `Expected exactly one exported *ConfigSchema, found ${schemas.length}.`,
        fix: "Export one zod schema named like GameConfigSchema.",
      },
    ];
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return [{ rule: "json", file: configFile, message: `Invalid JSON: ${err.message}` }];
  }
  const [name, schema] = schemas[0];
  const parsed = schema.safeParse(data);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    rule: "config",
    file: configFile,
    message: `${issue.path.join(".") || "(root)"}: ${issue.message} (${name}).`,
  }));
}
