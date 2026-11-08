/**
 * Client-side core: connection, interpolation, prediction, debug overlay, console, bug reports.
 * Owner: platform team. Renderer-independent: nothing here knows how a game draws.
 *
 * Contents: URL parameters and invite links, per-second meters, the ~ debug overlay with its
 * console, network stats and state inspector, the F8 bug report, network simulation, interpolation
 * buffer, prediction with reconciliation, and the guest ID (getGuestId). The template client (server/template/client) uses all of it.
 */
export * from "./bugReport.ts";
export * from "./debugConsole.ts";
export * from "./debugOverlay.ts";
export * from "./guestId.ts";
export * from "./interpolation.ts";
export * from "./netSim.ts";
export * from "./netStats.ts";
export * from "./prediction.ts";
export * from "./rate.ts";
export * from "./stateInspector.ts";
export * from "./urlParams.ts";
