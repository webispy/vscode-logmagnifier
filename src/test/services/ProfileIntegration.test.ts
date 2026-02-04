import * as assert from 'assert';
import * as vscode from 'vscode';
import { FilterManager } from '../../services/FilterManager';
import { Constants } from '../../constants';
import { MockExtensionContext } from '../utils/Mocks';

suite('Profile Integration Test Suite', () => {
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Ensure clean state: Default profile is active initially
    });

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    teardown(() => {
        filterManager.dispose();
    });

    test('Default Profile Persistence', async () => {
        // 1. Start on Default
        assert.strictEqual(filterManager.getActiveProfile(), Constants.Labels.DefaultProfile);

        // 2. Add a filter to default
        const defaultGroup = filterManager.addGroup('Default Group', false)!;
        filterManager.addFilter(defaultGroup.id, 'keyword1', 'include');
        await wait(350); // Wait for debounce save

        // 3. Create and switch to new profile
        await filterManager.createProfile('Profile B');
        assert.strictEqual(filterManager.getActiveProfile(), 'Profile B');

        const profileBGroups = filterManager.getGroups();
        // Should NOT have 'Default Group'
        assert.ok(!profileBGroups.find(g => g.name === 'Default Group'), 'New profile should not have groups from previous profile');

        // 4. Switch back to Default
        await filterManager.loadProfile(Constants.Labels.DefaultProfile);
        assert.strictEqual(filterManager.getActiveProfile(), Constants.Labels.DefaultProfile);

        // 5. Verify persistence
        const groups = filterManager.getGroups();
        const persistedGroup = groups.find(g => g.name === 'Default Group');
        assert.ok(persistedGroup, 'Default profile should persist its groups');
        assert.strictEqual(persistedGroup.filters[0].keyword, 'keyword1');
    });

    test('Create New Profile', async () => {
        const result = await filterManager.createProfile('New Profile');
        assert.strictEqual(result, true);
        assert.strictEqual(filterManager.getActiveProfile(), 'New Profile');

        // Verify it exists in profile list
        const profiles = filterManager.getProfileNames();
        assert.ok(profiles.includes('New Profile'));
    });

    test('Duplicate Profile', async () => {
        // 1. Setup initial profile
        const group = filterManager.addGroup('Source Group', false)!;
        filterManager.addFilter(group.id, 'source-filter', 'include');
        await wait(350);

        // 2. Duplicate
        const dupResult = await filterManager.duplicateProfile('Copy Profile');
        assert.strictEqual(dupResult, true, 'Duplication should succeed');

        // 3. Switch to copy
        await filterManager.loadProfile('Copy Profile');
        assert.strictEqual(filterManager.getActiveProfile(), 'Copy Profile');

        // 4. Verify content
        const groups = filterManager.getGroups();

        const copiedGroup = groups.find(g => g.name === 'Source Group');
        assert.ok(copiedGroup, 'Copied profile should have source group');
        assert.strictEqual(copiedGroup.filters[0].keyword, 'source-filter');
    });

    test('Profile Isolation', async () => {
        // 1. Setup Profile A
        await filterManager.createProfile('Profile A');
        const groupA = filterManager.addGroup('Group A', false)!;
        filterManager.addFilter(groupA.id, 'filter A', 'include');
        await wait(350);

        // 2. Duplicate to Profile B
        await filterManager.duplicateProfile('Profile B');
        await filterManager.loadProfile('Profile B');

        // 3. Modify Profile B
        const groupB = filterManager.getGroups().find(g => g.name === 'Group A')!;
        filterManager.addFilter(groupB.id, 'filter B', 'exclude');
        await wait(350);

        // 4. Switch back to A
        await filterManager.loadProfile('Profile A');

        // 5. Verify A is unchanged
        const finalGroupA = filterManager.getGroups().find(g => g.name === 'Group A')!;
        assert.strictEqual(finalGroupA.filters.length, 1, 'Profile A should not be affected by changes in Profile B');
        assert.strictEqual(finalGroupA.filters[0].keyword, 'filter A');
    });

    test('Export/Import per Profile', async () => {
        // 1. Create Profile Export
        await filterManager.createProfile('Export Source');
        const exGroup = filterManager.addGroup('Export Group', false)!;
        filterManager.addFilter(exGroup.id, 'export-keyword', 'include');
        await wait(350);

        const json = filterManager.exportFilters('word'); // Export word filters

        // 2. Switch to Profile Import
        await filterManager.createProfile('Import Target');
        // Verify keys don't exist yet
        assert.strictEqual(filterManager.getGroups().find(g => g.name === 'Export Group'), undefined);

        // 3. Import
        filterManager.importFilters(json, 'word', false);
        await wait(350);

        // 4. Verify Import
        const groups = filterManager.getGroups();
        const importedGroup = groups.find(g => g.name === 'Export Group');
        assert.ok(importedGroup, 'Should have imported group');
        assert.strictEqual(importedGroup.filters[0].keyword, 'export-keyword');

        // 5. Verify Isolation (Switch back to Default)
        await filterManager.loadProfile(Constants.Labels.DefaultProfile);
        assert.strictEqual(filterManager.getGroups().find(g => g.name === 'Export Group'), undefined, 'Default profile should not receive imported groups from another profile');
    });
});
