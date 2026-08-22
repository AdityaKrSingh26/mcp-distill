import { listTools } from "./client.js";

// Backend tool names, most specific first. Different browser MCPs name the same
// capability differently, so each capability lists the known names and a loose
// pattern used to discover unknown backends.
export const CONSOLE_TOOLS = ["list_console_messages", "getConsoleHistory", "get_console_logs"];
export const CONSOLE_PATTERN = /console|log/i;

export const SNAPSHOT_TOOLS = ["take_snapshot", "browser_snapshot"];
export const SNAPSHOT_PATTERN = /snapshot|accessibility|a11y/i;

export const EVAL_TOOLS = ["evaluate_script", "browser_evaluate"];
export const EVAL_PATTERN = /evaluate|eval_js|execute_script/i;

let namesCache = null;

async function backendToolNames() {
    if (namesCache) {
        return namesCache;
    }
    try {
        const tools = await listTools();
        namesCache = tools.map((t) => t.name);
    } catch {
        namesCache = [];
    }
    return namesCache;
}

// Picks a capability out of a known set of backend tool names, preferring the
// known names in order and falling back to pattern discovery so unfamiliar
// backends still work.
export function pickTool(names, preferred, pattern) {
    for (const name of preferred) {
        if (names.includes(name)) {
            return name;
        }
    }

    return names.find((name) => pattern.test(name)) ?? null;
}

// Resolves a capability to a concrete tool name on the connected backend.
export async function findBackendTool(preferred, pattern) {
    return pickTool(await backendToolNames(), preferred, pattern);
}
