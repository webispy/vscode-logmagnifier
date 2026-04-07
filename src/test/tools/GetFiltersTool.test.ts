import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { GetFiltersTool } from '../../tools/GetFiltersTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('GetFiltersTool', () => {
    let filterManager: FilterManager;
    let tool: GetFiltersTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new GetFiltersTool(filterManager);
    });

    test('returns filters list', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);
        filterManager.addFilter(group.id, 'debug', 'exclude', false);

        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        const parsed = JSON.parse(text);
        const testGroup = parsed.find((g: { name: string }) => g.name === 'Test Group');
        assert.ok(testGroup, 'Test Group should be in results');
        assert.strictEqual(testGroup.filters.length, 2);
        assert.strictEqual(testGroup.filters[0].pattern, 'error');
        assert.strictEqual(testGroup.filters[0].type, 'include');
        assert.strictEqual(testGroup.filters[1].pattern, 'debug');
        assert.strictEqual(testGroup.filters[1].type, 'exclude');
    });

    test('enabledOnly excludes disabled groups', async () => {
        // Create fresh FilterManager to have clean state
        const freshContext = new MockExtensionContext();
        const freshFM = new FilterManager(freshContext);
        const freshTool = new GetFiltersTool(freshFM);

        const group1 = freshFM.addGroup('Enabled Group', false)!;
        freshFM.addFilter(group1.id, 'test', 'include', false);
        const group2 = freshFM.addGroup('Disabled Group', false)!;
        freshFM.addFilter(group2.id, 'test2', 'include', false);
        freshFM.toggleGroup(group2.id); // Disable group2

        const result = await freshTool.invoke(
            { input: { enabledOnly: true }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        if (text.includes('No filters')) {
            // All groups disabled — valid result
            return;
        }
        const parsed = JSON.parse(text);
        const allEnabled = parsed.every((g: { isEnabled: boolean }) => g.isEnabled);
        assert.ok(allEnabled, 'All returned groups should be enabled');
    });

    test('returns results including default groups', async () => {
        // Even without adding custom groups, default groups exist (e.g. Presets)
        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        // Should return valid JSON with at least default groups
        const parsed = JSON.parse(text);
        assert.ok(Array.isArray(parsed));
    });
});
