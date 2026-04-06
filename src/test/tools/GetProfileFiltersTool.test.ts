import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { GetProfileFiltersTool } from '../../tools/GetProfileFiltersTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('GetProfileFiltersTool', () => {
    let filterManager: FilterManager;
    let tool: GetProfileFiltersTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new GetProfileFiltersTool(filterManager);
    });

    test('returns error for non-existent profile', async () => {
        const result = await tool.invoke(
            { input: { profileName: 'NonExistent' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'), 'Should indicate profile not found');
    });

    test('returns filters for a saved profile', async () => {
        // Create a profile with filters
        const group = filterManager.addGroup('ErrorFilters', false)!;
        filterManager.addFilter(group.id, 'ERROR', 'include', false);
        filterManager.addFilter(group.id, 'WARN', 'include', false);
        await filterManager.saveProfile('TestProfile');

        // Switch away so we verify it reads without being active
        await filterManager.createProfile('Other');

        const result = await tool.invoke(
            { input: { profileName: 'TestProfile' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        const parsed = JSON.parse(text);
        const errorGroup = parsed.find((g: { name: string }) => g.name === 'ErrorFilters');
        assert.ok(errorGroup, 'Should find ErrorFilters group');
        assert.strictEqual(errorGroup.filters.length, 2);
        assert.strictEqual(errorGroup.filters[0].keyword, 'ERROR');
        assert.strictEqual(errorGroup.filters[1].keyword, 'WARN');
    });

    test('enabledOnly filters disabled groups', async () => {
        const group1 = filterManager.addGroup('Enabled', false)!;
        filterManager.addFilter(group1.id, 'test', 'include', false);
        const group2 = filterManager.addGroup('Disabled', false)!;
        filterManager.addFilter(group2.id, 'test2', 'include', false);
        filterManager.toggleGroup(group2.id);
        await filterManager.saveProfile('MixedProfile');

        const result = await tool.invoke(
            { input: { profileName: 'MixedProfile', enabledOnly: true }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        const parsed = JSON.parse(text);
        const allEnabled = parsed.every((g: { isEnabled: boolean }) => g.isEnabled);
        assert.ok(allEnabled, 'All returned groups should be enabled');
    });
});
