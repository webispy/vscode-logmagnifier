import * as assert from 'assert';
import * as vscode from 'vscode';

import { RemoveBookmarkTool } from '../../tools/RemoveBookmarkTool';

suite('RemoveBookmarkTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error or handles gracefully when no bookmark at line', async () => {
        // Provide minimal mock so the tool doesn't crash if an editor happens to be open
        const mockService = {
            getBookmarks: () => new Map<string, unknown[]>(),
        } as never;
        const tool = new RemoveBookmarkTool(mockService);

        const result = await tool.invoke(
            { input: { line: 5 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        // Either no active editor or no bookmarks for the file
        assert.ok(
            text.includes('No active editor') || text.includes('No bookmark') || text.includes('No bookmarks'),
            `Unexpected response: ${text}`
        );
    });

    test('prepareInvocation returns message', async () => {
        const mockService = {} as never;
        const tool = new RemoveBookmarkTool(mockService);

        const prepared = await tool.prepareInvocation(
            { input: { line: 10 } } as vscode.LanguageModelToolInvocationPrepareOptions<{ line: number }>,
            token
        );

        assert.ok(prepared.invocationMessage);
        assert.ok(String(prepared.invocationMessage).includes('10'));
    });
});
