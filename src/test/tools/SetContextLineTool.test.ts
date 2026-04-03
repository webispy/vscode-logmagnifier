import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { SetContextLineTool } from '../../tools/SetContextLineTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('SetContextLineTool', () => {
    let filterManager: FilterManager;
    let tool: SetContextLineTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new SetContextLineTool(filterManager);
    });

    test('sets context lines', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', lines: 5 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('±5'));
        assert.strictEqual(filter.contextLine, 5);
    });

    test('disables context lines with 0', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false)!;

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', lines: 0 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('disabled'));
    });

    test('rejects invalid context line value', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', lines: 7 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Invalid'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', keyword: 'error', lines: 3 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'missing', lines: 3 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', keyword: 'k', lines: 3 } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; keyword: string; lines: number }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
