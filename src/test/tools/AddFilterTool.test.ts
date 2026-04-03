import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { AddFilterTool } from '../../tools/AddFilterTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('AddFilterTool', () => {
    let filterManager: FilterManager;
    let tool: AddFilterTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        tool = new AddFilterTool(filterManager);
    });

    test('adds filter to new group', async () => {
        const result = await tool.invoke(
            {
                input: { keyword: 'error', groupName: 'My Group', type: 'include' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Added'));
        assert.ok(text.includes('error'));

        const group = filterManager.getGroups().find(g => g.name === 'My Group');
        assert.ok(group, 'Group should be created');
        assert.strictEqual(group.filters.length, 1);
        assert.strictEqual(group.filters[0].keyword, 'error');
        assert.strictEqual(group.filters[0].type, 'include');
    });

    test('adds filter to existing group', async () => {
        filterManager.addGroup('Existing', false);

        await tool.invoke(
            {
                input: { keyword: 'warn', groupName: 'Existing' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const group = filterManager.getGroups().find(g => g.name === 'Existing');
        assert.ok(group);
        assert.ok(group.filters.some(f => f.keyword === 'warn'));
    });

    test('uses default group name', async () => {
        await tool.invoke(
            {
                input: { keyword: 'test' },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const group = filterManager.getGroups().find(g => g.name === 'AI Filters');
        assert.ok(group, 'Default group should be created');
    });

    test('sets case sensitivity', async () => {
        await tool.invoke(
            {
                input: { keyword: 'Error', groupName: 'CS Test', caseSensitive: true },
                toolInvocationToken: undefined as never,
            },
            token
        );

        const group = filterManager.getGroups().find(g => g.name === 'CS Test');
        assert.ok(group);
        assert.strictEqual(group.filters[0].caseSensitive, true);
    });

    test('prepareInvocation returns message', async () => {
        const prepared = await tool.prepareInvocation(
            {
                input: { keyword: 'err', type: 'exclude' as const, groupName: 'G' },
            } as vscode.LanguageModelToolInvocationPrepareOptions<{ keyword: string; type: 'exclude'; groupName: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
        const msg = typeof prepared.invocationMessage === 'string'
            ? prepared.invocationMessage
            : (prepared.invocationMessage as vscode.MarkdownString).value;
        assert.ok(msg.includes('exclude'));
        assert.ok(msg.includes('err'));
    });
});
