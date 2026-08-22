// Backends report network activity in unrelated shapes: chrome-devtools-mcp
// returns JSON-ish records, Playwright MCP returns one text line per request.
// Both are normalized to the same record here so the analysis below is shared.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
const SLOW_MS = 1000;
const LARGE_BYTES = 100 * 1024;
const MAX_URL = 120;

function pick(obj, keys) {
    for (const key of keys) {
        const value = obj[key];
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return undefined;
}

function toNumber(value) {
    const n = typeof value === "string" ? parseFloat(value) : value;
    return typeof n === "number" && !isNaN(n) ? n : undefined;
}

function normalizeRecord(entry) {
    const url = pick(entry, ["url", "request_url", "requestUrl", "name"]);
    if (typeof url !== "string" || !url) {
        return null;
    }

    const status = toNumber(pick(entry, ["status", "statusCode", "status_code", "responseStatus"]));
    const failed =
        entry.failed === true ||
        entry.error !== undefined ||
        status === 0 ||
        (status !== undefined && status >= 400);

    return {
        method: (pick(entry, ["method", "requestMethod"]) ?? "GET").toString().toUpperCase(),
        url,
        status,
        type: pick(entry, ["resourceType", "resource_type", "type", "mimeType"]),
        size: toNumber(pick(entry, ["size", "transferSize", "encodedDataLength", "bytes"])),
        duration: toNumber(pick(entry, ["duration", "durationMs", "time", "elapsed"])),
        failed,
    };
}

function parseLine(line) {
    const urlMatch = line.match(/https?:\/\/[^\s"'>)\]]+/);
    if (!urlMatch) {
        return null;
    }
    const url = urlMatch[0];
    const before = line.slice(0, urlMatch.index);
    const after = line.slice(urlMatch.index + url.length);

    const method = METHODS.find((m) => new RegExp(`\\b${m}\\b`).test(before)) ?? "GET";
    const statusMatch = after.match(/\b([1-5]\d{2})\b/);
    const status = statusMatch ? Number(statusMatch[1]) : undefined;
    const sizeMatch = after.match(/\b(\d+(?:\.\d+)?)\s?(B|kB|KB|MB|GB)\b/);
    const durationMatch = after.match(/\b(\d+(?:\.\d+)?)\s?(ms|s)\b/);

    let duration;
    if (durationMatch) {
        const value = Number(durationMatch[1]);
        duration = durationMatch[2] === "s" ? value * 1000 : value;
    }

    return {
        method,
        url,
        status,
        type: undefined,
        size: sizeMatch
            ? Math.round(Number(sizeMatch[1]) * SIZE_UNITS[sizeMatch[2].toLowerCase()])
            : undefined,
        duration,
        failed: /\b(failed|blocked|aborted|refused)\b/i.test(after) || (status ?? 0) >= 400,
    };
}

// Accepts whatever the backend returned: an array of records, an object wrapping
// one, or the text block a backend prints. Anything unrecognizable is skipped
// rather than failing the whole call.
export function parseNetworkRequests(payload) {
    if (Array.isArray(payload)) {
        return payload.map(normalizeRecord).filter(Boolean);
    }

    if (payload && typeof payload === "object") {
        const arr = pick(payload, ["requests", "entries", "logs", "result", "networkRequests"]);
        if (Array.isArray(arr)) {
            return arr.map(normalizeRecord).filter(Boolean);
        }
        return [];
    }

    if (typeof payload !== "string") {
        return [];
    }

    return payload.split("\n").map(parseLine).filter(Boolean);
}

function shortenUrl(url) {
    return url.length > MAX_URL ? url.slice(0, MAX_URL) + "…" : url;
}

function statusClass(status) {
    if (status === undefined) {
        return "unknown";
    }
    if (status === 0) {
        return "failed";
    }
    return `${Math.floor(status / 100)}xx`;
}

function tally(values) {
    const counts = {};
    for (const value of values) {
        if (value === undefined) {
            continue;
        }
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}

/**
 * Reduces a full request log to the parts worth a token: what broke, what was
 * slow, what was heavy, and what was fetched more than once. Everything else
 * collapses into counts.
 */
export function summarizeNetwork(requests, { limit = 10 } = {}) {
    const byStatus = tally(requests.map((r) => statusClass(r.status)));
    const byType = tally(requests.map((r) => r.type));

    const failures = requests
        .filter((r) => r.failed)
        .slice(0, limit)
        .map((r) => ({
            method: r.method,
            url: shortenUrl(r.url),
            status: r.status ?? "failed",
            ...(r.type ? { type: r.type } : {}),
        }));

    const timed = requests.filter((r) => r.duration !== undefined);
    const slowest = timed
        .filter((r) => r.duration >= SLOW_MS)
        .sort((a, b) => b.duration - a.duration)
        .slice(0, limit)
        .map((r) => ({ url: shortenUrl(r.url), duration_ms: Math.round(r.duration) }));

    const sized = requests.filter((r) => r.size !== undefined);
    // Below this a payload is not what makes a page heavy, so listing it would
    // spend tokens on noise.
    const largest = sized
        .filter((r) => r.size >= LARGE_BYTES)
        .sort((a, b) => b.size - a.size)
        .slice(0, limit)
        .map((r) => ({ url: shortenUrl(r.url), size_bytes: r.size }));

    const seen = new Map();
    for (const r of requests) {
        const key = `${r.method} ${r.url}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ request: shortenUrl(key), count }));

    const totalBytes = sized.reduce((sum, r) => sum + r.size, 0);
    const failureCount = requests.filter((r) => r.failed).length;

    const details = {
        total_requests: requests.length,
        by_status: byStatus,
    };
    if (Object.keys(byType).length) {
        details.by_type = byType;
    }
    if (sized.length) {
        details.total_bytes = totalBytes;
    }
    if (failures.length) {
        details.failures = failures;
    }
    if (slowest.length) {
        details.slowest = slowest;
    }
    if (largest.length) {
        details.largest = largest;
    }
    if (duplicates.length) {
        details.duplicates = duplicates;
    }

    return { details, failureCount, slowCount: slowest.length, totalBytes };
}

export function formatBytes(bytes) {
    if (bytes >= SIZE_UNITS.mb) {
        return `${(bytes / SIZE_UNITS.mb).toFixed(1)} MB`;
    }
    if (bytes >= SIZE_UNITS.kb) {
        return `${Math.round(bytes / SIZE_UNITS.kb)} kB`;
    }
    return `${bytes} B`;
}
