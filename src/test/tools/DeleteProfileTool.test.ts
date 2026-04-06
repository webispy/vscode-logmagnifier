import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { DeleteProfileTool } from '../../tools/DeleteProfileTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('DeleteProfileTool', () => {
    let filterManager: FilterManager;
    let tool: DeleteProfileTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new DeleteProfileTool(filterManager);
    });

    test('returns error for non-existent profile', async () => {
        const result = await tool.invoke(
            { input: { name: 'NonExistent' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'), 'Should indicate profile not found');
    });

    test('cannot delete Default profile', async () => {
        const result = await tool.invoke(
            { input: { name: 'Default' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Cannot delete'), 'Should refuse to delete Default profile');
    });

    test('deletes an existing profile', async () => {
        // Create a profile first
        await filterManager.createProfile('ToDelete');
        assert.ok(filterManager.getProfileNames().includes('ToDelete'));

        const result = await tool.invoke(
            { input: { name: 'ToDelete' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('deleted'), 'Should confirm deletion');
        assert.ok(!filterManager.getProfileNames().includes('ToDelete'), 'Profile should be removed');
    });

    test('prepareInvocation returns confirmation message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { name: 'TestProfile' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ name: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
