import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { RemoveFilterTool } from '../../tools/RemoveFilterTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('RemoveFilterTool', () => {
    let filterManager: FilterManager;
    let tool: RemoveFilterTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new RemoveFilterTool(filterManager);
    });

    test('removes a filter by pattern', async () => {
        const group = filterManager.addGroup('Test', false)!;
        filterManager.addFilter(group.id, 'error', 'include', false);
        filterManager.addFilter(group.id, 'warn', 'include', false);

        const result = await tool.invoke(
            {
                input: { groupName: 'Test', pattern: 'error' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Removed filter'));

        const updatedGroup = filterManager.getGroups().find(g => g.name === 'Test');
        assert.ok(updatedGroup);
        assert.strictEqual(updatedGroup.filters.length, 1);
        assert.strictEqual(updatedGroup.filters[0].pattern, 'warn');
    });

    test('removes entire group', async () => {
        const group = filterManager.addGroup('ToDelete', false)!;
        filterManager.addFilter(group.id, 'test', 'include', false);

        const result = await tool.invoke(
            {
                input: { groupName: 'ToDelete' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Removed group'));

        const deleted = filterManager.getGroups().find(g => g.name === 'ToDelete');
        assert.strictEqual(deleted, undefined);
    });

    test('returns error for non-existent group', async () => {
        const result = await tool.invoke(
            {
                input: { groupName: 'NoSuch' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });

    test('returns error for non-existent filter', async () => {
        filterManager.addGroup('G', false);

        const result = await tool.invoke(
            {
                input: { groupName: 'G', pattern: 'nonexistent' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('not found'));
    });
});
