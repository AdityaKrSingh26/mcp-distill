import { callTool } from "../client.js";
import { deduplicateErrors } from "../analysis/console-dedup.js";
import { createResolver } from "../analysis/sourcemap.js";

export async function handleGetErrors({ severity, limit, resolve_sourcemaps }) {
    let raw;
    try {
        const types =
            severity === "error" ? ["error"] : severity === "warning" ? ["warn", "error"] : [];
        raw = await callTool("list_console_messages", types.length ? { types } : {});
    } catch (err) {
        try {
            raw = await callTool("getConsoleHistory", {});
        } catch {
            try {
                raw = await callTool("get_console_logs", {});
            } catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                _lens_warning: `Could not fetch console logs: ${err.message}`,
                            }),
                        },
                    ],
                };
            }
        }
    }

    let logs;
    try {
        logs = extractLogs(raw);
    } catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        _lens_warning: `Log extraction failed: ${err.message}`,
                        raw,
                    }),
                },
            ],
        };
    }

    const totalCount = logs.length;
    const resolver = resolve_sourcemaps === false ? null : createResolver();
    const { issues: deduped, resolvedCount } = await deduplicateErrors(logs, {
        severity,
        limit,
        resolver,
    });

    const summary =
        deduped.length === 0
            ? `No ${severity === "all" ? "" : severity + " "}messages found in console.`
            : `${deduped.length} unique issue${deduped.length > 1 ? "s" : ""} (from ${totalCount} total log entries). Top: ${deduped[0].message.slice(0, 100)}`;

    const details = {
        total_log_entries: totalCount,
        unique_issues: deduped,
    };
    if (resolver) {
        details._sourcemap_resolved = resolvedCount;
    }

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ summary, details }, null, 2),
            },
        ],
    };
}

function extractLogs(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (Array.isArray(raw?.result)) {
        return raw.result;
    }
    if (Array.isArray(raw?.logs)) {
        return raw.logs;
    }
    if (Array.isArray(raw?.messages)) {
        return raw.messages;
    }
    if (raw?.content?.[0]?.text) {
        const text = raw.content[0].text;
        if (/no console messages/i.test(text) || /^##\s/m.test(text)) {
            return [];
        }
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        if (Array.isArray(parsed?.result)) {
            return parsed.result;
        }
        if (Array.isArray(parsed?.messages)) {
            return parsed.messages;
        }
        if (Array.isArray(parsed?.logs)) {
            return parsed.logs;
        }
        if (parsed && typeof parsed === "object") {
            const arr = parsed.messages ?? parsed.logs ?? parsed.result;
            if (Array.isArray(arr)) {
                return arr;
            }
        }
    }
    throw new Error(
        `Unrecognized console log response shape: ${JSON.stringify(raw).slice(0, 200)}`,
    );
}
