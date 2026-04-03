import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { SetCaseSensitivityTool } from '../../tools/SetCaseSensitivityTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('SetCaseSensitivityTool', () => {
    let filterManager: FilterManager;
    let tool: SetCaseSensitivityTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new SetCaseSensitivityTool(filterManager);
    });

    test('enables case sensitivity', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;
        assert.strictEqual(filter.caseSensitive ?? false, false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', enable: true }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('case-sensitive'));
        assert.strictEqual(filter.caseSensitive, true);
    });

    test('disables case sensitivity', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;
        filterManager.setFilterCaseSensitivity(group.id, filter.id, true);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', enable: false }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('case-insensitive'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', keyword: 'error', enable: true }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'missing', enable: true }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', keyword: 'k', enable: true } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; keyword: string; enable: boolean }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
