import { callTool } from "../client.js";
import { findBackendTool, NETWORK_TOOLS, NETWORK_PATTERN } from "../capabilities.js";
import { parseNetworkRequests, summarizeNetwork, formatBytes } from "../analysis/network.js";
import { parseFencedJson } from "../util.js";

export async function handleGetNetworkSummary({ limit }) {
    const toolName = await findBackendTool(NETWORK_TOOLS, NETWORK_PATTERN);

    if (!toolName) {
        return warn(
            "No network tool found on the backend MCP. Expected one of: " +
                NETWORK_TOOLS.join(", "),
        );
    }

    let raw;
    try {
        // A page can easily issue more requests than the backend's default page
        // size, and a truncated log turns a real failure into a silent absence.
        raw = await callTool(toolName, { pageSize: 200 });
    } catch {
        try {
            raw = await callTool(toolName, {});
        } catch (err) {
            return warn(`Could not fetch network requests via ${toolName}: ${err.message}`);
        }
    }

    const requests = parseNetworkRequests(extractPayload(raw));
    if (requests.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        summary: "No network requests recorded for this page.",
                        details: { total_requests: 0 },
                    }),
                },
            ],
        };
    }

    const { details, failureCount, slowCount, totalBytes } = summarizeNetwork(requests, { limit });

    const parts = [`${requests.length} requests`];
    if (failureCount) {
        parts.push(`${failureCount} failed`);
    }
    if (slowCount) {
        parts.push(`${slowCount} slow (>1s)`);
    }
    if (totalBytes > 0) {
        parts.push(formatBytes(totalBytes));
    }

    let summary = parts.join(", ");
    if (details.failures?.length) {
        const top = details.failures[0];
        summary += `. Top: ${top.status} ${top.method} ${top.url}`;
    }

    return {
        content: [{ type: "text", text: JSON.stringify({ summary: summary + ".", details }) }],
    };
}

// Unwraps the MCP content envelope. The payload inside is either JSON or the
// text block a backend prints, and parseNetworkRequests handles both.
function extractPayload(raw) {
    if (typeof raw === "string" || Array.isArray(raw)) {
        return raw;
    }

    const text = Array.isArray(raw?.content)
        ? raw.content
              .filter((c) => typeof c?.text === "string")
              .map((c) => c.text)
              .join("\n")
        : null;

    if (text) {
        try {
            return parseFencedJson(text);
        } catch {
            return text;
        }
    }

    return raw ?? [];
}

function warn(message) {
    return { content: [{ type: "text", text: JSON.stringify({ _lens_warning: message }) }] };
}
