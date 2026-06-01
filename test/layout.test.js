import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLayoutIssues } from "../src/analysis/layout.js";

test("detects zero width", () => {
    const issues = detectLayoutIssues({
        width: "0px",
        height: "50px",
        position: "static",
        "z-index": "auto",
    });
    assert.ok(issues.some((i) => i.type === "zero-width" && i.severity === "high"));
});

test("detects zero height", () => {
    const issues = detectLayoutIssues({
        width: "100px",
        height: "0px",
        position: "static",
        "z-index": "auto",
    });
    assert.ok(issues.some((i) => i.type === "zero-height" && i.severity === "high"));
});

test("flags unanchored absolute position", () => {
    const issues = detectLayoutIssues({
        position: "absolute",
        top: "auto",
        right: "auto",
        bottom: "auto",
        left: "auto",
        width: "100px",
        height: "50px",
        "z-index": "auto",
    });
    assert.ok(issues.some((i) => i.type === "unanchored-positioned"));
});

test("no issue for anchored absolute position", () => {
    const issues = detectLayoutIssues({
        position: "absolute",
        top: "0px",
        right: "auto",
        bottom: "auto",
        left: "auto",
        width: "100px",
        height: "50px",
        "z-index": "auto",
    });
    assert.ok(!issues.some((i) => i.type === "unanchored-positioned"));
});

test("flags z-index on position:static", () => {
    const issues = detectLayoutIssues({
        position: "static",
        "z-index": "10",
        width: "100px",
        height: "50px",
    });
    assert.ok(issues.some((i) => i.type === "ineffective-z-index"));
});

test("no issue for z-index on positioned element", () => {
    const issues = detectLayoutIssues({
        position: "relative",
        "z-index": "10",
        width: "100px",
        height: "50px",
    });
    assert.ok(!issues.some((i) => i.type === "ineffective-z-index"));
});

test("flags overflow:hidden on flex container", () => {
    const issues = detectLayoutIssues({
        display: "flex",
        overflow: "hidden",
        width: "100px",
        height: "50px",
        position: "static",
        "z-index": "auto",
    });
    assert.ok(issues.some((i) => i.type === "flex-grid-overflow-hidden"));
});

test("no issues on clean element", () => {
    const issues = detectLayoutIssues({
        display: "block",
        position: "static",
        "z-index": "auto",
        width: "200px",
        height: "50px",
        overflow: "visible",
    });
    assert.equal(issues.length, 0);
});
