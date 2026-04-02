import * as assert from 'assert';

import { Constants } from '../../Constants';
import { FilterGroup } from '../../models/Filter';
import { ProfileManager } from '../../services/ProfileManager';
import { MockExtensionContext } from '../utils/Mocks';

suite('ProfileManager Test Suite', () => {
    let manager: ProfileManager;
    let mockContext: MockExtensionContext;

    const makeGroup = (name: string, isRegex: boolean): FilterGroup => ({
        id: `group-${name}`,
        name,
        isRegex,
        filters: [],
        isEnabled: true
    });

    setup(() => {
        mockContext = new MockExtensionContext();
        manager = new ProfileManager(mockContext as never);
    });

    teardown(() => {
        manager.dispose();
    });

    // --- getActiveProfile ---

    test('getActiveProfile returns Default when nothing is set', () => {
        assert.strictEqual(manager.getActiveProfile(), Constants.Labels.DefaultProfile);
    });

    // --- getProfileNames ---

    test('getProfileNames returns Default when no profiles exist', () => {
        const names = manager.getProfileNames();
        assert.deepStrictEqual(names, [Constants.Labels.DefaultProfile]);
    });

    test('getProfileNames sorts alphabetically with Default first', async () => {
        await manager.createProfile('Zebra', []);
        await manager.createProfile('Alpha', []);
        await manager.createProfile('Middle', []);

        const names = manager.getProfileNames();
        assert.strictEqual(names[0], Constants.Labels.DefaultProfile);
        assert.strictEqual(names[1], 'Alpha');
        assert.strictEqual(names[2], 'Middle');
        assert.strictEqual(names[3], 'Zebra');
    });

    // --- createProfile ---

    test('createProfile succeeds for new name', async () => {
        const result = await manager.createProfile('Test', [makeGroup('g1', false)]);
        assert.strictEqual(result, true);

        const names = manager.getProfileNames();
        assert.ok(names.includes('Test'));
    });

    test('createProfile rejects duplicate name', async () => {
        await manager.createProfile('Test', []);
        const result = await manager.createProfile('Test', []);
        assert.strictEqual(result, false);
    });

    test('createProfile rejects Default profile name', async () => {
        const result = await manager.createProfile(Constants.Labels.DefaultProfile, []);
        assert.strictEqual(result, false);
    });

    // --- loadProfile ---

    test('loadProfile returns groups and sets active', async () => {
        const groups = [makeGroup('g1', false), makeGroup('g2', true)];
        await manager.createProfile('Test', groups);

        const loaded = await manager.loadProfile('Test');
        assert.strictEqual(loaded?.length, 2);
        assert.strictEqual(manager.getActiveProfile(), 'Test');
    });

    test('loadProfile returns undefined for non-existent profile', async () => {
        const loaded = await manager.loadProfile('NonExistent');
        assert.strictEqual(loaded, undefined);
    });

    test('loadProfile Default returns undefined and sets active to Default', async () => {
        await manager.createProfile('Other', []);
        await manager.loadProfile('Other');
        assert.strictEqual(manager.getActiveProfile(), 'Other');

        const loaded = await manager.loadProfile(Constants.Labels.DefaultProfile);
        assert.strictEqual(loaded, undefined);
        assert.strictEqual(manager.getActiveProfile(), Constants.Labels.DefaultProfile);
    });

    // --- deleteProfile ---

    test('deleteProfile removes profile', async () => {
        await manager.createProfile('ToDelete', []);
        const result = await manager.deleteProfile('ToDelete');
        assert.strictEqual(result, true);
        assert.ok(!manager.getProfileNames().includes('ToDelete'));
    });

    test('deleteProfile rejects Default', async () => {
        const result = await manager.deleteProfile(Constants.Labels.DefaultProfile);
        assert.strictEqual(result, false);
    });

    test('deleteProfile switches active to Default if deleted profile was active', async () => {
        await manager.createProfile('Active', []);
        await manager.loadProfile('Active');
        assert.strictEqual(manager.getActiveProfile(), 'Active');

        await manager.deleteProfile('Active');
        assert.strictEqual(manager.getActiveProfile(), Constants.Labels.DefaultProfile);
    });

    test('deleteProfile returns false for non-existent profile', async () => {
        const result = await manager.deleteProfile('Ghost');
        assert.strictEqual(result, false);
    });

    // --- renameProfile ---

    test('renameProfile succeeds', async () => {
        await manager.createProfile('Old', []);
        const result = await manager.renameProfile('Old', 'New');
        assert.strictEqual(result, true);
        assert.ok(manager.getProfileNames().includes('New'));
        assert.ok(!manager.getProfileNames().includes('Old'));
    });

    test('renameProfile rejects Default as source', async () => {
        const result = await manager.renameProfile(Constants.Labels.DefaultProfile, 'New');
        assert.strictEqual(result, false);
    });

    test('renameProfile rejects Default as target', async () => {
        await manager.createProfile('Source', []);
        const result = await manager.renameProfile('Source', Constants.Labels.DefaultProfile);
        assert.strictEqual(result, false);
    });

    test('renameProfile rejects if new name already exists', async () => {
        await manager.createProfile('A', []);
        await manager.createProfile('B', []);
        const result = await manager.renameProfile('A', 'B');
        assert.strictEqual(result, false);
    });

    test('renameProfile updates active profile if renamed', async () => {
        await manager.createProfile('Active', []);
        await manager.loadProfile('Active');

        await manager.renameProfile('Active', 'Renamed');
        assert.strictEqual(manager.getActiveProfile(), 'Renamed');
    });

    test('renameProfile returns false for non-existent source', async () => {
        const result = await manager.renameProfile('Ghost', 'New');
        assert.strictEqual(result, false);
    });

    // --- getProfilesMetadata ---

    test('getProfilesMetadata returns word and regex counts', async () => {
        await manager.createProfile('Mixed', [
            makeGroup('w1', false),
            makeGroup('w2', false),
            makeGroup('r1', true)
        ]);

        const metadata = manager.getProfilesMetadata();
        const mixed = metadata.find(m => m.name === 'Mixed');
        assert.ok(mixed);
        assert.strictEqual(mixed.wordCount, 2);
        assert.strictEqual(mixed.regexCount, 1);
    });

    test('getProfilesMetadata includes Default even if not stored', () => {
        const metadata = manager.getProfilesMetadata();
        const def = metadata.find(m => m.name === Constants.Labels.DefaultProfile);
        assert.ok(def);
    });

    test('getProfilesMetadata sorts Default first', async () => {
        await manager.createProfile('Alpha', []);
        const metadata = manager.getProfilesMetadata();
        assert.strictEqual(metadata[0].name, Constants.Labels.DefaultProfile);
    });

    // --- updateProfileData ---

    test('updateProfileData creates new entry if not exists', async () => {
        await manager.updateProfileData('New', [makeGroup('g1', false)]);
        const groups = await manager.getProfileGroups('New');
        assert.strictEqual(groups?.length, 1);
    });

    test('updateProfileData updates existing entry', async () => {
        await manager.createProfile('Existing', [makeGroup('g1', false)]);
        await manager.updateProfileData('Existing', [makeGroup('g1', false), makeGroup('g2', true)]);
        const groups = await manager.getProfileGroups('Existing');
        assert.strictEqual(groups?.length, 2);
    });

    // --- importProfile ---

    test('importProfile succeeds for new profile', async () => {
        const result = await manager.importProfile('Imported', [makeGroup('g1', false)]);
        assert.strictEqual(result, true);
        assert.ok(manager.getProfileNames().includes('Imported'));
    });

    test('importProfile rejects duplicate without overwrite', async () => {
        await manager.createProfile('Dup', []);
        const result = await manager.importProfile('Dup', [makeGroup('g1', false)], false);
        assert.strictEqual(result, false);
    });

    test('importProfile overwrites with overwrite flag', async () => {
        await manager.createProfile('Dup', [makeGroup('g1', false)]);
        const result = await manager.importProfile('Dup', [makeGroup('g1', false), makeGroup('g2', true)], true);
        assert.strictEqual(result, true);
        const groups = await manager.getProfileGroups('Dup');
        assert.strictEqual(groups?.length, 2);
    });

    // --- getProfileGroups ---

    test('getProfileGroups returns undefined for non-existent profile', async () => {
        const groups = await manager.getProfileGroups('Ghost');
        assert.strictEqual(groups, undefined);
    });

    // --- onDidChangeProfile event ---

    test('deleteProfile fires onDidChangeProfile', async () => {
        await manager.createProfile('ToDelete', []);
        let fired = false;
        manager.onDidChangeProfile(() => { fired = true; });

        await manager.deleteProfile('ToDelete');
        assert.strictEqual(fired, true);
    });

    test('renameProfile fires onDidChangeProfile', async () => {
        await manager.createProfile('Old', []);
        let fired = false;
        manager.onDidChangeProfile(() => { fired = true; });

        await manager.renameProfile('Old', 'New');
        assert.strictEqual(fired, true);
    });

    test('loadProfile fires onDidChangeProfile', async () => {
        await manager.createProfile('Test', []);
        let fired = false;
        manager.onDidChangeProfile(() => { fired = true; });

        await manager.loadProfile('Test');
        assert.strictEqual(fired, true);
    });
});
