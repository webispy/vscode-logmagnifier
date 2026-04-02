import * as assert from 'assert';
import { getNonce, safeJson, escapeHtml } from '../../utils/WebviewUtils';

suite('WebviewUtils Test Suite', () => {
    suite('getNonce', () => {
        test('returns a base64 string of expected length', () => {
            const nonce = getNonce();
            assert.strictEqual(typeof nonce, 'string');
            // 16 bytes → 24 chars in base64
            assert.strictEqual(nonce.length, 24);
        });

        test('returns unique values on consecutive calls', () => {
            const nonces = new Set(Array.from({ length: 10 }, () => getNonce()));
            assert.strictEqual(nonces.size, 10);
        });
    });

    suite('safeJson', () => {
        test('serializes simple values', () => {
            assert.strictEqual(safeJson(42), '42');
            assert.strictEqual(safeJson('hello'), '"hello"');
            assert.strictEqual(safeJson(true), 'true');
            assert.strictEqual(safeJson(null), 'null');
        });

        test('escapes < to prevent script injection', () => {
            const result = safeJson('<script>alert(1)</script>');
            assert.ok(!result.includes('<'));
            assert.ok(result.includes('\\u003c'));
        });

        test('serializes objects and arrays', () => {
            assert.strictEqual(safeJson({ a: 1 }), '{"a":1}');
            assert.strictEqual(safeJson([1, 2]), '[1,2]');
        });

        test('returns "null" for circular references', () => {
            const obj: Record<string, unknown> = {};
            obj.self = obj;
            assert.strictEqual(safeJson(obj), 'null');
        });
    });

    suite('escapeHtml', () => {
        test('escapes all HTML special characters', () => {
            assert.strictEqual(escapeHtml('&'), '&amp;');
            assert.strictEqual(escapeHtml('<'), '&lt;');
            assert.strictEqual(escapeHtml('>'), '&gt;');
            assert.strictEqual(escapeHtml('"'), '&quot;');
            assert.strictEqual(escapeHtml("'"), '&#039;');
        });

        test('escapes a mixed string', () => {
            assert.strictEqual(
                escapeHtml('<div class="test">&\'hello\'</div>'),
                '&lt;div class=&quot;test&quot;&gt;&amp;&#039;hello&#039;&lt;/div&gt;'
            );
        });

        test('returns empty string for null/undefined/empty', () => {
            assert.strictEqual(escapeHtml(null), '');
            assert.strictEqual(escapeHtml(undefined), '');
            assert.strictEqual(escapeHtml(''), '');
        });

        test('preserves safe text unchanged', () => {
            assert.strictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
        });
    });
});
