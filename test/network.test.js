import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNetworkRequests, summarizeNetwork, formatBytes } from "../src/analysis/network.js";

test("parses JSON records with the field names chrome-devtools-mcp uses", () => {
    const requests = parseNetworkRequests([
        {
            url: "https://api.example.com/cart",
            method: "post",
            status: 500,
            resourceType: "xhr",
            encodedDataLength: 512,
            duration: 1800,
        },
    ]);

    assert.deepEqual(requests, [
        {
            method: "POST",
            url: "https://api.example.com/cart",
            status: 500,
            type: "xhr",
            size: 512,
            duration: 1800,
            failed: true,
        },
    ]);
});

test("unwraps a records array nested under a wrapper key", () => {
    const requests = parseNetworkRequests({
        requests: [{ url: "https://example.com/a", status: 200 }],
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET", "defaults the method when the backend omits it");
});

test("parses the one-line-per-request text form", () => {
    const text = [
        "[GET] https://example.com/app.js => [200] 145 kB 320 ms",
        "[POST] https://api.example.com/checkout => [502] failed",
    ].join("\n");

    const requests = parseNetworkRequests(text);
    assert.equal(requests.length, 2);
    assert.deepEqual(
        requests.map((r) => [r.method, r.status, r.failed]),
        [
            ["GET", 200, false],
            ["POST", 502, true],
        ],
    );
    assert.equal(requests[0].size, 148480);
    assert.equal(requests[0].duration, 320);
});

test("reads a duration given in seconds as milliseconds", () => {
    const [request] = parseNetworkRequests("GET https://example.com/slow 200 2.5 s");
    assert.equal(request.duration, 2500);
});

test("skips lines and records that carry no URL", () => {
    assert.deepEqual(parseNetworkRequests("## Network requests\nShowing 1-2 of 2"), []);
    assert.deepEqual(parseNetworkRequests([{ method: "GET" }]), []);
    assert.deepEqual(parseNetworkRequests(null), []);
});

test("treats an explicitly failed request with no status as a failure", () => {
    const [request] = parseNetworkRequests([
        { url: "https://cdn.example.com/font.woff2", failed: true },
    ]);
    assert.equal(request.failed, true);
});

function req(overrides) {
    return {
        method: "GET",
        url: "https://example.com/asset",
        status: 200,
        type: "script",
        failed: false,
        ...overrides,
    };
}

test("groups requests by status class and resource type", () => {
    const { details } = summarizeNetwork([
        req({}),
        req({ status: 304, type: "image" }),
        req({ status: 404, failed: true, url: "https://example.com/missing.png", type: "image" }),
    ]);

    assert.deepEqual(details.by_status, { "2xx": 1, "3xx": 1, "4xx": 1 });
    assert.deepEqual(details.by_type, { script: 1, image: 2 });
    assert.equal(details.total_requests, 3);
});

test("lists failures and counts them", () => {
    const { details, failureCount } = summarizeNetwork([
        req({}),
        req({ url: "https://api.example.com/cart", method: "POST", status: 500, failed: true }),
    ]);

    assert.equal(failureCount, 1);
    assert.deepEqual(details.failures, [
        {
            method: "POST",
            url: "https://api.example.com/cart",
            status: 500,
            type: "script",
        },
    ]);
});

test("reports only requests slower than a second, slowest first", () => {
    const { details, slowCount } = summarizeNetwork([
        req({ url: "https://example.com/fast", duration: 120 }),
        req({ url: "https://example.com/slow", duration: 2400 }),
        req({ url: "https://example.com/slower", duration: 5000 }),
    ]);

    assert.equal(slowCount, 2);
    assert.deepEqual(details.slowest, [
        { url: "https://example.com/slower", duration_ms: 5000 },
        { url: "https://example.com/slow", duration_ms: 2400 },
    ]);
});

test("omits sections the backend gave no data for", () => {
    const { details } = summarizeNetwork([req({}), req({})]);
    assert.equal("slowest" in details, false);
    assert.equal("largest" in details, false);
    assert.equal("failures" in details, false);
    assert.equal("total_bytes" in details, false);
});

test("lists only payloads heavy enough to matter, and still totals the rest", () => {
    const small = summarizeNetwork([req({ size: 1000 }), req({ url: "https://x/b", size: 1000 })]);
    assert.equal("largest" in small.details, false);
    assert.equal(small.totalBytes, 2000);

    const heavy = summarizeNetwork([
        req({ url: "https://example.com/vendor.js", size: 900_000 }),
        req({ url: "https://example.com/app.js", size: 1000 }),
    ]);
    assert.deepEqual(heavy.details.largest, [
        { url: "https://example.com/vendor.js", size_bytes: 900_000 },
    ]);
    assert.equal(heavy.totalBytes, 901_000);
});

test("folds repeated fetches of the same URL into a count", () => {
    const { details } = summarizeNetwork([
        req({ url: "https://api.example.com/me" }),
        req({ url: "https://api.example.com/me" }),
        req({ url: "https://api.example.com/me" }),
        req({ url: "https://example.com/once" }),
    ]);

    assert.deepEqual(details.duplicates, [{ request: "GET https://api.example.com/me", count: 3 }]);
});

test("caps each section at the requested limit", () => {
    const failures = Array.from({ length: 12 }, (_, i) =>
        req({ url: `https://example.com/${i}`, status: 500, failed: true }),
    );
    const { details } = summarizeNetwork(failures, { limit: 3 });
    assert.equal(details.failures.length, 3);
});

test("truncates a URL long enough to cost more than it explains", () => {
    const long = "https://example.com/" + "a".repeat(300);
    const { details } = summarizeNetwork([req({ url: long, status: 500, failed: true })]);
    assert.equal(details.failures[0].url.length, 121);
    assert.ok(details.failures[0].url.endsWith("…"));
});

test("formats byte totals at a readable scale", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 kB");
    assert.equal(formatBytes(3_500_000), "3.3 MB");
});
