import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { UpdateFilterTool } from '../../tools/UpdateFilterTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('UpdateFilterTool', () => {
    let filterManager: FilterManager;
    let tool: UpdateFilterTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new UpdateFilterTool(filterManager);
    });

    test('updates filter pattern', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', pattern: 'error', newPattern: 'ERROR' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('ERROR'));
    });

    test('updates filter nickname', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', pattern: 'error', nickname: 'Errors' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Errors'));
    });

    test('returns error when no updates specified', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'Test Group', pattern: 'error' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No updates'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', pattern: 'error', newPattern: 'x' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', pattern: 'missing', newPattern: 'x' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', pattern: 'k', newPattern: 'nk' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; pattern: string; newPattern: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
