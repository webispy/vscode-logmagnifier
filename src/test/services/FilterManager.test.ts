import * as assert from 'assert';
import { FilterManager } from '../../services/FilterManager';
import { MockExtensionContext } from '../utils/Mocks';

/**
 * FilterManager Test Suite
 *
 * Strategy:
 * - Mocks ExtensionContext and GlobalState (Memento) to test persistence without VS Code API.
 * - Handles 'initDefaultFilters' behavior where removing the last regex group triggers default re-creation.
 * - Uses a 'Safe Group' (regex) to prevent automatic default restoration during tests.
 */
suite('FilterManager Export/Import Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Clearing groups triggers 'initDefaultFilters' if we remove the last regex group.
        // To strictly clean up, we can add a temporary regex group, remove others, then we are left with the temp one.
        // But for these tests, we can just be careful.

        // Let's try to remove everything locally, but knowing 'Presets' might come back if we aren't careful.
        // Strategy: Add a 'Safe' regex group first.
        const safeGroup = filterManager.addGroup('Safe Group', true);

        // now remove all others
        const groups = filterManager.getGroups();
        [...groups].forEach(g => {
            if (g.id !== safeGroup?.id) {
                filterManager.removeGroup(g.id);
            }
        });

        // Now we only have 'Safe Group'. We can leave it or try to remove it inside tests if needed,
        // but 'removeGroup(safeGroup)' would trigger defaults again.
        // So let's just make sure our tests expect 'Safe Group' or we work around it.

        // Actually, cleaner: Modify the tests to accept `Safe Group` presence or just filter it out from verification.
        // OR: Modify the test to create its own groups, then remove 'Safe Group' *immediately* after creating the test regex group.
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
        // The 'Safe Group' from setup is already a regex group, so this is redundant for the test's purpose.
        // const rGroup = filterManager.addGroup('Regex Group', true)!;
        // filterManager.addFilter(rGroup.id, '.*', 'include', true);

        // 3. Export Word
        const json = filterManager.exportFilters('word');
        const parsed = JSON.parse(json);

        // 4. Verify
        // We know 'Safe Group' is regex, so it shouldn't be here.
        assert.strictEqual(parsed.groups.length, 1, 'Should only export 1 group (Word Group)');
        assert.strictEqual(parsed.groups[0].name, 'Word Group');
    });

    test('Export All Filters (Regex Mode)', () => {
        // 1. Create Word Group (Should be ignored)
        filterManager.addGroup('Word Group', false)!;

        // 2. Create Regex Group
        const rGroup = filterManager.addGroup('Regex Group', true)!;
        filterManager.addFilter(rGroup.id, '.*', 'include', true);

        // 2. Remove 'Safe Group' (Now that we have another regex group, this won't trigger defaults)
        const groups = filterManager.getGroups();
        const safe = groups.find(g => g.name === 'Safe Group');
        if (safe) {
            filterManager.removeGroup(safe.id);
        }

        // 3. Export Regex
        const json = filterManager.exportFilters('regex');
        const parsed = JSON.parse(json);

        // 4. Verify
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
        // 'Safe Group' is regex, so it stays.
        // 'Existing Group' is word, so it goes.
        filterManager.importFilters(json, 'word', true);

        // 4. Verify
        const groups = filterManager.getGroups();
        const wordGroups = groups.filter(g => !g.isRegex);

        assert.strictEqual(wordGroups.length, 1, 'Should have exactly 1 word group after overwrite');
        assert.strictEqual(wordGroups[0].name, 'New Group');
    });
});
