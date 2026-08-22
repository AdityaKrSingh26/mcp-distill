import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleDiagnoseElement } from "./tools/diagnose-element.js";
import { handleGetErrors } from "./tools/get-errors.js";
import { handleGetPageOutline } from "./tools/page-outline.js";
import { handleGetNetworkSummary } from "./tools/network-summary.js";

export function createServer() {
    const server = new McpServer({
        name: "mcp-distill",
        version: "0.1.0",
    });

    server.tool(
        "diagnose_element",
        "Fetches computed styles and DOM info for one or more elements, then returns a compressed diagnostic report identifying likely visual bugs. Accepts a single selector or an array (up to 20) for batched diagnosis in one round-trip. 80-90% fewer tokens than raw browser MCP output.",
        {
            selector: z
                .union([z.string(), z.array(z.string()).min(1).max(20)])
                .describe(
                    "CSS selector (string) or selectors (array, up to 20) for elements to diagnose",
                ),
            include_box_model: z
                .boolean()
                .default(true)
                .describe("Include box model (margin, padding, border) in analysis"),
        },
        handleDiagnoseElement,
    );

    server.tool(
        "get_errors",
        "Fetches console logs from the browser, deduplicates them, strips noise (React dev warnings, deprecation notices), and returns a ranked error list. Resolves minified stack frames via source maps by default. Typically reduces 1000s of log lines to under 20 unique issues.",
        {
            severity: z
                .enum(["error", "warning", "all"])
                .default("error")
                .describe("Minimum severity to include"),
            limit: z
                .number()
                .int()
                .min(1)
                .max(100)
                .default(20)
                .describe("Max number of unique errors to return"),
            resolve_sourcemaps: z
                .boolean()
                .default(true)
                .describe(
                    "Resolve minified stack frames using source maps (default: true). Set false to skip network fetches.",
                ),
        },
        handleGetErrors,
    );

    server.tool(
        "get_page_outline",
        "Fetches the page accessibility snapshot and compresses it into a structural outline: landmarks, headings, and interactive elements, with element references preserved so they can still be clicked. Collapses wrapper nesting and folds repeated lists (feeds, tables, product grids). Typically 90%+ fewer tokens than a raw snapshot.",
        {
            include: z
                .enum(["interactive", "all"])
                .default("interactive")
                .describe(
                    "'interactive' keeps interactive elements, landmarks, headings, and alerts. 'all' keeps every node but still folds repeated lists.",
                ),
            limit: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(150)
                .describe("Max number of nodes to return"),
        },
        handleGetPageOutline,
    );

    server.tool(
        "get_network_summary",
        "Fetches the page's network requests and compresses them into a diagnostic summary: failed requests, requests slower than 1s, oversized payloads, duplicate fetches, and per-status/per-type counts. Turns a few hundred raw request records into a short report.",
        {
            limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .default(10)
                .describe(
                    "Max entries listed per section (failures, slowest, largest, duplicates)",
                ),
        },
        handleGetNetworkSummary,
    );

    return server;
}

export async function startServer(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
