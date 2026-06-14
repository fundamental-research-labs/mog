#!/usr/bin/env node

// src/mcp/server.ts
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/protocol.ts
function bytesToBase64(bytes) {
  const maybeBuffer = globalThis.Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
function jsonSafe(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return bytesToBase64(value);
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry));
  if (typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (typeof child !== "function") {
        output[key] = jsonSafe(child);
      }
    }
    return output;
  }
  return String(value);
}

// src/mcp/server.ts
var sessions = /* @__PURE__ */ new Map();
var hostServer = null;
var hostPort = null;
var runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var browserRoot = resolve(runtimeRoot, "browser");
var pluginVersion = true ? "0.9.3" : "0.9.3";
var wasmPackageBaseUrl = true ? "https://cdn.jsdelivr.net/npm/@mog-sdk/wasm@0.9.3/" : `https://cdn.jsdelivr.net/npm/@mog-sdk/wasm@${pluginVersion}/`;
function randomToken() {
  return randomBytes(32).toString("base64url");
}
function jsonResponse(response, statusCode, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store"
  });
  response.end(bytes);
}
function textResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}
function notFound(response) {
  textResponse(response, 404, "Not found");
}
function unauthorized(response) {
  textResponse(response, 401, "Invalid Mog session token");
}
function getSession(response, sessionId, token) {
  if (!sessionId) {
    notFound(response);
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    notFound(response);
    return null;
  }
  if (session.token !== token) {
    unauthorized(response);
    return null;
  }
  return session;
}
function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}
async function serveStatic(response, root, relativePath) {
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    notFound(response);
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      notFound(response);
      return;
    }
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "content-length": String(info.size),
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    notFound(response);
  }
}
async function readJsonBody(request, maxBytes = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
function sendEvent(response, event, data) {
  response.write(`event: ${event}
`);
  response.write(`data: ${JSON.stringify(data)}

`);
}
function updateSessionStatus(session, patch) {
  session.status = {
    ...session.status,
    ...patch,
    updatedAt: Date.now()
  };
}
async function handleBrowserRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const path = decodeURIComponent(url.pathname);
  if (request.method === "GET" && path.startsWith("/assets/")) {
    await serveStatic(response, join(browserRoot, "assets"), path.slice("/assets/".length));
    return;
  }
  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(path);
  if (request.method === "GET" && sessionMatch) {
    const session2 = getSession(response, sessionMatch[1], url.searchParams.get("token"));
    if (!session2) return;
    updateSessionStatus(session2, { connected: true, smokeStatus: "loading" });
    await serveStatic(response, browserRoot, "index.html");
    return;
  }
  const apiMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)$/.exec(path);
  if (!apiMatch) {
    notFound(response);
    return;
  }
  const [, sessionId, operation] = apiMatch;
  const session = getSession(response, sessionId, url.searchParams.get("token"));
  if (!session) return;
  if (request.method === "GET" && operation === "bootstrap") {
    jsonResponse(response, 200, {
      sessionId: session.sessionId,
      token: session.token,
      source: session.source,
      assetBaseUrl: "/assets/",
      wasmBaseUrl: wasmPackageBaseUrl
    });
    return;
  }
  if (request.method === "GET" && operation === "events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write("\n");
    session.clients.add(response);
    updateSessionStatus(session, { connected: true });
    sendEvent(response, "hello", { sessionId: session.sessionId });
    request.on("close", () => {
      session.clients.delete(response);
      updateSessionStatus(session, { connected: session.clients.size > 0 });
    });
    return;
  }
  if (request.method === "POST" && operation === "status") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      jsonResponse(response, 400, { error: "Expected status object" });
      return;
    }
    updateSessionStatus(session, body);
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && operation === "rpc-result") {
    const body = await readJsonBody(request);
    const pending = session.pending.get(body.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      session.pending.delete(body.requestId);
      if (body.ok) {
        pending.resolve(body.result);
      } else {
        const error = new Error(body.error);
        if (body.stack) error.stack = body.stack;
        pending.reject(error);
      }
    }
    jsonResponse(response, 200, { ok: true });
    return;
  }
  notFound(response);
}
async function ensureHost() {
  if (hostServer && hostPort !== null) return hostPort;
  hostServer = createServer((request, response) => {
    handleBrowserRequest(request, response).catch((error) => {
      console.error("[mog-codex] browser host error", error);
      if (!response.headersSent) {
        jsonResponse(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      } else {
        response.end();
      }
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    hostServer.once("error", rejectPromise);
    hostServer.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = hostServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine Mog browser host port");
  }
  hostPort = address.port;
  return hostPort;
}
function resolveExplicitPath(input, label) {
  if (!input || typeof input !== "string") {
    throw new Error(`${label} must be a non-empty path`);
  }
  return resolve(process.cwd(), input);
}
async function sourceFromArgs(args) {
  const pathInput = args.xlsxPath ?? args.filePath ?? args.path;
  if (pathInput === void 0 || pathInput === null || pathInput === "") {
    return { kind: "blank" };
  }
  if (typeof pathInput !== "string") {
    throw new Error("xlsxPath must be a string");
  }
  const xlsxPath = resolveExplicitPath(pathInput, "xlsxPath");
  if (extname(xlsxPath).toLowerCase() !== ".xlsx") {
    throw new Error(`Mog Codex import currently supports .xlsx files only: ${xlsxPath}`);
  }
  const bytes = await readFile(xlsxPath);
  return {
    kind: "xlsx-bytes",
    fileName: xlsxPath.split(sep).at(-1) ?? "workbook.xlsx",
    bytesBase64: bytesToBase64(bytes),
    versionId: `file:${xlsxPath}:${bytes.byteLength}`,
    inputPath: xlsxPath
  };
}
async function createBrowserSession(args) {
  const port = await ensureHost();
  const sessionId = `mog-${randomUUID()}`;
  const token = randomToken();
  const source = await sourceFromArgs(args);
  const session = {
    sessionId,
    token,
    source,
    createdAt: Date.now(),
    clients: /* @__PURE__ */ new Set(),
    pending: /* @__PURE__ */ new Map(),
    status: {
      connected: false,
      ready: false,
      smokeStatus: "starting",
      updatedAt: Date.now()
    }
  };
  sessions.set(sessionId, session);
  return {
    sessionId,
    browserUrl: `http://127.0.0.1:${port}/sessions/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`,
    connectionStatus: session.status,
    source: source.kind === "xlsx-bytes" ? { kind: source.kind, fileName: source.fileName, inputPath: source.inputPath } : source
  };
}
function sessionStatus(args) {
  const sessionId = String(args.sessionId ?? "");
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      sessionId,
      exists: false,
      server: { listening: Boolean(hostServer), port: hostPort }
    };
  }
  return {
    sessionId,
    exists: true,
    server: { listening: Boolean(hostServer), port: hostPort },
    source: session.source.kind === "xlsx-bytes" ? {
      kind: session.source.kind,
      fileName: session.source.fileName,
      inputPath: session.source.inputPath
    } : session.source,
    status: session.status,
    pendingRequests: session.pending.size
  };
}
function rpcToBrowser(session, request, timeoutMs = 6e4) {
  if (session.clients.size === 0) {
    throw new Error(`Mog browser session ${session.sessionId} is not connected`);
  }
  const requestId = `rpc-${randomUUID()}`;
  const payload = { requestId, ...request };
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      session.pending.delete(requestId);
      rejectPromise(new Error(`Timed out waiting for Mog browser RPC ${request.type}`));
    }, timeoutMs);
    session.pending.set(requestId, { resolve: resolvePromise, reject: rejectPromise, timeout });
    for (const client of session.clients) {
      sendEvent(client, "rpc", payload);
    }
  });
}
function requireSession(args) {
  const sessionId = String(args.sessionId ?? "");
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown Mog browser session: ${sessionId}`);
  }
  return session;
}
async function callTool(name, args) {
  switch (name) {
    case "mog_browser_start":
      return createBrowserSession(args);
    case "mog_browser_status":
      return sessionStatus(args);
    case "mog_cell_read": {
      const session = requireSession(args);
      return {
        sessionId: session.sessionId,
        result: await rpcToBrowser(session, {
          type: "cell_read",
          sheet: typeof args.sheet === "string" ? args.sheet : void 0,
          address: typeof args.address === "string" ? args.address : void 0,
          range: typeof args.range === "string" ? args.range : void 0
        })
      };
    }
    case "mog_cell_write": {
      const session = requireSession(args);
      if (typeof args.address !== "string") throw new Error("address is required");
      return {
        sessionId: session.sessionId,
        result: await rpcToBrowser(session, {
          type: "cell_write",
          sheet: typeof args.sheet === "string" ? args.sheet : void 0,
          address: args.address,
          value: jsonSafe(args.value)
        })
      };
    }
    case "mog_selection_set": {
      const session = requireSession(args);
      if (typeof args.range !== "string") throw new Error("range is required");
      return {
        sessionId: session.sessionId,
        result: await rpcToBrowser(session, {
          type: "selection_set",
          sheet: typeof args.sheet === "string" ? args.sheet : void 0,
          range: args.range
        })
      };
    }
    case "mog_export_xlsx": {
      const session = requireSession(args);
      if (typeof args.outputPath !== "string") throw new Error("outputPath is required");
      const outputPath = resolveExplicitPath(args.outputPath, "outputPath");
      const result = await rpcToBrowser(session, { type: "export_xlsx" }, 12e4);
      const exportPayload = result;
      if (!result || typeof result !== "object" || Array.isArray(result) || typeof exportPayload.bytesBase64 !== "string") {
        throw new Error("Mog browser returned an invalid XLSX export payload");
      }
      const bytes = Buffer.from(exportPayload.bytesBase64, "base64");
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
      return {
        sessionId: session.sessionId,
        outputPath,
        bytesWritten: bytes.byteLength
      };
    }
    case "mog_session_close": {
      const session = requireSession(args);
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Mog session was closed"));
      }
      session.pending.clear();
      for (const client of session.clients) {
        sendEvent(client, "close", { sessionId: session.sessionId });
        client.end();
      }
      session.clients.clear();
      sessions.delete(session.sessionId);
      updateSessionStatus(session, { ready: false, connected: false, smokeStatus: "closed" });
      return { sessionId: session.sessionId, closed: true };
    }
    default:
      throw new Error(`Unknown Mog tool: ${name}`);
  }
}
var toolDefinitions = [
  {
    name: "mog_browser_start",
    description: "Start a localhost Mog browser session with a blank workbook or an explicit XLSX file path.",
    inputSchema: {
      type: "object",
      properties: {
        xlsxPath: {
          type: "string",
          description: "Explicit local .xlsx path to import. Omit for a blank workbook."
        },
        filePath: { type: "string", description: "Alias for xlsxPath." }
      },
      additionalProperties: false
    }
  },
  {
    name: "mog_browser_status",
    description: "Inspect server, browser, workbook, canvas, and smoke readiness for a Mog browser session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "mog_cell_read",
    description: "Read a cell or range from the workbook visible in the Mog browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheet: { type: "string" },
        address: { type: "string" },
        range: { type: "string" }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "mog_cell_write",
    description: "Write a value to a cell in the workbook visible in the Mog browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheet: { type: "string" },
        address: { type: "string" },
        value: {}
      },
      required: ["sessionId", "address", "value"],
      additionalProperties: false
    }
  },
  {
    name: "mog_selection_set",
    description: "Set the visible selection in the Mog browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sheet: { type: "string" },
        range: { type: "string" }
      },
      required: ["sessionId", "range"],
      additionalProperties: false
    }
  },
  {
    name: "mog_export_xlsx",
    description: "Export the browser-visible workbook to an explicit local .xlsx output path.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        outputPath: { type: "string" }
      },
      required: ["sessionId", "outputPath"],
      additionalProperties: false
    }
  },
  {
    name: "mog_session_close",
    description: "Close a Mog browser session and release its pending browser RPC resources.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
      additionalProperties: false
    }
  }
];
function encodeMcpMessage(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r
\r
`, "ascii"), body]);
}
function writeMcp(message) {
  process.stdout.write(encodeMcpMessage(message));
}
function textToolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
function mcpError(id, code, message) {
  writeMcp({ jsonrpc: "2.0", id, error: { code, message } });
}
async function handleMcpRequest(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return;
  const id = message.id;
  try {
    switch (message.method) {
      case "initialize":
        writeMcp({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "mog", version: pluginVersion },
            instructions: "Use Mog tools to start a localhost browser session, open the returned URL in the Codex in-app browser, wait for readiness, then operate on that visible workbook."
          }
        });
        return;
      case "notifications/initialized":
        return;
      case "ping":
        writeMcp({ jsonrpc: "2.0", id, result: {} });
        return;
      case "tools/list":
        writeMcp({ jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
        return;
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const args = message.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments : {};
        const result = await callTool(name, args);
        writeMcp({ jsonrpc: "2.0", id, result: textToolResult(result) });
        return;
      }
      default:
        mcpError(id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    writeMcp({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ],
        isError: true
      }
    });
  }
}
function startStdioMcp() {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString("ascii");
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.byteLength < bodyEnd) return;
      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      void handleMcpRequest(JSON.parse(body)).catch((error) => {
        console.error("[mog-codex] MCP request failed", error);
      });
    }
  });
}
if (process.argv.includes("--stdio")) {
  startStdioMcp();
} else {
  const port = await ensureHost();
  console.error(`[mog-codex] Browser host listening on http://127.0.0.1:${port}`);
}
