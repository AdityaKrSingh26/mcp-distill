import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScript } from "../src/tools/diagnose-element.js";

// The script runs in the browser, so it is exercised here against the small
// surface of the DOM it actually touches. This is what catches a syntax error
// or a bad hit test before it reaches a real page.
function makeElement({ tag = "div", id = "", classes = [], rect, styles = {} }) {
    const el = {
        tagName: tag.toUpperCase(),
        id,
        classList: classes,
        children: [],
        styles,
        parentElement: null,
        getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, ...rect }),
        contains(other) {
            return other === el || el.children.some((c) => c.contains(other));
        },
    };
    return el;
}

// Links a target to its ancestors, outermost last, the way parentElement walks.
function nest(target, ...ancestors) {
    let child = target;
    for (const ancestor of ancestors) {
        ancestor.children.push(child);
        child.parentElement = ancestor;
        child = ancestor;
    }
    return target;
}

function makeEnv({ elements = {}, hit = null, viewport = { width: 1000, height: 800 } }) {
    const styleFor = (el) => {
        const entries = Object.entries(el.styles ?? {});
        const decl = {
            length: entries.length,
            getPropertyValue: (prop) => el.styles?.[prop] ?? "",
            position: el.styles?.position ?? "static",
            zIndex: el.styles?.["z-index"] ?? "auto",
            display: el.styles?.display ?? "block",
            opacity: el.styles?.opacity ?? "1",
            visibility: el.styles?.visibility ?? "visible",
            overflowX: el.styles?.["overflow-x"] ?? "visible",
            overflowY: el.styles?.["overflow-y"] ?? "visible",
            pointerEvents: el.styles?.["pointer-events"] ?? "auto",
        };
        entries.forEach(([prop], i) => {
            decl[i] = prop;
        });
        return decl;
    };

    const document = {
        querySelector: (sel) => elements[sel] ?? null,
        querySelectorAll: () => [],
        elementFromPoint: () => hit,
    };
    const window = {
        innerWidth: viewport.width,
        innerHeight: viewport.height,
        getComputedStyle: styleFor,
    };
    return { document, window };
}

function run(script, env) {
    const fn = new Function("window", "document", `return (${script})();`);
    return fn(env.window, env.document);
}

test("the generated script is syntactically valid javascript", () => {
    assert.doesNotThrow(() => new Function(`return (${buildScript(["#a", ".b"])});`));
});

test("reports no obstruction when the element itself is hit", () => {
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40, top: 10, left: 10 },
        styles: { display: "block", position: "static" },
    });
    const env = makeEnv({ elements: { "#submit": target }, hit: target });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].obstruction, null);
    assert.equal(results[0].offScreen, false);
});

test("reports no obstruction when a descendant is hit", () => {
    const child = makeElement({ tag: "span", rect: { width: 10, height: 10 } });
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40, top: 10, left: 10 },
    });
    target.children.push(child);
    const env = makeEnv({ elements: { "#submit": target }, hit: child });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].obstruction, null);
});

test("identifies an unrelated element covering the target", () => {
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40, top: 10, left: 10 },
    });
    const overlay = makeElement({
        tag: "div",
        id: "modal-backdrop",
        rect: { width: 1000, height: 800, top: 0, left: 0 },
        styles: { position: "fixed", "z-index": "999" },
    });
    const env = makeEnv({ elements: { "#submit": target }, hit: overlay });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].obstruction.selector, "div#modal-backdrop");
    assert.equal(results[0].obstruction.position, "fixed");
    assert.equal(results[0].obstruction.zIndex, "999");
    assert.equal(results[0].obstruction.coversViewport, true);
});

test("names a blocker by its first class when it has no id", () => {
    const target = makeElement({ tag: "button", id: "submit", rect: { width: 50, height: 20 } });
    const overlay = makeElement({
        tag: "span",
        classes: ["tooltip", "visible"],
        rect: { width: 50, height: 20 },
    });
    const env = makeEnv({ elements: { "#submit": target }, hit: overlay });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].obstruction.selector, "span.tooltip");
    assert.equal(results[0].obstruction.coversViewport, false);
});

test("marks an element below the fold as off-screen without hit testing", () => {
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40, top: 5000, left: 10 },
    });
    const overlay = makeElement({ tag: "div", id: "wrong", rect: { width: 10, height: 10 } });
    const env = makeEnv({ elements: { "#submit": target }, hit: overlay });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].offScreen, true);
    assert.equal(results[0].obstruction, null, "must not report a blocker it never tested");
});

test("skips the hit test for zero-size elements", () => {
    const target = makeElement({ tag: "div", id: "empty", rect: { width: 0, height: 0 } });
    const overlay = makeElement({ tag: "div", id: "other", rect: { width: 10, height: 10 } });
    const env = makeEnv({ elements: { "#empty": target }, hit: overlay });

    const { results } = run(buildScript(["#empty"]), env);
    assert.equal(results[0].obstruction, null);
    assert.equal(results[0].offScreen, false);
});

test("still reports missing elements as not found", () => {
    const env = makeEnv({ elements: {} });
    const { results } = run(buildScript(["#nope"]), env);
    assert.equal(results[0].notFound, true);
});

test("collects computed styles for the target", () => {
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40 },
        styles: { display: "flex", opacity: "0" },
    });
    const env = makeEnv({ elements: { "#submit": target }, hit: target });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].styles.display, "flex");
    assert.equal(results[0].styles.opacity, "0");
});

test("names an invisible ancestor the element's own styles cannot reveal", () => {
    const target = makeElement({
        tag: "button",
        id: "submit",
        rect: { width: 100, height: 40 },
        styles: { display: "block", opacity: "1", visibility: "visible" },
    });
    const wrapper = makeElement({
        tag: "div",
        classes: ["inner"],
        rect: { width: 100, height: 40 },
    });
    const modal = makeElement({
        tag: "div",
        id: "modal",
        rect: { width: 100, height: 40 },
        styles: { opacity: "0" },
    });
    nest(target, wrapper, modal);
    const env = makeEnv({ elements: { "#submit": target }, hit: target });

    const { results } = run(buildScript(["#submit"]), env);
    assert.deepEqual(results[0].ancestors, [{ selector: "div#modal", depth: 2, opacity: "0" }]);
});

test("reports a collapsed accordion wrapper as clipping", () => {
    const target = makeElement({ tag: "a", id: "link", rect: { width: 80, height: 20 } });
    const panel = makeElement({
        tag: "section",
        classes: ["panel"],
        rect: { width: 300, height: 0 },
        styles: { "overflow-y": "hidden" },
    });
    nest(target, panel);
    const env = makeEnv({ elements: { "#link": target }, hit: target });

    const { results } = run(buildScript(["#link"]), env);
    assert.deepEqual(results[0].ancestors, [
        { selector: "section.panel", depth: 1, collapsed: "0 height" },
    ]);
});

test("returns no ancestors when every wrapper is healthy", () => {
    const target = makeElement({ tag: "button", id: "submit", rect: { width: 100, height: 40 } });
    const wrapper = makeElement({ tag: "div", rect: { width: 200, height: 100 } });
    nest(target, wrapper);
    const env = makeEnv({ elements: { "#submit": target }, hit: target });

    const { results } = run(buildScript(["#submit"]), env);
    assert.deepEqual(results[0].ancestors, []);
});

test("stops after three hiding ancestors", () => {
    const target = makeElement({ tag: "button", id: "submit", rect: { width: 10, height: 10 } });
    const hidden = () =>
        makeElement({ tag: "div", rect: { width: 10, height: 10 }, styles: { display: "none" } });
    nest(target, hidden(), hidden(), hidden(), hidden());
    const env = makeEnv({ elements: { "#submit": target }, hit: target });

    const { results } = run(buildScript(["#submit"]), env);
    assert.equal(results[0].ancestors.length, 3);
});
