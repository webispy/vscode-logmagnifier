import * as assert from 'assert';
import { FilterManager } from '../../services/FilterManager';
import { MockExtensionContext } from '../utils/Mocks';

/**
 * Tests for import validation: regex syntax checking, field truncation,
 * and invalid data handling via sanitizeImportedFilter (indirectly).
 */
suite('FilterManager Import Validation Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Remove all groups for a clean slate
        const groups = filterManager.getGroups();
        for (const g of groups) {
            filterManager.removeGroup(g.id);
        }
    });

    test('import with valid regex filter keeps filter enabled', () => {
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Test',
                isRegex: true,
                isEnabled: true,
                filters: [{
                    pattern: '\\d{4}-\\d{2}-\\d{2}',
                    type: 'include',
                    isRegex: true,
                    isEnabled: true
                }]
            }]
        });

        const result = filterManager.importFilters(json, 'regex', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name === 'Test');
        assert.ok(imported);
        assert.strictEqual(imported.filters[0].isEnabled, true, 'Valid regex should remain enabled');
    });

    test('import with invalid regex disables the filter', () => {
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Bad Regex',
                isRegex: true,
                isEnabled: true,
                filters: [{
                    pattern: '(unclosed',
                    type: 'include',
                    isRegex: true,
                    isEnabled: true
                }]
            }]
        });

        const result = filterManager.importFilters(json, 'regex', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name === 'Bad Regex');
        assert.ok(imported);
        assert.strictEqual(imported.filters[0].isEnabled, false, 'Invalid regex should be disabled on import');
        assert.strictEqual(imported.filters[0].pattern, '(unclosed', 'Keyword should be preserved');
    });

    test('import truncates oversized pattern to 500 chars', () => {
        const longPattern = 'x'.repeat(600);
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Long',
                isRegex: false,
                isEnabled: true,
                filters: [{
                    pattern: longPattern,
                    type: 'include',
                    isEnabled: true,
                    isRegex: false
                }]
            }]
        });

        const result = filterManager.importFilters(json, 'word', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name === 'Long');
        assert.ok(imported);
        assert.strictEqual(imported.filters[0].pattern.length, 500, 'Keyword should be truncated to 500');
    });

    test('import truncates group name to 200 chars', () => {
        const longName = 'G'.repeat(300);
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: longName,
                isRegex: false,
                isEnabled: true,
                filters: []
            }]
        });

        const result = filterManager.importFilters(json, 'word', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name.startsWith('GGG'));
        assert.ok(imported);
        assert.strictEqual(imported.name.length, 200, 'Name should be truncated to 200');
    });

    test('import with invalid JSON returns error', () => {
        const result = filterManager.importFilters('not json {{{', 'word', false);
        assert.strictEqual(result.count, 0);
        assert.ok(result.error, 'Should return an error message');
    });

    test('import with wrong mode filters is ignored', () => {
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Regex Group',
                isRegex: true,
                isEnabled: true,
                filters: [{ pattern: 'test', type: 'include', isRegex: true, isEnabled: true }]
            }]
        });

        // Import as 'word' mode — the regex group should be skipped
        const result = filterManager.importFilters(json, 'word', false);
        assert.strictEqual(result.count, 0, 'Regex group should not import in word mode');
    });

    test('import with missing fields uses safe defaults', () => {
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Minimal',
                isRegex: false,
                isEnabled: true,
                filters: [{
                    // Only pattern and type — everything else missing
                    pattern: 'search',
                    type: 'include'
                }]
            }]
        });

        const result = filterManager.importFilters(json, 'word', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name === 'Minimal');
        assert.ok(imported);
        const filter = imported.filters[0];
        assert.strictEqual(filter.isEnabled, true, 'Default isEnabled should be true');
        assert.strictEqual(filter.isRegex, false, 'Default isRegex should be false');
        assert.strictEqual(filter.contextLines, 0, 'Default contextLines should be 0');
    });

    test('import with invalid contextLines uses 0', () => {
        const json = JSON.stringify({
            version: '1.0',
            groups: [{
                name: 'Bad Context',
                isRegex: false,
                isEnabled: true,
                filters: [{
                    pattern: 'test',
                    type: 'include',
                    isEnabled: true,
                    isRegex: false,
                    contextLines: 999
                }]
            }]
        });

        const result = filterManager.importFilters(json, 'word', false);
        assert.strictEqual(result.count, 1);

        const imported = filterManager.getGroups().find(g => g.name === 'Bad Context');
        assert.ok(imported);
        assert.strictEqual(imported.filters[0].contextLines, 0, 'Invalid contextLines should fall back to 0');
    });
});
