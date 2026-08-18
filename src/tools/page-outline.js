import { callTool } from "../client.js";
import { findBackendTool, SNAPSHOT_TOOLS, SNAPSHOT_PATTERN } from "../capabilities.js";
import { parseSnapshot, compressOutline, summarizeOutline } from "../analysis/outline.js";

export async function handleGetPageOutline({ include, limit }) {
    const toolName = await findBackendTool(SNAPSHOT_TOOLS, SNAPSHOT_PATTERN);

    if (!toolName) {
        return warn(
            "No snapshot tool found on the backend MCP. Expected one of: " +
                SNAPSHOT_TOOLS.join(", "),
        );
    }

    let raw;
    try {
        raw = await callTool(toolName, {});
    } catch (err) {
        return warn(`Could not fetch page snapshot via ${toolName}: ${err.message}`);
    }

    const text = extractText(raw);
    if (!text) {
        return warn(`Snapshot response from ${toolName} contained no text`, raw);
    }

    const { roots, total } = parseSnapshot(text);
    if (total === 0) {
        return warn(`Could not parse snapshot from ${toolName}`, raw);
    }

    const { outline, kept } = compressOutline(roots, { include, limit });
    const counts = summarizeOutline(outline);

    const parts = [
        `${counts.interactive} interactive`,
        `${counts.landmarks} landmark${counts.landmarks === 1 ? "" : "s"}`,
        `${counts.headings} heading${counts.headings === 1 ? "" : "s"}`,
    ];
    if (counts.alerts) {
        parts.push(`${counts.alerts} alert${counts.alerts === 1 ? "" : "s"}`);
    }

    const reduction = Math.round((1 - kept / total) * 100);
    const title = extractMeta(text, /Page Title:\s*(.+)/i);
    const url = extractMeta(text, /Page URL:\s*(.+)/i);

    const summary =
        `${title ? title + " | " : ""}${parts.join(", ")} ` +
        `(${kept} of ${total} nodes, ${reduction}% reduction)`;

    const details = { total_nodes: total, outline };
    if (title) {
        details.title = title;
    }
    if (url) {
        details.url = url;
    }

    // Emitted without indentation: on a large outline, pretty-printing costs more
    // characters than the compression saves.
    return {
        content: [{ type: "text", text: JSON.stringify({ summary, details }) }],
    };
}

function extractMeta(text, pattern) {
    return text.match(pattern)?.[1].trim() ?? null;
}

function extractText(raw) {
    if (typeof raw === "string") {
        return raw;
    }
    if (!Array.isArray(raw?.content)) {
        return null;
    }
    const text = raw.content
        .filter((c) => typeof c?.text === "string")
        .map((c) => c.text)
        .join("\n");
    return text || null;
}

function warn(message, raw) {
    const payload =
        raw === undefined ? { _lens_warning: message } : { _lens_warning: message, raw };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
