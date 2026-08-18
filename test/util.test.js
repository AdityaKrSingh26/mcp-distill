import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFencedJson } from "../src/util.js";

test("parses plain JSON text", () => {
    const result = parseFencedJson('{"a":1}');
    assert.deepEqual(result, { a: 1 });
});

test("parses JSON inside a ```json fenced block", () => {
    const result = parseFencedJson('```json\n{"a":1}\n```');
    assert.deepEqual(result, { a: 1 });
});

test("parses JSON inside a fenced block without the json tag", () => {
    const result = parseFencedJson('```\n{"a":1}\n```');
    assert.deepEqual(result, { a: 1 });
});
