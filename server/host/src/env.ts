import { type AppEnv, AppEnvSchema, parseDebugTools } from "@kit/core/shared";

/** Runtime environment, read once at startup. Railway provides RAILWAY_GIT_COMMIT_SHA on deploys. */
export const APP_ENV: AppEnv = AppEnvSchema.catch("local").parse(process.env.APP_ENV);
/** DEBUG_TOOLS=on turns the debug tools on even in production. APP_ENV stays truthful. */
export const DEBUG_TOOLS: boolean = parseDebugTools(process.env.DEBUG_TOOLS);
export const GIT_SHA: string = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "dev";
export const PORT: number = Number(process.env.PORT ?? 2567);
export const STARTED_AT: string = new Date().toISOString();
