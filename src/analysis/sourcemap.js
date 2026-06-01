import { SourceMapConsumer } from "source-map-js";

const MINIFIED_URL_RE = /\.(min|bundle|chunk)\.js(\?|$)|\/dist\/|\/build\/|\/_next\/static\/chunks\//;

export function looksMinified({ url, line, column }) {
    if (!url) {
        return false;
    }
    
    if (MINIFIED_URL_RE.test(url)) {
        return true;
    }
    
    if (line === 1 && typeof column === "number" && column > 200) {
        return true;
    }
    
    return false;
}

export function createResolver({ fetcher } = {}) {
    const cache = new Map(); // url -> consumer | null (null = lookup failed)
    const fetchMap = fetcher ?? defaultFetchMap;
    
    async function getConsumer(url) {
        if (cache.has(url)) {
            return cache.get(url);
        }
        try {
            const mapJson = await fetchMap(url);
            if (!mapJson) {
                cache.set(url, null);
                return null;
            }
            const consumer = new SourceMapConsumer(mapJson);
            cache.set(url, consumer);
            return consumer;
        } catch {
            cache.set(url, null);
            return null;
        }
    }
    
    async function resolveFrame(frame) {
        if (!frame || !frame.url) {
            return null;
        }
        
        if (!looksMinified(frame)) {
            return null;
        }
            
        const consumer = await getConsumer(frame.url);
        
        if (!consumer) {
            return null;
        }
        
        try {
            const original = consumer.originalPositionFor({
                line: frame.line,
                column: frame.column ?? 0,
            });
            
            if (!original || !original.source) {
                return null;
            }
            
            return {
                source: original.source,
                line: original.line,
                column: original.column,
                name: original.name ?? null,
            };
        } catch {
            return null;
        }
    }
    
    return { resolveFrame };
}

async function defaultFetchMap(url) {
    // Try `<url>.map` first; many bundlers emit alongside.
    const mapUrl = url.replace(/\?.*$/, "") + ".map";
    
    try {
        const res = await fetch(mapUrl);
        if (res.ok) {
            return await res.text();
        }
    } catch {}
    
    // Fall back: fetch the source, look for `//# sourceMappingURL=`
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }
        const body = await res.text();
        const m = body.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/);
        if (!m) {
            return null;
        }
        
        const ref = m[1];
        if (ref.startsWith("data:")) {
            const b64 = ref.match(/;base64,(.*)$/);
            if (b64) {
                return Buffer.from(b64[1], "base64").toString("utf8");
            }
            return null;
        }
        const absolute = new URL(ref, url).toString();
        const mapRes = await fetch(absolute);
        if (mapRes.ok) {
            return await mapRes.text();
        }
    } catch {}
    
    return null;
}
