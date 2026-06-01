const NOISE_PATTERNS = [
    /^Warning: Each child in a list should have a unique "key" prop/,
    /^Warning: React does not recognize the `\w+` prop on a DOM element/,
    /^\[HMR\]/,
    /^\[vite\]/,
    /^Download the React DevTools/,
    /^Warning: ReactDOM.render is no longer supported/,
    /is deprecated and will be removed/i,
    /^\[webpack\]/,
];

function isNoise(message) {
    return NOISE_PATTERNS.some((re) => re.test(message));
}

function fingerprint(entry) {
    
    const normalized = (entry.text ?? entry.message ?? "")
        .replace(/0x[0-9a-f]+/gi, "0x?")
        .replace(/:\d+:\d+/g, ":?:?")
        .replace(/\b\d{5,}\b/g, "?");
    
    return `${entry.level ?? entry.type ?? "log"}::${normalized.slice(0, 200)}`;
}

export async function deduplicateErrors(
    logs,
    { severity = "error", limit = 20, resolver = null } = {},
) {
    const severityRank = { 
        error: 3, 
        warning: 2, 
        warn: 2, 
        info: 1, 
        log: 1, 
        verbose: 0, 
        debug: 0 
    };
    
    const minRank = severityRank[severity] ?? 1;

    const seen = new Map();

    for (const entry of logs) {
        
        const level = entry.level ?? entry.type ?? "log";
        const rank = severityRank[level] ?? 1;
        
        if (rank < minRank) {
            continue;
        }

        const msg = entry.text ?? entry.message ?? "";
        
        if (isNoise(msg)) {
            continue;
        }

        const fp = fingerprint(entry);
        
        if (seen.has(fp)) {
            seen.get(fp).count++;
        } else {
            seen.set(fp, { entry, count: 1 });
        }
    }

    const sorted = [...seen.values()].sort((a, b) => {
        
        const aRank = severityRank[a.entry.level ?? a.entry.type ?? "log"] ?? 1;
        const bRank = severityRank[b.entry.level ?? b.entry.type ?? "log"] ?? 1;
        
        if (bRank !== aRank) {
            return bRank - aRank;
        }
        
        return b.count - a.count;
    });

    let resolvedCount = 0;
    const top = sorted.slice(0, limit);

    const out = [];
    
    for (const { entry, count } of top) {
        
        const stackInfo = await compressStack(entry.stackTrace ?? entry.stack ?? null, resolver);
        resolvedCount += stackInfo.resolvedCount;
        
        out.push({
            level: entry.level ?? entry.type ?? "log",
            message: entry.text ?? entry.message ?? "",
            count,
            source: entry.source ?? entry.url ?? null,
            stackTrace: stackInfo.frames,
        });
    }

    return { issues: out, resolvedCount };
}

async function compressStack(stack, resolver) {
    
    if (!stack) {
        return { frames: null, resolvedCount: 0 };
    }
    
    const rawFrames = Array.isArray(stack) ? stack : stack.split("\n");
    const parsed = rawFrames
        .map(parseFrame)
        .filter((f) => f && !isInternalFrame(f))
        .slice(0, 3);

    if (!resolver) {
        return { frames: parsed.length ? parsed.map(frameToString) : null, resolvedCount: 0 };
    }

    let resolvedCount = 0;
    const out = [];
    for (const frame of parsed) {
        const resolved = await resolver.resolveFrame(frame);
        
        if (resolved) {
            resolvedCount++;
            const name = resolved.name ?? frame.functionName ?? "?";
            out.push(`at ${name} (${resolved.source}:${resolved.line}:${resolved.column})`);
        } else {
            out.push(frameToString(frame));
        }
    }
    
    return { frames: out, resolvedCount };
}

function parseFrame(frame) {
    if (!frame) {
        return null;
    }
    
    if (typeof frame === "object") {
        const url = frame.url ?? frame.scriptUrl ?? frame.source ?? null;
        const line = frame.lineNumber ?? frame.line ?? null;
        const column = frame.columnNumber ?? frame.column ?? null;
        const functionName = frame.functionName ?? frame.name ?? null;
        return { functionName, url, line, column, raw: null };
    }
    
    if (typeof frame !== "string") {
        return null;
    }
    
    const s = frame.trim();
    
    if (!s) {
        return null;
    }
    
    // "at funcName (url:line:col)" or "at url:line:col"
    const m = s.match(/at\s+(?:(.+?)\s+\()?([^()\s]+?):(\d+):(\d+)\)?$/);
    if (m) {
        return {
            functionName: m[1] ?? null,
            url: m[2],
            line: Number(m[3]),
            column: Number(m[4]),
            raw: s,
        };
    }
    
    return { 
        functionName: null, 
        url: null, 
        line: null,
        column: null, 
        raw: s 
    };
}

function isInternalFrame(f) {
    const s = (f.url ?? "") + " " + (f.functionName ?? "") + " " + (f.raw ?? "");
    return /node_modules|webpack-internal/.test(s);
}

function frameToString(f) {
    if (f.raw && !f.url) {
        return f.raw;
    }
    
    const name = f.functionName ?? "?";
    if (f.url && f.line !== null) {
        return `at ${name} (${f.url}:${f.line}:${f.column ?? 0})`;
    }
    
    return f.raw ?? `at ${name}`;
}
