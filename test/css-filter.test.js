import { test } from "node:test";
import assert from "node:assert/strict";
import { filterComputedStyles } from "../src/analysis/css-filter.js";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/computed-styles-invisible.json", import.meta.url)),
);

test("keeps tier 1 properties", () => {
    const result = filterComputedStyles(fixture.result);
    assert.ok("display" in result);
    assert.ok("opacity" in result);
    assert.ok("overflow" in result);
    assert.ok("width" in result);
});

test("drops webkit prefixed properties", () => {
    const result = filterComputedStyles(fixture.result);
    assert.ok(!("-webkit-font-smoothing" in result));
    assert.ok(!("-webkit-tap-highlight-color" in result));
});

test("drops animation internals", () => {
    const result = filterComputedStyles(fixture.result);
    assert.ok(!("animation-duration" in result));
    assert.ok(!("animation-fill-mode" in result));
});

test("drops boring tier 2 values", () => {
    const result = filterComputedStyles(fixture.result);
    // background-color is rgba(0,0,0,0) which is transparent (boring, should be dropped)
    assert.ok(!("background-color" in result));
});

test("keeps interesting tier 2 values", () => {
    const result = filterComputedStyles({
        ...fixture.result,
        "background-color": "rgb(255, 0, 0)",
    });
    assert.ok("background-color" in result);
});

test("drops all tier 3 properties (webkit, animation internals, font-feature-settings)", () => {
    const result = filterComputedStyles(fixture.result);
    const tier3 = [
        "-webkit-font-smoothing",
        "-webkit-tap-highlight-color",
        "font-feature-settings",
        "animation-duration",
        "animation-fill-mode",
    ];
    for (const p of tier3) {
        assert.ok(!(p in result), `Expected ${p} to be dropped`);
    }
});
