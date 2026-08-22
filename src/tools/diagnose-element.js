import { callTool } from "../client.js";
import { findBackendTool, EVAL_TOOLS, EVAL_PATTERN } from "../capabilities.js";
import { filterComputedStyles } from "../analysis/css-filter.js";
import {
    detectVisibilityIssues,
    detectObstructionIssues,
    detectAncestorIssues,
} from "../analysis/visibility.js";
import { detectLayoutIssues } from "../analysis/layout.js";
import { parseFencedJson } from "../util.js";

export async function handleDiagnoseElement({ selector, include_box_model }) {
    const selectors = Array.isArray(selector) ? selector : [selector];
    const isBatch = Array.isArray(selector);

    const evalTool = await findBackendTool(EVAL_TOOLS, EVAL_PATTERN);
    if (!evalTool) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        _lens_warning:
                            "No script evaluation tool found on the backend MCP. Expected one of: " +
                            EVAL_TOOLS.join(", "),
                        selector,
                    }),
                },
            ],
        };
    }

    let raw;
    try {
        raw = await callTool(evalTool, { function: buildScript(selectors) });
    } catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        _lens_warning: `Could not fetch computed styles via ${evalTool}: ${err.message}`,
                        selector,
                    }),
                },
            ],
        };
    }

    let parsed;
    try {
        parsed = extractPayload(raw);
    } catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        _lens_warning: `Style extraction failed: ${err.message}`,
                        raw,
                    }),
                },
            ],
        };
    }

    const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
    const results = rawResults.map((r) => buildResult(r, include_box_model));

    if (!isBatch) {
        const r = results[0];
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ summary: r.summary, details: r.details }),
                },
            ],
        };
    }

    const summary = buildBatchSummary(results);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    summary,
                    details: { results: results.map((r) => r.details) },
                }),
            },
        ],
    };
}

function buildResult(r, include_box_model) {
    if (r.notFound) {
        const summary = r.suggestions?.length
            ? `${r.selector}: element not found. Closest matches: ${r.suggestions.join(", ")}`
            : `${r.selector}: element not found, no similar selectors detected.`;
        return {
            summary,
            details: { selector: r.selector, not_found: true, suggestions: r.suggestions ?? [] },
            issues: [],
        };
    }

    const filtered = filterComputedStyles(r.styles ?? {});
    const visibilityIssues = detectVisibilityIssues(filtered);
    const layoutIssues = detectLayoutIssues(filtered);
    const obstructionIssues = detectObstructionIssues(r);
    const ancestorIssues = detectAncestorIssues(r.ancestors);

    // A hidden ancestor gives every descendant a 0x0 box, so the element's own
    // zero-size issues are a symptom of it rather than a second cause.
    const hiddenByAncestor = ancestorIssues.some(
        (i) => i.type === "ancestor-hidden" || i.type === "ancestor-invisible",
    );
    const ownLayoutIssues = hiddenByAncestor
        ? layoutIssues.filter((i) => i.type !== "zero-width" && i.type !== "zero-height")
        : layoutIssues;

    const allIssues = [
        ...ancestorIssues,
        ...visibilityIssues,
        ...ownLayoutIssues,
        ...obstructionIssues,
    ];

    if (!include_box_model) {
        for (const p of [
            "margin",
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "padding",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border",
            "border-width",
        ]) {
            delete filtered[p];
        }
    }

    return {
        summary: buildSummary(r.selector, allIssues, filtered),
        details: { selector: r.selector, issues: allIssues, styles: filtered },
        issues: allIssues,
    };
}

function buildBatchSummary(results) {
    const withIssues = results.filter((r) => r.issues.length > 0);
    const notFound = results.filter((r) => r.details.not_found);
    const rankOrder = { high: 3, medium: 2, low: 1 };
    let top = null;
    for (const r of results) {
        for (const issue of r.issues) {
            if (!top || (rankOrder[issue.severity] ?? 0) > (rankOrder[top.issue.severity] ?? 0)) {
                top = { selector: r.details.selector, issue };
            }
        }
    }
    let summary = `${results.length} element${results.length > 1 ? "s" : ""} diagnosed, ${withIssues.length} with issues`;
    if (notFound.length) {
        summary += `, ${notFound.length} not found`;
    }
    if (top) {
        summary += `. Top: ${top.selector} ${top.issue.property}:${top.issue.value}`;
    }
    return summary + ".";
}

function extractPayload(raw) {
    if (raw?.content?.[0]?.text) {
        const text = raw.content[0].text;
        const parsed = parseFencedJson(text);
        if (parsed === null) {
            throw new Error("Script returned null");
        }
        if (parsed?.results) {
            return parsed;
        }
        if (parsed?.result?.results) {
            return parsed.result;
        }
    }
    if (raw?.results) {
        return raw;
    }
    if (raw?.result?.results) {
        return raw.result;
    }
    throw new Error(`Unrecognized response shape: ${JSON.stringify(raw).slice(0, 200)}`);
}

function buildSummary(selector, issues, styles) {
    if (issues.length === 0) {
        return `${selector}: No obvious visual issues detected. display:${styles.display ?? "?"}, opacity:${styles.opacity ?? "?"}, visibility:${styles.visibility ?? "?"}.`;
    }

    const high = issues.filter((i) => i.severity === "high");
    const others = issues.filter((i) => i.severity !== "high");

    const parts = [];
    if (high.length) {
        parts.push(high.map((i) => `${i.property}:${i.value}`).join(", ") + " (likely cause)");
    }
    if (others.length) {
        parts.push(others.map((i) => i.note ?? `${i.property}:${i.value}`).join("; "));
    }

    return `${selector}: ${parts.join("; ")}`;
}

// The page-side script. Kept as one payload so a batch of selectors costs a single
// round-trip, and exported so its syntax and hit-test logic stay under test.
export function buildScript(selectors) {
    return `() => {
        const selectors = ${JSON.stringify(selectors)};
        function suggest(sel) {
          const out = new Set();
          const idTokens = [...sel.matchAll(/#([\\w-]+)/g)].map(m => m[1].toLowerCase());
          const classTokens = [...sel.matchAll(/\\.([\\w-]+)/g)].map(m => m[1].toLowerCase());
          if (idTokens.length) {
            document.querySelectorAll('[id]').forEach(el => {
              const id = el.id.toLowerCase();
              for (const t of idTokens) {
                if (id === t || id.includes(t) || t.includes(id)) out.add('#' + el.id);
              }
            });
          }
          if (classTokens.length) {
            const seen = new Set();
            document.querySelectorAll('[class]').forEach(el => {
              el.classList.forEach(c => {
                if (seen.has(c)) return;
                seen.add(c);
                const lc = c.toLowerCase();
                for (const t of classTokens) {
                  if (lc === t || lc.includes(t) || t.includes(lc)) out.add('.' + c);
                }
              });
            });
          }
          const tokens = [...idTokens, ...classTokens];
          const refLen = tokens.length ? Math.max(...tokens.map(t => t.length)) : 0;
          return [...out].sort((a, b) => Math.abs(a.length - refLen) - Math.abs(b.length - refLen)).slice(0, 5);
        }
        function describe(el) {
          const tag = el.tagName.toLowerCase();
          if (el.id) return tag + '#' + el.id;
          if (el.classList.length) return tag + '.' + el.classList[0];
          return tag;
        }
        // Only ancestors that can hide or block a descendant are returned: an
        // opacity:0 wrapper is invisible from the element's own computed style,
        // which is why element-only inspection reports "no issues" on it.
        function hidingAncestors(el) {
          const out = [];
          let node = el.parentElement;
          let depth = 1;
          while (node && out.length < 3) {
            const s = window.getComputedStyle(node);
            const r = node.getBoundingClientRect();
            const flags = {};
            if (s.display === 'none') flags.display = 'none';
            const op = parseFloat(s.opacity);
            if (!isNaN(op) && op === 0) flags.opacity = s.opacity;
            if (s.visibility === 'hidden' || s.visibility === 'collapse') flags.visibility = s.visibility;
            if (s.overflowY === 'hidden' && r.height === 0) flags.collapsed = '0 height';
            else if (s.overflowX === 'hidden' && r.width === 0) flags.collapsed = '0 width';
            if (s.pointerEvents === 'none') flags.pointerEvents = 'none';
            if (Object.keys(flags).length) out.push(Object.assign({ selector: describe(node), depth }, flags));
            node = node.parentElement;
            depth++;
          }
          return out;
        }
        function hitTest(el, rect) {
          if (rect.width <= 0 || rect.height <= 0) return { obstruction: null, offScreen: false };
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
            return { obstruction: null, offScreen: true };
          }
          const hit = document.elementFromPoint(cx, cy);
          // A descendant on top is normal: the click still lands inside the element.
          if (!hit || hit === el || el.contains(hit)) return { obstruction: null, offScreen: false };
          const hs = window.getComputedStyle(hit);
          const hr = hit.getBoundingClientRect();
          return {
            obstruction: {
              selector: describe(hit),
              position: hs.position,
              zIndex: hs.zIndex,
              coversViewport: hr.width >= window.innerWidth * 0.9 && hr.height >= window.innerHeight * 0.9,
            },
            offScreen: false,
          };
        }
        const results = selectors.map(sel => {
          let el = null;
          try { el = document.querySelector(sel); } catch (e) { return { selector: sel, notFound: true, error: e.message, suggestions: [] }; }
          if (!el) return { selector: sel, notFound: true, suggestions: suggest(sel) };
          const cs = window.getComputedStyle(el);
          const styles = {};
          for (let i = 0; i < cs.length; i++) {
            const prop = cs[i];
            styles[prop] = cs.getPropertyValue(prop);
          }
          const rect = el.getBoundingClientRect();
          const ht = hitTest(el, rect);
          return { selector: sel, styles, rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }, obstruction: ht.obstruction, offScreen: ht.offScreen, ancestors: hidingAncestors(el) };
        });
        return { results };
      }`;
}
