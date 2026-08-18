// Extracts and parses JSON from text that may be wrapped in a markdown fenced code block.
export function parseFencedJson(text) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    return JSON.parse(jsonMatch ? jsonMatch[1] : text);
}
