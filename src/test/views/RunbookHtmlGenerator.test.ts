import * as assert from 'assert';
import { escapeHtml } from '../../utils/WebviewUtils';

suite('Runbook WebviewUtils Test Suite', () => {

    suite('escapeHtml', () => {
        test('Should escape all special HTML characters', () => {
            assert.strictEqual(
                escapeHtml('<script>alert("xss" & \'test\')</script>'),
                '&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;test&#039;)&lt;/script&gt;'
            );
        });

        test('Should return empty string for null and undefined', () => {
            assert.strictEqual(escapeHtml(undefined), '');
            assert.strictEqual(escapeHtml(null), '');
            assert.strictEqual(escapeHtml(''), '');
        });
    });
});
