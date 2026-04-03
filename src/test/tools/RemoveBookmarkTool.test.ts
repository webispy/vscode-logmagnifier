import * as assert from 'assert';
import * as vscode from 'vscode';

import { RemoveBookmarkTool } from '../../tools/RemoveBookmarkTool';

suite('RemoveBookmarkTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error when no active editor', async () => {
        const mockService = {} as never;
        const tool = new RemoveBookmarkTool(mockService);

        const result = await tool.invoke(
            { input: { line: 5 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No active editor'));
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
