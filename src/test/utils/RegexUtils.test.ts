import * as assert from 'assert';
import { RegexUtils } from '../../utils/RegexUtils';

suite('RegexUtils Test Suite', () => {
    test('create returns regex with correct pattern', () => {
        const regex = RegexUtils.create('test', false, false);
        assert.strictEqual(regex.source, 'test');
        assert.ok(regex.flags.includes('i')); // case insensitive
        assert.ok(regex.flags.includes('g')); // global
    });

    test('create escapes special characters for non-regex strings', () => {
        const regex = RegexUtils.create('test.*', false, false);
        // regex source should be escaped: test\.\*
        assert.strictEqual(regex.source, 'test\\.\\*');
    });

    test('create preserves special characters for regex strings', () => {
        const regex = RegexUtils.create('test.*', true, false);
        assert.strictEqual(regex.source, 'test.*');
    });

    test('create handles case sensitivity', () => {
        const sensitive = RegexUtils.create('test', false, true);
        assert.ok(!sensitive.flags.includes('i'));

        const insensitive = RegexUtils.create('test', false, false);
        assert.ok(insensitive.flags.includes('i'));
    });

    test('create returns fresh instance with lastIndex 0', () => {
        const regex1 = RegexUtils.create('test', false, false);
        regex1.exec('test string');
        // Since it is global, exec moves lastIndex
        assert.ok(regex1.lastIndex > 0, "lastIndex should preserve state after exec");

        const regex2 = RegexUtils.create('test', false, false);
        assert.strictEqual(regex2.lastIndex, 0, "New instance should have lastIndex 0");
        assert.notStrictEqual(regex1, regex2);
    });

    test('create handles invalid regex gracefully', () => {
        // Pass an invalid regex pattern in regex mode
        const regex = RegexUtils.create('(', true, false);
        // Should return match-nothing regex: /(?!)/
        // Verify it doesn't throw and returns a safe regex that matches nothing
        assert.doesNotThrow(() => regex.test('anything'));
        assert.strictEqual(regex.test('anything'), false);
    });

    test('create caches and returns copies', () => {
        const regex1 = RegexUtils.create('cacheTest', false, false);
        const regex2 = RegexUtils.create('cacheTest', false, false);

        // They should be different instances (clones)
        assert.notStrictEqual(regex1, regex2);
        // Both should work
        assert.strictEqual(regex1.source, regex2.source);
    });
});
