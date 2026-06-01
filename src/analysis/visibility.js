export function detectVisibilityIssues(styles) {
    const issues = [];

    if (styles.display === "none") {
        issues.push({ 
            type: "hidden", 
            property: "display", 
            value: "none", 
            severity: "high" 
        });
    }

    if (styles.visibility === "hidden" || styles.visibility === "collapse") {
        issues.push({
            type: "hidden",
            property: "visibility",
            value: styles.visibility,
            severity: "high",
        });
    }

    const opacity = parseFloat(styles.opacity);
    if (!isNaN(opacity) && opacity === 0) {
        issues.push({
            type: "invisible",
            property: "opacity",
            value: "0",
            severity: "high",
        });
    } else if (!isNaN(opacity) && opacity < 0.1) {
        issues.push({
            type: "nearly-invisible",
            property: "opacity",
            value: styles.opacity,
            severity: "medium",
        });
    }

    if (styles["clip-path"] && styles["clip-path"] !== "none") {
        issues.push({
            type: "clipped",
            property: "clip-path",
            value: styles["clip-path"],
            severity: "medium",
        });
    }

    if (styles.overflow === "hidden") {
        const w = parseFloat(styles.width);
        const h = parseFloat(styles.height);
        
        if ((!isNaN(w) && w === 0) || (!isNaN(h) && h === 0)) {
            issues.push({
                type: "clipped-zero-size",
                property: "overflow+size",
                value: `overflow:hidden with ${styles.width}x${styles.height}`,
                severity: "high",
            });
        }
    }

    if (styles["pointer-events"] === "none") {
        issues.push({
            type: "unclickable",
            property: "pointer-events",
            value: "none",
            severity: "low",
        });
    }

    return issues;
}
