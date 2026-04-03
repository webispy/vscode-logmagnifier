import * as assert from 'assert';
import * as vscode from 'vscode';

import { HighlightMode } from '../../models/Filter';
import { FilterManager } from '../../services/FilterManager';
import { SetHighlightModeTool } from '../../tools/SetHighlightModeTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('SetHighlightModeTool', () => {
    let filterManager: FilterManager;
    let tool: SetHighlightModeTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new SetHighlightModeTool(filterManager);
    });

    test('sets highlight mode to line', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', mode: 'line' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('"line"'));
        assert.strictEqual(filter.highlightMode, HighlightMode.Line);
    });

    test('sets highlight mode to fullLine', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', mode: 'fullLine' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('"fullLine"'));
        assert.strictEqual(filter.highlightMode, HighlightMode.FullLine);
    });

    test('sets highlight mode to word', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false)!;
        filterManager.setFilterHighlightMode(group.id, filter.id, HighlightMode.Line);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', mode: 'word' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('"word"'));
        assert.strictEqual(filter.highlightMode, HighlightMode.Word);
    });

    test('rejects invalid mode', async () => {
        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'error', mode: 'invalid' as 'word' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Invalid'));
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            { input: { groupName: 'NoGroup', keyword: 'error', mode: 'word' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('Test Group', false);

        const result = await tool.invoke(
            { input: { groupName: 'Test Group', keyword: 'missing', mode: 'word' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            { input: { groupName: 'G', keyword: 'k', mode: 'line' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ groupName: string; keyword: string; mode: 'line' }>,
            token
        );

        assert.ok(prepared.invocationMessage);
    });
});
