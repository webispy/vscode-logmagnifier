import * as assert from 'assert';
import { JsonPrettyService } from '../../services/JsonPrettyService';

/**
 * Tests for JsonPrettyService internal logic (extractJsons, findBoundedJson, bestEffortFormat).
 * These are private methods accessed via 'as any' to test core parsing logic in isolation.
 */
suite('JsonPrettyService Test Suite', () => {
    // Access private methods via a typed helper
    let extractJsons: (text: string) => Array<{ type: string; text: string; parsed?: unknown; error?: string }>;
    let bestEffortFormat: (text: string) => string;

    setup(() => {
        // Create a minimal instance just to access private methods
        // The constructor requires vscode dependencies, so we use Object.create to skip it
        const proto = JsonPrettyService.prototype;
        extractJsons = (proto as any).extractJsons.bind({
            findBoundedJson: (proto as any).findBoundedJson
        });
        bestEffortFormat = (proto as any).bestEffortFormat;
    });

    suite('extractJsons', () => {
        test('Should extract a valid JSON object', () => {
            const result = extractJsons('prefix {"key": "value"} suffix');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
            assert.deepStrictEqual(result[0].parsed, { key: 'value' });
        });

        test('Should extract a valid JSON array', () => {
            const result = extractJsons('data: [1, 2, 3]');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
            assert.deepStrictEqual(result[0].parsed, [1, 2, 3]);
        });

        test('Should extract multiple JSON objects from one string', () => {
            const result = extractJsons('{"a":1} some text {"b":2}');
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].type, 'valid');
            assert.strictEqual(result[1].type, 'valid');
            assert.deepStrictEqual(result[0].parsed, { a: 1 });
            assert.deepStrictEqual(result[1].parsed, { b: 2 });
        });

        test('Should handle nested JSON', () => {
            const result = extractJsons('{"outer": {"inner": [1, {"deep": true}]}}');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
            const parsed = result[0].parsed as any;
            assert.strictEqual(parsed.outer.inner[1].deep, true);
        });

        test('Should handle strings containing braces', () => {
            const result = extractJsons('{"msg": "contains { and } chars"}');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
            assert.strictEqual((result[0].parsed as any).msg, 'contains { and } chars');
        });

        test('Should handle escaped quotes in strings', () => {
            const result = extractJsons('{"msg": "he said \\"hello\\""}');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
        });

        test('Should detect incomplete JSON (missing closing brace)', () => {
            const result = extractJsons('{"key": "value"');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'incomplete');
        });

        test('Should detect invalid JSON (bad syntax but bounded)', () => {
            const result = extractJsons('{key: value}');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'invalid');
        });

        test('Should return empty for no JSON content', () => {
            const result = extractJsons('just plain text with no brackets');
            assert.strictEqual(result.length, 0);
        });

        test('Should handle empty object and array', () => {
            const result = extractJsons('{} and []');
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].type, 'valid');
            assert.strictEqual(result[1].type, 'valid');
        });

        test('Should handle log line with embedded JSON', () => {
            const logLine = '2024-01-15 10:30:45.123 INFO Response: {"status":200,"data":{"id":42}}';
            const result = extractJsons(logLine);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].type, 'valid');
            assert.strictEqual((result[0].parsed as any).status, 200);
        });
    });

    suite('bestEffortFormat', () => {
        test('Should format a simple object', () => {
            const result = bestEffortFormat('{"a":1,"b":2}');
            assert.ok(result.includes('\n'), 'should contain newlines');
            assert.ok(result.includes('  '), 'should contain indentation');
            assert.ok(result.includes('"a"'));
            assert.ok(result.includes('"b"'));
        });

        test('Should format nested structures', () => {
            const result = bestEffortFormat('{"a":{"b":1}}');
            const lines = result.split('\n').filter(l => l.trim());
            assert.ok(lines.length >= 4, 'nested object should produce multiple lines');
        });

        test('Should preserve string content including braces', () => {
            const result = bestEffortFormat('{"msg":"hello {world}"}');
            assert.ok(result.includes('"hello {world}"'));
        });

        test('Should handle single-quoted strings (non-standard JSON)', () => {
            const result = bestEffortFormat("{'key': 'value'}");
            assert.ok(result.includes("'key'"));
            assert.ok(result.includes("'value'"));
        });

        test('Should handle escaped characters in strings', () => {
            const result = bestEffortFormat('{"a":"line1\\nline2"}');
            assert.ok(result.includes('\\n'), 'escaped newline should be preserved');
        });

        test('Should add space after colon', () => {
            const result = bestEffortFormat('{"key":"val"}');
            assert.ok(result.includes(': '), 'colon should be followed by space');
        });

        test('Should handle arrays', () => {
            const result = bestEffortFormat('[1,2,3]');
            assert.ok(result.includes('\n'));
            assert.ok(result.includes('1'));
            assert.ok(result.includes('2'));
            assert.ok(result.includes('3'));
        });
    });
});
