import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { ToggleFilterTool } from '../../tools/ToggleFilterTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('ToggleFilterTool', () => {
    let filterManager: FilterManager;
    let tool: ToggleFilterTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new ToggleFilterTool(filterManager);
    });

    test('toggles filter enabled state', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;
        assert.strictEqual(filter.isEnabled, true);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('disabled'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', keyword: 'error' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'missing' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', keyword: 'k' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; keyword: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
