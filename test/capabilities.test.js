import { test } from "node:test";
import assert from "node:assert/strict";
import {
    pickTool,
    EVAL_TOOLS,
    EVAL_PATTERN,
    CONSOLE_TOOLS,
    CONSOLE_PATTERN,
    SNAPSHOT_TOOLS,
    SNAPSHOT_PATTERN,
} from "../src/capabilities.js";

test("prefers the known name over a pattern match", () => {
    const names = ["browser_evaluate", "evaluate_script", "click"];
    assert.equal(pickTool(names, EVAL_TOOLS, EVAL_PATTERN), "evaluate_script");
});

test("finds the playwright eval tool when chrome-devtools-mcp is not the backend", () => {
    const names = ["browser_snapshot", "browser_evaluate", "browser_click"];
    assert.equal(pickTool(names, EVAL_TOOLS, EVAL_PATTERN), "browser_evaluate");
    assert.equal(pickTool(names, SNAPSHOT_TOOLS, SNAPSHOT_PATTERN), "browser_snapshot");
});

test("falls back to the pattern for an unknown backend", () => {
    assert.equal(pickTool(["run_execute_script"], EVAL_TOOLS, EVAL_PATTERN), "run_execute_script");
    assert.equal(pickTool(["page_a11y_tree"], SNAPSHOT_TOOLS, SNAPSHOT_PATTERN), "page_a11y_tree");
    assert.equal(pickTool(["dump_console"], CONSOLE_TOOLS, CONSOLE_PATTERN), "dump_console");
});

test("returns null when the backend has nothing matching", () => {
    assert.equal(pickTool(["click", "navigate"], EVAL_TOOLS, EVAL_PATTERN), null);
});
