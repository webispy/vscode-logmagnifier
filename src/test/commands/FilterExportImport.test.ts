import * as assert from 'assert';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { FilterManager } from '../../services/FilterManager';
import { MockExtensionContext } from '../utils/Mocks';

/**
 * FilterExportImportCommandManager Test Suite
 *
 * Tests the export/import logic by exercising FilterManager's exportFilters,
 * exportGroup, and importFilters methods directly. The command manager is a
 * thin layer of VS Code UI (QuickPick, save/open dialogs) over these methods,
 * so testing the core logic gives the most value.
 */
suite('FilterExportImport Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;
    let tmpDir: string;

    setup(async () => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Remove all groups for a clean slate
        const groups = filterManager.getGroups();
        [...groups].forEach(g => filterManager.removeGroup(g.id));

        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lm-export-test-'));
    });

    teardown(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    suite('Export', () => {
        test('exportFilters produces valid JSON with version', () => {
            const group = filterManager.addGroup('Export Group', false)!;
            filterManager.addFilter(group.id, 'keyword1', 'include', false);
            filterManager.addFilter(group.id, 'keyword2', 'exclude', false);

            const json = filterManager.exportFilters('word');
            const parsed = JSON.parse(json);

            assert.ok(parsed.version);
            assert.ok(Array.isArray(parsed.groups));
            assert.strictEqual(parsed.groups.length, 1);
            assert.strictEqual(parsed.groups[0].name, 'Export Group');
            assert.strictEqual(parsed.groups[0].filters.length, 2);
        });

        test('exportFilters filters by mode', () => {
            filterManager.addGroup('Word Group', false);
            filterManager.addGroup('Regex Group', true);

            const wordJson = filterManager.exportFilters('word');
            const wordParsed = JSON.parse(wordJson);
            assert.ok(wordParsed.groups.every((g: { isRegex?: boolean }) => !g.isRegex));

            const regexJson = filterManager.exportFilters('regex');
            const regexParsed = JSON.parse(regexJson);
            assert.ok(regexParsed.groups.every((g: { isRegex?: boolean }) => g.isRegex));
        });

        test('exportFilters with subset of group IDs', () => {
            const group1 = filterManager.addGroup('Group 1', false)!;
            filterManager.addGroup('Group 2', false);
            filterManager.addFilter(group1.id, 'test', 'include', false);

            const json = filterManager.exportFilters('word', [group1.id]);
            const parsed = JSON.parse(json);

            assert.strictEqual(parsed.groups.length, 1);
            assert.strictEqual(parsed.groups[0].name, 'Group 1');
        });

        test('exportGroup produces single group JSON', () => {
            const group = filterManager.addGroup('Single Group', false)!;
            filterManager.addFilter(group.id, 'test', 'include', false);

            const json = filterManager.exportGroup(group.id);
            assert.ok(json);
            const parsed = JSON.parse(json);

            assert.strictEqual(parsed.groups.length, 1);
            assert.strictEqual(parsed.groups[0].name, 'Single Group');
        });

        test('exportGroup returns empty for nonexistent group', () => {
            const json = filterManager.exportGroup('nonexistent-id');
            assert.ok(!json);
        });

        test('export preserves filter properties', () => {
            const group = filterManager.addGroup('Props Group', false)!;
            filterManager.addFilter(group.id, 'colortest', 'include', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];
            filterManager.setFilterHighlightMode(group.id, filter.id, HighlightMode.FullLine);
            filterManager.setFilterCaseSensitivity(group.id, filter.id, true);
            filterManager.setFilterContextLine(group.id, filter.id, 3);

            const json = filterManager.exportGroup(group.id)!;
            const parsed = JSON.parse(json);
            const exported = parsed.groups[0].filters[0];

            assert.strictEqual(exported.highlightMode, HighlightMode.FullLine);
            assert.strictEqual(exported.caseSensitive, true);
            assert.strictEqual(exported.contextLine, 3);
        });

        test('export file round-trip through filesystem', async () => {
            const group = filterManager.addGroup('File Test', false)!;
            filterManager.addFilter(group.id, 'roundtrip', 'include', false);

            const json = filterManager.exportFilters('word');
            const filePath = path.join(tmpDir, 'test_export.json');
            await fsp.writeFile(filePath, json, 'utf8');

            const readBack = await fsp.readFile(filePath, 'utf8');
            const parsed = JSON.parse(readBack);
            assert.strictEqual(parsed.groups[0].filters[0].keyword, 'roundtrip');
        });
    });

    suite('Import', () => {
        test('importFilters in merge mode adds groups', () => {
            const group = filterManager.addGroup('Existing', false)!;
            filterManager.addFilter(group.id, 'existing', 'include', false);

            const exportJson = filterManager.exportFilters('word');

            // Create another manager to import into
            const manager2 = new FilterManager(new MockExtensionContext());
            const groups2 = manager2.getGroups();
            [...groups2].forEach(g => manager2.removeGroup(g.id));

            const result = manager2.importFilters(exportJson, 'word', false);
            assert.ok(!result.error);
            assert.ok(result.count > 0);

            const imported = manager2.getGroups().filter(g => !g.isRegex);
            assert.ok(imported.some(g => g.name === 'Existing'));
        });

        test('importFilters in overwrite mode replaces groups', () => {
            // Set up source
            const group = filterManager.addGroup('Source', false)!;
            filterManager.addFilter(group.id, 'src', 'include', false);
            const exportJson = filterManager.exportFilters('word');

            // Set up target with different data
            const manager2 = new FilterManager(new MockExtensionContext());
            const groups2 = manager2.getGroups();
            [...groups2].forEach(g => manager2.removeGroup(g.id));
            manager2.addGroup('OldGroup', false);

            const result = manager2.importFilters(exportJson, 'word', true);
            assert.ok(!result.error);

            const remaining = manager2.getGroups().filter(g => !g.isRegex);
            assert.ok(!remaining.some(g => g.name === 'OldGroup'), 'Old groups should be removed');
            assert.ok(remaining.some(g => g.name === 'Source'), 'Source group should exist');
        });

        test('importFilters rejects invalid JSON', () => {
            const result = filterManager.importFilters('not valid json', 'word', false);
            assert.ok(result.error);
        });

        test('importFilters assigns new IDs to avoid collisions', () => {
            const group = filterManager.addGroup('ID Test', false)!;
            filterManager.addFilter(group.id, 'test', 'include', false);
            const exportJson = filterManager.exportFilters('word');
            filterManager.importFilters(exportJson, 'word', false);

            const allGroups = filterManager.getGroups().filter(g => g.name === 'ID Test');
            assert.strictEqual(allGroups.length, 2, 'Should have original + imported');
            assert.ok(allGroups[0].id !== allGroups[1].id, 'IDs should be different');
        });

        test('importFilters handles empty groups array', () => {
            const json = JSON.stringify({ version: '1.0.0', groups: [] });
            const result = filterManager.importFilters(json, 'word', false);
            assert.strictEqual(result.count, 0);
        });

        test('import filters wrong mode are ignored', () => {
            // Create regex group and export
            const regexGroup = filterManager.addGroup('Regex Only', true)!;
            filterManager.addFilter(regexGroup.id, '\\d+', 'include', true);
            const regexJson = filterManager.exportFilters('regex');

            // Try to import as word — should be ignored
            const manager2 = new FilterManager(new MockExtensionContext());
            const result = manager2.importFilters(regexJson, 'word', false);
            assert.strictEqual(result.count, 0);
        });
    });
});

// Import HighlightMode for property tests
import { HighlightMode } from '../../models/Filter';
