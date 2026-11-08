/**
 * The client contract as JSON Schema, generated from the zod schemas in this folder: HTTP routes,
 * WebSocket messages and the replay format. For agents and tools outside TypeScript; TypeScript
 * clients import the zod schemas directly.
 *
 * Written to server/docs/generated/api.schema.json by `pnpm gen:api`. A test fails when the
 * committed file is out of date. Not exported from the shared index, so clients don't bundle it.
 */
import { z } from "zod";
import { HealthResponseSchema } from "./env.ts";
import {
  BugReportCreatedSchema,
  BugReportSchema,
  DebugCommandSchema,
  DebugResultSchema,
  DebugStatsSchema,
  InputEnvelopeSchema,
  JoinByCodeRequestSchema,
  JoinByCodeResponseSchema,
  NoticeSchema,
} from "./messages.ts";
import { ReplaySchema } from "./replay.ts";

/** Where the generated file lives, relative to this module. */
export const API_SCHEMA_PATH = "../../../docs/generated/api.schema.json";

/** A JSON Schema object, as z.toJSONSchema returns it for a single schema. */
type JsonSchema = { [key: string]: unknown; required?: string[] };

interface Route {
  summary: string;
  request?: JsonSchema;
  responses: Record<string, JsonSchema>;
}

export interface ApiSchema {
  $schema: string;
  title: string;
  description: string;
  http: Record<string, Route>;
  messages: {
    clientToServer: Record<string, JsonSchema>;
    serverToClient: Record<string, JsonSchema>;
  };
  replay: JsonSchema;
}

/** What a client sends: defaults are optional. */
const request = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
/** What the server returns: defaults are filled in. */
const response = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "output" }) as JsonSchema;

const ErrorSchema = z.object({ error: z.string() });
const StoredBugReportSchema = z.object({
  id: z.uuid(),
  receivedAt: z.string(),
  report: BugReportSchema,
  replay: ReplaySchema.nullable(),
});

export function buildApiSchema(): ApiSchema {
  const error = response(ErrorSchema);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Hackathon client contract",
    description:
      "Generated from the zod schemas in server/core/src/shared by `pnpm gen:api`. Do not edit by hand. Guide: server/docs/CLIENT_GUIDE.md.",
    http: {
      "GET /health": {
        summary: "Env, commit SHA and start time",
        responses: { "200": response(HealthResponseSchema) },
      },
      "POST /api/rooms/join": {
        summary: "Turn a room code into a room id; then join with client.joinById(roomId)",
        request: request(JoinByCodeRequestSchema),
        responses: { "200": response(JoinByCodeResponseSchema), "400": error, "404": error, "409": error },
      },
      "GET /api/replays/:roomId": {
        summary: "Replay of a live or recently finished room, as a JSON download",
        responses: { "200": response(ReplaySchema), "404": error, "429": error },
      },
      "POST /api/bug-reports": {
        summary: "F8 bug report; the server keeps a copy of the room's replay",
        request: request(BugReportSchema),
        responses: { "201": response(BugReportCreatedSchema), "400": error, "413": error, "429": error },
      },
      "GET /api/bug-reports/:id": {
        summary: "A stored bug report with its replay",
        responses: { "200": response(StoredBugReportSchema), "404": error },
      },
    },
    messages: {
      clientToServer: {
        input: request(InputEnvelopeSchema),
        "debug:command": request(DebugCommandSchema),
      },
      serverToClient: {
        notice: response(NoticeSchema),
        "debug:result": response(DebugResultSchema),
        "debug:stats": response(DebugStatsSchema),
      },
    },
    replay: response(ReplaySchema),
  };
}
