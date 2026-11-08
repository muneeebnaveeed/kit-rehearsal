/** `pnpm gen:api`: writes server/docs/generated/api.schema.json from the zod contract. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API_SCHEMA_PATH, buildApiSchema } from "../shared/apiSchema.ts";

const target = fileURLToPath(new URL(API_SCHEMA_PATH, new URL("../shared/apiSchema.ts", import.meta.url)));
writeFileSync(target, `${JSON.stringify(buildApiSchema(), null, 2)}\n`);
console.log(`wrote ${target}`);
