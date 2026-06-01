import { test } from "node:test";
import assert from "node:assert/strict";
import { deduplicateErrors } from "../src/analysis/console-dedup.js";
import { createResolver } from "../src/analysis/sourcemap.js";
import { readFileSync } from "node:fs";

const logs = JSON.parse(
    readFileSync(new URL("./fixtures/console-logs-noisy.json", import.meta.url)),
);

test("deduplicates repeated errors", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "error", limit: 20 });
    const mapErr = issues.find((e) => e.message.includes("Cannot read properties"));
    assert.ok(mapErr, "should include the map error");
    assert.equal(mapErr.count, 3);
});

test("strips React key warning noise", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "all", limit: 20 });
    const keyWarning = issues.find((e) => e.message.includes("unique"));
    assert.ok(!keyWarning, "React key warning should be filtered as noise");
});

test("strips HMR noise", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "all", limit: 20 });
    const hmr = issues.find((e) => e.message.includes("[HMR]"));
    assert.ok(!hmr, "HMR logs should be filtered as noise");
});

test("severity filter excludes warnings when set to error", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "error", limit: 20 });
    assert.ok(issues.every((e) => e.level === "error"));
});

test("respects limit", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "all", limit: 1 });
    assert.equal(issues.length, 1);
});

test("returns highest severity first", async () => {
    const { issues } = await deduplicateErrors(logs, { severity: "all", limit: 20 });
    assert.equal(issues[0].level, "error");
});

test("sourcemap resolver rewrites frame when map resolves", async () => {
    const fakeMap = JSON.stringify({
        version: 3,
        sources: ["src/ProductList.jsx"],
        names: ["fetchItems"],
        mappings: "AAAA,SAASA",
        file: "app.min.js",
    });
    const resolver = createResolver({ fetcher: async () => fakeMap });
    const minifiedLog = [
        {
            level: "error",
            text: "TypeError: oops",
            stackTrace: [
                {
                    functionName: "z",
                    url: "https://app.example.com/dist/app.min.js",
                    lineNumber: 1,
                    columnNumber: 0,
                },
            ],
        },
    ];
    const { issues, resolvedCount } = await deduplicateErrors(minifiedLog, {
        severity: "error",
        limit: 10,
        resolver,
    });
    assert.equal(resolvedCount, 1);
    assert.ok(issues[0].stackTrace[0].includes("src/ProductList.jsx"));
});

test("sourcemap resolver falls back silently when no map available", async () => {
    const resolver = createResolver({ fetcher: async () => null });
    const minifiedLog = [
        {
            level: "error",
            text: "TypeError: oops",
            stackTrace: [
                {
                    functionName: "z",
                    url: "https://app.example.com/dist/app.min.js",
                    lineNumber: 1,
                    columnNumber: 1234,
                },
            ],
        },
    ];
    const { issues, resolvedCount } = await deduplicateErrors(minifiedLog, {
        severity: "error",
        limit: 10,
        resolver,
    });
    assert.equal(resolvedCount, 0);
    assert.ok(issues[0].stackTrace[0].includes("app.min.js"));
});
