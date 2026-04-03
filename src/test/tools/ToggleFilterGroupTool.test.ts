import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { ToggleFilterGroupTool } from '../../tools/ToggleFilterGroupTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('ToggleFilterGroupTool', () => {
    let filterManager: FilterManager;
    let tool: ToggleFilterGroupTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new ToggleFilterGroupTool(filterManager);
    });

    test('toggles group enabled state', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        assert.strictEqual(group.isEnabled, false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('enabled'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
