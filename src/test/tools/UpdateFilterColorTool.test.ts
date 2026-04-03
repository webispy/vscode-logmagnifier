import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { UpdateFilterColorTool } from '../../tools/UpdateFilterColorTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('UpdateFilterColorTool', () => {
    let filterManager: FilterManager;
    let tool: UpdateFilterColorTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new UpdateFilterColorTool(filterManager);
    });

    test('changes filter color', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', color: 'color03' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('red'));
        assert.strictEqual(filter.color, 'color03');
    });

    test('rejects invalid color', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', color: 'color99' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Invalid color'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', keyword: 'error', color: 'color01' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'missing', color: 'color01' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', keyword: 'k', color: 'color06' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; keyword: string; color: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
        assert.ok(String(prepared.invocationMessage).includes('blue'));
    });
});
