#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.CADENCE_APP_HOST ?? "127.0.0.1";
const portText = process.env.CADENCE_APP_PORT ?? "3186";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("CRM preview requires a loopback host.");
if (!/^\d+$/.test(portText) || Number(portText) < 3110 || Number(portText) > 3199) throw new Error("CRM preview port must be 3110–3199.");
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  envDir: false,
  envPrefix: "CRM_PREVIEW_PUBLIC_",
  publicDir: false,
  plugins: [react(), {
    name: "offline-preview",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (/^\/(api|__platform)(\/|\?|$)/.test(req.url ?? "")) {
          res.statusCode = 403;
          res.end("Synthetic CRM preview: live APIs are unavailable.");
        } else next();
      });
    },
  }],
  server: { host, port: Number(portText), strictPort: true, fs: { strict: true } },
});
await server.listen();
const address = server.httpServer.address();
console.log(`CRM · SYNTHETIC READ-ONLY FIXTURES · http://${host === "::1" ? "[::1]" : host}:${address.port}/dev/preview/`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await server.close();
  process.exit(0);
});
