import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    parseSnapshot,
    compressOutline,
    summarizeOutline,
    countNodes,
} from "../src/analysis/outline.js";

const ariaSnapshot = readFileSync(new URL("./fixtures/snapshot-aria.txt", import.meta.url), "utf8");
const uidSnapshot = readFileSync(new URL("./fixtures/snapshot-uid.txt", import.meta.url), "utf8");

function flatten(nodes) {
    return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

test("parses the aria snapshot format into a tree", () => {
    const { roots, total } = parseSnapshot(ariaSnapshot);
    assert.equal(roots.length, 1);
    assert.ok(total > 20);
    assert.equal(roots[0].role, "generic");
});

test("parses the uid snapshot format into a tree", () => {
    const { roots } = parseSnapshot(uidSnapshot);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].role, "RootWebArea");
    assert.equal(roots[0].name, "Checkout");
});

test("skips metadata and fence lines", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const roles = flatten(roots).map((n) => n.role);
    assert.ok(!roles.some((r) => /^Page$/i.test(r)));
});

test("preserves element refs through compression", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const button = flatten(outline).find((n) => n.name === "Place order");
    assert.ok(button, "button should survive compression");
    assert.equal(button.ref, "e28");
});

test("preserves uid refs through compression", () => {
    const { roots } = parseSnapshot(uidSnapshot);
    const { outline } = compressOutline(roots);
    const textbox = flatten(outline).find((n) => n.role === "textbox");
    assert.equal(textbox.ref, "1_9");
});

test("drops unnamed wrapper nodes", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    assert.ok(!flatten(outline).some((n) => n.role === "generic"));
});

test("keeps landmarks, headings, and interactive elements", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const roles = flatten(outline).map((n) => n.role);
    assert.ok(roles.includes("main"));
    assert.ok(roles.includes("navigation"));
    assert.ok(roles.includes("heading"));
    assert.ok(roles.includes("button"));
    assert.ok(roles.includes("textbox"));
});

test("keeps heading level", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const heading = flatten(outline).find((n) => n.role === "heading");
    assert.equal(heading.level, 1);
});

test("captures unquoted trailing text as the accessible name", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const alert = flatten(outline).find((n) => n.role === "alert");
    assert.equal(alert.name, "Payment method declined");
});

test("borrows a name from a descendant for unnamed controls", () => {
    const { roots } = parseSnapshot(uidSnapshot);
    const { outline } = compressOutline(roots);
    const button = flatten(outline).find((n) => n.role === "button");
    assert.equal(button.name, "Place order");
});

test("does not borrow a descendant name for landmark containers", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const banner = flatten(outline).find((n) => n.role === "banner");
    const main = flatten(outline).find((n) => n.role === "main");
    assert.equal(banner.name, undefined, "banner has no label of its own");
    assert.equal(main.name, undefined, "main has no label of its own");
});

test("omits empty and null fields from the payload", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    for (const node of flatten(outline)) {
        assert.ok(!("level" in node) || typeof node.level === "number");
        assert.ok(!("children" in node) || node.children.length > 0);
        assert.ok(!("name" in node) || typeof node.name === "string");
    }
    assert.ok(!JSON.stringify(outline).includes("null"));
});

test("folds repeated sibling runs into a count", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots, { include: "all" });
    const marker = flatten(outline).find((n) => n.repeated);
    assert.ok(marker, "expected a folded marker for the 7 repeated listitems");
    assert.equal(marker.role, "listitem");
    assert.equal(marker.repeated, 4);
});

test("folds repeated list items in the default interactive mode", () => {
    // Keeping list structure is what makes repetition visible: without it the
    // children flatten into an alternating run that never looks repetitive.
    const lines = ["- main [ref=e1]:", "  - list [ref=e2]:"];
    for (let i = 0; i < 40; i++) {
        lines.push(`    - listitem [ref=e${i * 3 + 3}]:`);
        lines.push(`      - link "Product ${i}" [ref=e${i * 3 + 4}]`);
        lines.push(`      - button "Add to cart" [ref=e${i * 3 + 5}]`);
    }

    const { roots } = parseSnapshot(lines.join("\n"));
    const { outline, kept } = compressOutline(roots);

    const marker = flatten(outline).find((n) => n.repeated);
    assert.ok(marker, "expected repeated listitems to fold");
    assert.equal(marker.repeated, 37);
    assert.ok(kept < 20, `expected a small outline, got ${kept} nodes`);
});

test("drops structural containers holding nothing worth keeping", () => {
    const { roots } = parseSnapshot(
        "- main [ref=e1]:\n  - list [ref=e2]:\n    - listitem [ref=e3]",
    );
    const { outline } = compressOutline(roots);
    assert.ok(!flatten(outline).some((n) => n.role === "list"));
});

test("does not fold short sibling runs", () => {
    const { roots } = parseSnapshot(uidSnapshot);
    const { outline } = compressOutline(roots, { include: "all" });
    assert.ok(!flatten(outline).some((n) => n.repeated));
});

test("compresses substantially versus the raw node count", () => {
    const { roots, total } = parseSnapshot(ariaSnapshot);
    const { kept } = compressOutline(roots);
    assert.ok(kept < total / 2, `expected heavy reduction, kept ${kept} of ${total}`);
});

test("respects the node limit", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots, { include: "all", limit: 5 });
    assert.equal(countNodes(outline), 5);
});

test("truncates very long accessible names", () => {
    const long = 'button "' + "x".repeat(200) + '" [ref=e1]';
    const { roots } = parseSnapshot(long);
    assert.ok(roots[0].name.length < 70);
    assert.ok(roots[0].name.endsWith("…"));
});

test("summarize counts each category", () => {
    const { roots } = parseSnapshot(ariaSnapshot);
    const { outline } = compressOutline(roots);
    const counts = summarizeOutline(outline);
    assert.equal(counts.headings, 1);
    assert.equal(counts.alerts, 1);
    assert.ok(counts.interactive >= 5);
    assert.ok(counts.landmarks >= 3);
});
