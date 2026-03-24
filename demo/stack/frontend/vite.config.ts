import { defineConfig } from "vite";

const frontendPort = Number(process.env.FRONTEND_PORT ?? "3000");

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: frontendPort,
    strictPort: true,
    allowedHosts: true,
  },
});
