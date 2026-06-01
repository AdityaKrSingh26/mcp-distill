// Tier 1: always include (these are the properties that cause visible bugs)
const TIER1 = new Set([
    "display",
    "visibility",
    "opacity",
    "position",
    "z-index",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "overflow",
    "overflow-x",
    "overflow-y",
    "top",
    "right",
    "bottom",
    "left",
    "flex",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "align-items",
    "align-self",
    "justify-content",
    "justify-self",
    "grid-template-columns",
    "grid-template-rows",
    "grid-column",
    "grid-row",
    "transform",
    "clip-path",
    "clip",
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
    "border-style",
    "border-color",
    "box-sizing",
    "pointer-events",
]);

// Tier 2: include only if value looks anomalous
const TIER2 = new Set([
    "color",
    "background-color",
    "background",
    "font-size",
    "font-weight",
    "line-height",
    "text-align",
    "cursor",
    "box-shadow",
    "outline",
]);

// Default values that aren't interesting
const BORING_TIER2 = new Set([
    "rgba(0, 0, 0, 0)",
    "transparent",
    "none",
    "normal",
    "auto",
    "rgb(0, 0, 0)",
    "0px",
    "inherit",
    "initial",
]);

export function filterComputedStyles(styles) {
    const result = {};

    for (const [prop, value] of Object.entries(styles)) {
        if (TIER1.has(prop)) {
            result[prop] = value;
        } else if (TIER2.has(prop) && !BORING_TIER2.has(value)) {
            result[prop] = value;
        }
        // Tier 3 (everything else, webkit prefixes, SVG internals, etc.): dropped
    }

    return result;
}
