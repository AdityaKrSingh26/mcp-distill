export function detectLayoutIssues(styles) {
    const issues = [];

    // Overflow clipping a flex/grid container that has no defined size
    if ((styles.display === "flex" || styles.display === "grid") && styles.overflow === "hidden") {
        
        issues.push({
            type: "flex-grid-overflow-hidden",
            property: "overflow",
            value: "hidden",
            severity: "low",
            note: "overflow:hidden on a flex/grid container can clip children unexpectedly",
        });

    }

    // Width/height of 0 without explicit zero intent
    const w = parseFloat(styles.width);
    const h = parseFloat(styles.height);
    
    if (!isNaN(w) && w === 0 && styles["min-width"] !== "0px" && styles["max-width"] !== "0px") {
        issues.push({
            type: "zero-width",
            property: "width",
            value: styles.width,
            severity: "high",
        });
    }
    
    if (!isNaN(h) && h === 0 && styles["min-height"] !== "0px") {
        issues.push({
            type: "zero-height",
            property: "height",
            value: styles.height,
            severity: "high",
        });
    }

    // Position absolute/fixed with no anchor (could float off screen)
    if (styles.position === "absolute" || styles.position === "fixed") {
        
        const hasTop = styles.top && styles.top !== "auto";
        const hasLeft = styles.left && styles.left !== "auto";
        const hasRight = styles.right && styles.right !== "auto";
        const hasBottom = styles.bottom && styles.bottom !== "auto";
        
        if (!hasTop && !hasLeft && !hasRight && !hasBottom) {
            issues.push({
                type: "unanchored-positioned",
                property: "position",
                value: styles.position,
                severity: "low",
                note: `position:${styles.position} with no top/right/bottom/left (element position depends on default flow)`,
            });
        }

    }

    // z-index on non-positioned element (has no effect)
    if (styles["z-index"] && styles["z-index"] !== "auto" && styles.position === "static") {
        
        issues.push({
            type: "ineffective-z-index",
            property: "z-index",
            value: styles["z-index"],
            severity: "low",
            note: "z-index has no effect on position:static elements",
        });

    }

    return issues;
}
