import * as assert from 'assert';
import { RegexUtils } from '../../utils/RegexUtils';

suite('RegexUtils Unicode/Emoji Test Suite', () => {

    test('literal search matches Unicode characters', () => {
        const regex = RegexUtils.create('日本語', false, false);
        assert.ok(regex.test('This is 日本語 text'));
        assert.ok(!regex.test('This is English text'));
    });

    test('literal search matches emoji characters', () => {
        const regex = RegexUtils.create('🔥', false, false);
        assert.ok(regex.test('Fire 🔥 emoji'));
        assert.ok(!regex.test('No emoji here'));
    });

    test('literal search matches multi-codepoint emoji', () => {
        const regex = RegexUtils.create('👨‍👩‍👧‍👦', false, false);
        assert.ok(regex.test('Family: 👨‍👩‍👧‍👦'));
    });

    test('regex mode matches Unicode word boundaries', () => {
        const regex = RegexUtils.create('café', true, false);
        assert.ok(regex.test('Order a café'));
        assert.ok(!regex.test('Order a coffee'));
    });

    test('literal search escapes special chars adjacent to Unicode', () => {
        const regex = RegexUtils.create('价格(USD)', false, false);
        // Should be escaped as literal parentheses
        assert.ok(regex.test('价格(USD): 100'));
        assert.ok(!regex.test('价格USD: 100'));
    });

    test('case-insensitive works with ASCII but preserves Unicode', () => {
        // Global regex advances lastIndex, so use separate instances per assertion
        assert.ok(RegexUtils.create('Error', false, false).test('error'));
        assert.ok(RegexUtils.create('Error', false, false).test('ERROR'));
        assert.ok(RegexUtils.create('café', false, false).test('Café'));
    });

    test('regex character class with Unicode range', () => {
        const regex = RegexUtils.create('[가-힣]+', true, false);
        assert.ok(regex.test('한글 테스트'));
        assert.ok(!regex.test('English only'));
    });

    test('emoji in regex alternation', () => {
        const regex = RegexUtils.create('🔴|🟢|🔵', true, false);
        assert.ok(regex.test('Status: 🟢'));
        assert.ok(!regex.test('Status: OK'));
    });

    test('mixed ASCII and CJK literal search', () => {
        const regex = RegexUtils.create('ERROR:エラー', false, false);
        assert.ok(regex.test('2024-01-01 ERROR:エラー occurred'));
        assert.ok(!regex.test('2024-01-01 ERROR:error occurred'));
    });
});
