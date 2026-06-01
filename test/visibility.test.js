import { test } from "node:test";
import assert from "node:assert/strict";
import { detectVisibilityIssues } from "../src/analysis/visibility.js";

test("detects opacity:0", () => {
    const issues = detectVisibilityIssues({
        opacity: "0",
        display: "block",
        visibility: "visible",
    });
    assert.ok(issues.some((i) => i.property === "opacity" && i.severity === "high"));
});

test("detects display:none", () => {
    const issues = detectVisibilityIssues({ display: "none", opacity: "1", visibility: "visible" });
    assert.ok(issues.some((i) => i.property === "display" && i.severity === "high"));
});

test("detects visibility:hidden", () => {
    const issues = detectVisibilityIssues({ visibility: "hidden", display: "block", opacity: "1" });
    assert.ok(issues.some((i) => i.property === "visibility" && i.severity === "high"));
});

test("detects zero-size with overflow:hidden", () => {
    const issues = detectVisibilityIssues({
        overflow: "hidden",
        width: "0px",
        height: "50px",
        opacity: "1",
        display: "block",
        visibility: "visible",
    });
    assert.ok(issues.some((i) => i.type === "clipped-zero-size"));
});

test("no issues on visible element", () => {
    const issues = detectVisibilityIssues({
        display: "block",
        opacity: "1",
        visibility: "visible",
        overflow: "visible",
        width: "100px",
        height: "50px",
    });
    assert.equal(issues.length, 0);
});

test("flags nearly-invisible opacity", () => {
    const issues = detectVisibilityIssues({
        opacity: "0.05",
        display: "block",
        visibility: "visible",
    });
    assert.ok(issues.some((i) => i.type === "nearly-invisible"));
});
