/**
 * Parses accessibility-tree snapshots from browser MCP backends and compresses
 * them into a page outline.
 *
 * Snapshot formats differ per backend but share an indentation-based tree of
 * `role "name"` lines carrying a backend-specific element reference. Those
 * references are how the assistant acts on an element afterwards, so they are
 * preserved verbatim through compression.
 */

const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "listbox",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "spinbutton",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "textarea",
]);

const LANDMARK_ROLES = new Set([
    "main",
    "navigation",
    "banner",
    "contentinfo",
    "complementary",
    "region",
    "search",
    "form",
    "dialog",
    "alertdialog",
]);

const ALERT_ROLES = new Set(["alert", "status", "log"]);

// Repetition lives on these containers. Keeping them preserves the grouping that
// lets identical siblings fold into a count instead of flattening into an
// alternating run that no longer looks repetitive.
const STRUCTURAL_ROLES = new Set(["list", "listitem", "table", "row", "article"]);

// Names longer than this are truncated; the tail is rarely what identifies an element.
const MAX_NAME_LENGTH = 60;

const UID_PREFIX = /^uid=(\S+)\s*/;
const REF_BRACKET = /\[ref=([^\]]+)\]/;
const LEVEL_BRACKET = /\[level=(\d+)\]/;
const QUOTED_NAME = /"([^"]*)"/;
const TRAILING_TEXT = /:\s*(\S.*)$/;
const ROLE_TOKEN = /^([A-Za-z][\w-]*)/;

// Metadata and formatting lines that carry no tree node.
const SKIP_LINE = /^(```|#|\/url:|Page (URL|Title|Snapshot))/i;

export function parseSnapshot(text) {
    const roots = [];
    const stack = [];
    let total = 0;

    for (const line of String(text).split("\n")) {
        const parsed = parseLine(line);
        if (!parsed) {
            continue;
        }
        total++;

        const node = { ...parsed.node, children: [] };

        while (stack.length && stack[stack.length - 1].depth >= parsed.depth) {
            stack.pop();
        }

        if (stack.length) {
            stack[stack.length - 1].node.children.push(node);
        } else {
            roots.push(node);
        }

        stack.push({ depth: parsed.depth, node });
    }

    return { roots, total };
}

function parseLine(rawLine) {
    if (!rawLine.trim()) {
        return null;
    }

    // Indent width varies by backend; halving keeps depths monotonic either way.
    const depth = Math.floor((rawLine.match(/^\s*/)?.[0].length ?? 0) / 2);

    let s = rawLine.trim();
    if (s.startsWith("- ")) {
        s = s.slice(2).trim();
    }

    if (SKIP_LINE.test(s)) {
        return null;
    }

    let ref = null;

    const uid = s.match(UID_PREFIX);
    if (uid) {
        ref = uid[1];
        s = s.slice(uid[0].length);
    }

    const bracket = s.match(REF_BRACKET);
    if (bracket) {
        ref = bracket[1];
    }

    const role = s.match(ROLE_TOKEN)?.[1];
    if (!role) {
        return null;
    }

    // Quoted names come first; some backends instead put bare text after a colon.
    const name =
        s.match(QUOTED_NAME)?.[1] ?? s.replace(/\[[^\]]*\]/g, "").match(TRAILING_TEXT)?.[1];
    const level = s.match(LEVEL_BRACKET)?.[1];

    return {
        depth,
        node: {
            role,
            name: name ? truncate(name) : null,
            ref,
            level: level ? Number(level) : null,
        },
    };
}

function truncate(name) {
    const clean = name.trim().replace(/\s+/g, " ");
    return clean.length > MAX_NAME_LENGTH ? clean.slice(0, MAX_NAME_LENGTH) + "…" : clean;
}

function isHeading(node) {
    return node.role === "heading" || /^h[1-6]$/.test(node.role);
}

function isKept(node, include) {
    if (include === "all") {
        return true;
    }

    const role = node.role;
    return (
        INTERACTIVE_ROLES.has(role) ||
        LANDMARK_ROLES.has(role) ||
        ALERT_ROLES.has(role) ||
        STRUCTURAL_ROLES.has(role) ||
        isHeading(node)
    );
}

// Icon-only controls carry their label on a child node that compression drops,
// so an unnamed control inherits the first name below it. Containers are excluded:
// a landmark named after its first link reads as a label it does not actually have.
function borrowName(node) {
    for (const child of node.children) {
        if (child.name) {
            return child.name;
        }
        const nested = borrowName(child);
        if (nested) {
            return nested;
        }
    }
    return null;
}

function pruneNodes(nodes, include) {
    const out = [];

    for (const node of nodes) {
        const children = pruneNodes(node.children, include);

        // A structural container earns its place only by holding something kept.
        const empty = STRUCTURAL_ROLES.has(node.role) && children.length === 0;

        if (isKept(node, include) && !empty) {
            const name = node.name ?? (INTERACTIVE_ROLES.has(node.role) ? borrowName(node) : null);
            out.push({
                role: node.role,
                name,
                ref: node.ref,
                level: node.level,
                children,
            });
        } else {
            // Wrapper with nothing of its own to say: splice its children upward.
            out.push(...children);
        }
    }

    return out;
}

function signature(node) {
    return `${node.role}|${node.children.map((c) => c.role).join(",")}`;
}

// Repeated siblings (feed items, table rows, product cards) dominate real pages,
// so a run of structurally identical nodes collapses to a few plus a count.
function foldRepeats(nodes, keepPerGroup = 3) {
    const out = [];
    let i = 0;

    while (i < nodes.length) {
        const sig = signature(nodes[i]);
        let j = i;
        while (j < nodes.length && signature(nodes[j]) === sig) {
            j++;
        }

        const groupSize = j - i;
        // Folding only pays off once the marker replaces more than one node.
        const shown = groupSize > keepPerGroup + 1 ? keepPerGroup : groupSize;

        for (let k = i; k < i + shown; k++) {
            out.push({ ...nodes[k], children: foldRepeats(nodes[k].children, keepPerGroup) });
        }

        if (groupSize > shown) {
            out.push({
                role: nodes[i].role,
                name: null,
                ref: null,
                level: null,
                repeated: groupSize - shown,
                children: [],
            });
        }

        i = j;
    }

    return out;
}

function applyLimit(nodes, budget) {
    const out = [];

    for (const node of nodes) {
        if (budget.left <= 0) {
            break;
        }
        budget.left--;
        out.push({ ...node, children: applyLimit(node.children, budget) });
    }

    return out;
}

export function countNodes(nodes) {
    return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);
}

// Empty and null fields are dead weight in a payload whose whole purpose is to be small.
function compact(nodes) {
    return nodes.map((node) => {
        const out = { role: node.role };
        if (node.name) {
            out.name = node.name;
        }
        if (node.ref) {
            out.ref = node.ref;
        }
        if (node.level) {
            out.level = node.level;
        }
        if (node.repeated) {
            out.repeated = node.repeated;
        }
        if (node.children?.length) {
            out.children = compact(node.children);
        }
        return out;
    });
}

export function compressOutline(roots, { include = "interactive", limit = 150 } = {}) {
    const pruned = pruneNodes(roots, include);
    const folded = foldRepeats(pruned);
    const budget = { left: limit };
    const outline = compact(applyLimit(folded, budget));

    return { outline, kept: countNodes(outline) };
}

export function summarizeOutline(outline) {
    const counts = { interactive: 0, landmarks: 0, headings: 0, alerts: 0 };

    const walk = (nodes) => {
        for (const node of nodes) {
            if (INTERACTIVE_ROLES.has(node.role)) {
                counts.interactive++;
            } else if (LANDMARK_ROLES.has(node.role)) {
                counts.landmarks++;
            } else if (ALERT_ROLES.has(node.role)) {
                counts.alerts++;
            } else if (isHeading(node)) {
                counts.headings++;
            }
            walk(node.children ?? []);
        }
    };
    walk(outline);

    return counts;
}
