import { test } from "node:test";
import assert from "node:assert/strict";
import { detectVisibilityIssues, detectObstructionIssues } from "../src/analysis/visibility.js";

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

test("flags an element covered by another element", () => {
    const issues = detectObstructionIssues({
        obstruction: {
            selector: "div#modal-backdrop",
            position: "fixed",
            zIndex: "999",
            coversViewport: true,
        },
        offScreen: false,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].type, "obscured");
    assert.equal(issues[0].severity, "high");
    assert.equal(issues[0].value, "div#modal-backdrop");
    assert.ok(issues[0].note.includes("covers the viewport"));
});

test("describes a partial cover differently from a full-viewport one", () => {
    const issues = detectObstructionIssues({
        obstruction: {
            selector: "span.tooltip",
            position: "absolute",
            zIndex: "10",
            coversViewport: false,
        },
    });
    assert.ok(issues[0].note.includes("sits on top"));
    assert.ok(!issues[0].note.includes("covers the viewport"));
});

test("reports off-screen elements instead of a false obstruction", () => {
    const issues = detectObstructionIssues({ obstruction: null, offScreen: true });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].type, "off-screen");
    assert.equal(issues[0].severity, "low");
});

test("no obstruction issue for an unobstructed element", () => {
    assert.deepEqual(detectObstructionIssues({ obstruction: null, offScreen: false }), []);
});

test("tolerates a result carrying no hit test at all", () => {
    assert.deepEqual(detectObstructionIssues({}), []);
    assert.deepEqual(detectObstructionIssues(), []);
});
