import { createServer, IncomingMessage, ServerResponse } from "node:http";

const port = Number(process.env.PORT ?? "8000");

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method !== "GET") {
    writeJson(res, 405, { error: "method not allowed" });
    return;
  }

  if (url !== "/" && url !== "/healthz") {
    writeJson(res, 404, { error: "not found" });
    return;
  }

  writeJson(res, 200, {
    service: "api",
    utc_time: new Date().toISOString(),
    db: {
      host: process.env.DB_HOST ?? "postgres",
      port: Number(process.env.DB_PORT ?? "5432"),
      name: process.env.DB_NAME ?? "app",
      user: process.env.DB_USER ?? "app",
    },
  });
}

createServer(handler).listen(port, "0.0.0.0", () => {
  console.log(`api listening on ${port}`);
});
