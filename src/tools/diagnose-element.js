import { callTool } from "../client.js";
import { filterComputedStyles } from "../analysis/css-filter.js";
import { detectVisibilityIssues } from "../analysis/visibility.js";
import { detectLayoutIssues } from "../analysis/layout.js";

export async function handleDiagnoseElement({ selector, include_box_model }) {
    const selectors = Array.isArray(selector) ? selector : [selector];
    const isBatch = Array.isArray(selector);

    let raw;
    try {
        const selectorsJson = JSON.stringify(selectors);
        raw = await callTool("evaluate_script", {
            function: `() => {
        const selectors = ${selectorsJson};
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
          return { selector: sel, styles, rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left } };
        });
        return { results };
      }`,
        });
    } catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        _lens_warning: `Could not fetch computed styles: ${err.message}`,
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
                    text: JSON.stringify(
                        {
                            summary: r.summary,
                            details: r.details,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    }

    const summary = buildBatchSummary(results);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    {
                        summary,
                        details: { results: results.map((r) => r.details) },
                    },
                    null,
                    2,
                ),
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
    const allIssues = [...visibilityIssues, ...layoutIssues];

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
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        const parsed = JSON.parse(jsonText);
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
