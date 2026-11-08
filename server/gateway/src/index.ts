import { readConfig } from "./config.ts";
import { createGateway } from "./gateway.ts";

export { type GatewayConfig, type GatewayRuntime, readConfig } from "./config.ts";
export { createGateway, type GatewayOptions, type Route, route } from "./gateway.ts";

/** Starts the gateway on $PORT (default 2570), and stops listening on SIGTERM so Railway can restart it. */
export function startGateway(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  const server = createGateway(config);
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "gateway listening",
        port: config.port,
        env: config.env,
        games: config.games,
      }),
    );
  });
  process.once("SIGTERM", () => {
    console.log(JSON.stringify({ level: "info", msg: "gateway restarting" }));
    server.close();
    server.closeIdleConnections();
    // Open WebSockets would keep the server alive for good; players reconnect to the new instance.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
  return server;
}
