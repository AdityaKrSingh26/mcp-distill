import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client = null;
let _readyResolve;
let _readyReject;

// Promise that resolves once connectBackend() completes
const ready = new Promise((res, rej) => {
    _readyResolve = res;
    _readyReject = rej;
});

export async function connectBackend() {
    const cmd = process.env.MCP_DISTILL_BACKEND_CMD;
    const argsStr = process.env.MCP_DISTILL_BACKEND_ARGS ?? "";

    if (!cmd) {
        const err = new Error(
            "MCP_DISTILL_BACKEND_CMD is not set. Example: MCP_DISTILL_BACKEND_CMD=npx MCP_DISTILL_BACKEND_ARGS=chrome-devtools-mcp",
        );
        _readyReject(err);
        throw err;
    }

    const transport = new StdioClientTransport({
        command: cmd,
        args: argsStr ? argsStr.split(" ") : [],
    });

    client = new Client({ name: "mcp-distill", version: "0.1.0" });
    await client.connect(transport);
    _readyResolve();
    return client;
}

export async function callTool(name, args) {
    await ready;
    return client.callTool({ name, arguments: args });
}

export async function listTools() {
    await ready;
    const result = await client.listTools();
    return result.tools;
}

export function getClient() {
    return client;
}
