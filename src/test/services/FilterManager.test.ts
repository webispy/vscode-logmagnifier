import * as assert from 'assert';
import { FilterManager } from '../../services/FilterManager';
import { MockExtensionContext } from '../utils/Mocks';

/**
 * FilterManager Test Suite
 *
 * Strategy:
 * - Mocks ExtensionContext and GlobalState (Memento) to test persistence without VS Code API.
 * - On construction, FilterManager creates default 'Presets' regex group.
 *   Setup removes all groups to start each test with a clean slate.
 */
suite('FilterManager Export/Import Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Remove all groups (including default Presets) for a clean slate.
        const groups = filterManager.getGroups();
        [...groups].forEach(g => filterManager.removeGroup(g.id));
    });

    test('Export Single Group', () => {
        // 1. Create a group with filters
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'Test Filter', 'include', false);

        // 2. Export
        const json = filterManager.exportGroup(group.id);
        assert.ok(json, 'Export should return JSON string');

        // 3. Verify
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.version, '0.0.0-test');
        assert.strictEqual(parsed.groups.length, 1);
        assert.strictEqual(parsed.groups[0].name, 'Test Group');
        assert.strictEqual(parsed.groups[0].filters.length, 1);
        assert.strictEqual(parsed.groups[0].filters[0].keyword, 'Test Filter');
    });

    test('Export All Filters (Word Mode)', () => {
        // 1. Create Word Group
        const wGroup = filterManager.addGroup('Word Group', false)!;
        filterManager.addFilter(wGroup.id, 'foo', 'include');

        // 2. Create Regex Group (Should be ignored in 'word' export)
        filterManager.addGroup('Regex Group', true)!;

        // 3. Export Word
        const json = filterManager.exportFilters('word');
        const parsed = JSON.parse(json);

        // 4. Verify — only word groups exported
        assert.strictEqual(parsed.groups.length, 1, 'Should only export 1 group (Word Group)');
        assert.strictEqual(parsed.groups[0].name, 'Word Group');
    });

    test('Export All Filters (Regex Mode)', () => {
        // 1. Create Word Group (Should be ignored)
        filterManager.addGroup('Word Group', false)!;

        // 2. Create Regex Group
        const rGroup = filterManager.addGroup('Regex Group', true)!;
        filterManager.addFilter(rGroup.id, '.*', 'include', true);

        // 3. Export Regex
        const json = filterManager.exportFilters('regex');
        const parsed = JSON.parse(json);

        // 4. Verify — only regex groups exported
        assert.strictEqual(parsed.groups.length, 1, 'Should only export 1 group');
        assert.strictEqual(parsed.groups[0].name, 'Regex Group');
        assert.strictEqual(parsed.groups[0].isRegex, true);
    });

    test('Export Subset of Groups (Word Mode)', () => {
        // 1. Create multiple groups
        const g1 = filterManager.addGroup('Group 1', false)!;
        filterManager.addGroup('Group 2', false); // Created but not exported
        const g3 = filterManager.addGroup('Group 3', false)!;

        // 2. Export only Group 1 and 3
        const idsToExport = [g1.id, g3.id];
        const json = filterManager.exportFilters('word', idsToExport);
        const parsed = JSON.parse(json);

        // 3. Verify
        assert.strictEqual(parsed.groups.length, 2, 'Should export exactly 2 groups');

        const exportedNames = parsed.groups.map((g: { name: string }) => g.name);
        assert.ok(exportedNames.includes('Group 1'));
        assert.ok(exportedNames.includes('Group 3'));
        assert.ok(!exportedNames.includes('Group 2'));
    });

    test('Import Filters', () => {
        // 1. Prepare JSON to import
        const importData = {
            version: '1.0.0',
            groups: [
                {
                    id: 'imp-1',
                    name: 'Imported Group',
                    isRegex: false,
                    isEnabled: true,
                    filters: [
                        {
                            id: 'f-1',
                            keyword: 'Imported Key',
                            type: 'include',
                            isEnabled: true
                        }
                    ]
                }
            ]
        };
        const json = JSON.stringify(importData);

        // 2. Import
        const result = filterManager.importFilters(json, 'word', false);

        // 3. Verify
        assert.strictEqual(result.count, 1, 'Should have imported 1 group');

        const groups = filterManager.getGroups();
        // Since we cleared defaults in setup, should describe imported group
        const importedGroup = groups.find(g => g.name === 'Imported Group');
        assert.ok(importedGroup, 'Imported group should exist');
        assert.strictEqual(importedGroup.filters.length, 1);
        assert.strictEqual(importedGroup.filters[0].keyword, 'Imported Key');
    });

    test('Import preserves keyword whitespace', () => {
        const importData = {
            version: '1.0.0',
            groups: [{
                id: 'ws-1',
                name: 'Whitespace Group',
                isRegex: false,
                isEnabled: true,
                filters: [
                    { id: 'f1', keyword: ' ERROR ', type: 'include', isEnabled: true },
                    { id: 'f2', keyword: '  leading', type: 'include', isEnabled: true },
                    { id: 'f3', keyword: 'trailing  ', type: 'exclude', isEnabled: true },
                ]
            }]
        };

        const result = filterManager.importFilters(JSON.stringify(importData), 'word', false);
        assert.strictEqual(result.count, 1);

        const group = filterManager.getGroups().find(g => g.name === 'Whitespace Group');
        assert.ok(group);
        assert.strictEqual(group.filters[0].keyword, ' ERROR ');
        assert.strictEqual(group.filters[1].keyword, '  leading');
        assert.strictEqual(group.filters[2].keyword, 'trailing  ');
    });

    test('Import sanitizes filter properties with type validation', () => {
        const importData = {
            version: '1.0.0',
            groups: [{
                id: 'bad-1',
                name: 'Malicious Group',
                isRegex: false,
                isEnabled: true,
                filters: [{
                    id: 'f-bad',
                    keyword: 12345,              // wrong type: number instead of string
                    type: 'invalid_type',         // invalid enum value
                    isEnabled: 'yes',             // wrong type: string instead of boolean
                    isRegex: 'true',              // wrong type: string instead of boolean
                    highlightMode: 99,            // out of range
                    caseSensitive: 1,             // wrong type: number instead of boolean
                    contextLine: 7,               // not in allowed levels [0,3,5,9]
                    excludeStyle: 'bold',         // invalid value
                }]
            }]
        };

        const result = filterManager.importFilters(JSON.stringify(importData), 'word', false);
        assert.strictEqual(result.count, 1);

        const group = filterManager.getGroups().find(g => g.name === 'Malicious Group');
        assert.ok(group);
        const filter = group.filters[0];

        // All invalid values should fall back to safe defaults
        assert.strictEqual(filter.keyword, '', 'Non-string keyword should become empty');
        assert.strictEqual(filter.type, 'include', 'Invalid type should default to include');
        assert.strictEqual(filter.isEnabled, true, 'Non-boolean isEnabled should default to true');
        assert.strictEqual(filter.isRegex, false, 'Non-boolean isRegex should default to false');
        assert.strictEqual(filter.highlightMode, undefined, 'Out-of-range highlightMode should become undefined');
        assert.strictEqual(filter.caseSensitive, undefined, 'Non-boolean caseSensitive should become undefined');
        assert.strictEqual(filter.contextLine, 0, 'Invalid contextLine should default to 0');
        assert.strictEqual(filter.excludeStyle, undefined, 'Invalid excludeStyle should become undefined');
    });

    test('Import truncates oversized keyword and name', () => {
        const longKeyword = 'x'.repeat(1000);
        const longName = 'G'.repeat(500);
        const longNickname = 'N'.repeat(400);
        const importData = {
            version: '1.0.0',
            groups: [{
                id: 'long-1',
                name: longName,
                isRegex: false,
                isEnabled: true,
                filters: [{
                    id: 'f-long',
                    keyword: longKeyword,
                    type: 'include',
                    isEnabled: true,
                    nickname: longNickname,
                }]
            }]
        };

        const result = filterManager.importFilters(JSON.stringify(importData), 'word', false);
        assert.strictEqual(result.count, 1);

        const group = filterManager.getGroups().find(g => g.name === longName.slice(0, 200));
        assert.ok(group, 'Group name should be truncated to 200 chars');
        assert.strictEqual(group.name.length, 200);
        assert.strictEqual(group.filters[0].keyword.length, 500, 'Keyword should be truncated to 500 chars');
        assert.strictEqual(group.filters[0].nickname?.length, 200, 'Nickname should be truncated to 200 chars');
    });

    test('Import assigns new IDs to groups and filters', () => {
        const importData = {
            version: '1.0.0',
            groups: [{
                id: 'original-group-id',
                name: 'ID Test Group',
                isRegex: false,
                isEnabled: true,
                filters: [{
                    id: 'original-filter-id',
                    keyword: 'test',
                    type: 'include',
                    isEnabled: true,
                }]
            }]
        };

        filterManager.importFilters(JSON.stringify(importData), 'word', false);

        const group = filterManager.getGroups().find(g => g.name === 'ID Test Group');
        assert.ok(group);
        assert.notStrictEqual(group.id, 'original-group-id', 'Group ID should be regenerated');
        assert.notStrictEqual(group.filters[0].id, 'original-filter-id', 'Filter ID should be regenerated');
    });

    test('Import Filters with Overwrite', () => {
        // 1. Create existing group
        filterManager.addGroup('Existing Group', false);

        // 2. Prepare JSON
        const importData = {
            version: '1.0.0',
            groups: [
                {
                    name: 'New Group',
                    isRegex: false, // Matches 'word' mode
                    filters: []
                }
            ]
        };
        const json = JSON.stringify(importData);

        // 3. Import with Overwrite = true
        // This will clear existing groups of same mode ('word').
        filterManager.importFilters(json, 'word', true);

        // 4. Verify
        const groups = filterManager.getGroups();
        const wordGroups = groups.filter(g => !g.isRegex);

        assert.strictEqual(wordGroups.length, 1, 'Should have exactly 1 word group after overwrite');
        assert.strictEqual(wordGroups[0].name, 'New Group');
    });
});

suite('FilterManager Clear Groups Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Remove all groups for a clean slate
        const groups = filterManager.getGroups();
        [...groups].forEach(g => filterManager.removeGroup(g.id));
    });

    test('clearTextGroups removes only text groups', () => {
        filterManager.addGroup('Text 1', false);
        filterManager.addGroup('Text 2', false);
        filterManager.addGroup('Regex 1', true);

        filterManager.clearTextGroups();

        const groups = filterManager.getGroups();
        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0].name, 'Regex 1');
        assert.strictEqual(groups[0].isRegex, true);
    });

    test('clearRegexGroups removes regex groups and restores Presets', () => {
        filterManager.addGroup('Word 1', false);
        filterManager.addGroup('Regex 1', true);
        filterManager.addGroup('Regex 2', true);

        filterManager.clearRegexGroups();

        const groups = filterManager.getGroups();
        const wordGroups = groups.filter(g => !g.isRegex);
        const regexGroups = groups.filter(g => g.isRegex);

        assert.strictEqual(wordGroups.length, 1);
        assert.strictEqual(wordGroups[0].name, 'Word 1');
        assert.strictEqual(regexGroups.length, 1);
        assert.strictEqual(regexGroups[0].name, 'Presets');
    });

    test('clearRegexGroups restores Presets with default filters', () => {
        filterManager.addGroup('My Regex', true);

        filterManager.clearRegexGroups();

        const presets = filterManager.getGroups().find(g => g.name === 'Presets');
        assert.ok(presets, 'Presets group should be restored');
        assert.strictEqual(presets.isRegex, true);
        assert.strictEqual(presets.isEnabled, false);
        assert.strictEqual(presets.filters.length, 2);
        assert.strictEqual(presets.filters[0].nickname, 'Logcat style');
        assert.strictEqual(presets.filters[1].nickname, 'Process Info');
    });

    test('removeGroup does not auto-restore Presets', () => {
        // Add a regex group, then remove it — Presets should NOT reappear
        const group = filterManager.addGroup('Temp Regex', true)!;
        filterManager.removeGroup(group.id);

        const groups = filterManager.getGroups();
        assert.strictEqual(groups.length, 0, 'No groups should exist after removing the only group');
    });
});
