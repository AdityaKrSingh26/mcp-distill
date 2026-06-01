#!/usr/bin/env node
import { connectBackend } from "./client.js";
import { createServer, startServer } from "./server.js";

// Start MCP server immediately so Claude Code can register tools.
// Backend connection happens in parallel; tool calls await the ready promise in client.js.
const server = createServer();

connectBackend().catch((err) => {
    process.stderr.write(`mcp-distill: backend connection failed: ${err.message}\n`);
    process.exit(1);
});

startServer(server).catch((err) => {
    process.stderr.write(`mcp-distill fatal: ${err.message}\n`);
    process.exit(1);
});
