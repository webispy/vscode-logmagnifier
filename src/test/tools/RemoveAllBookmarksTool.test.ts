import * as assert from 'assert';
import * as vscode from 'vscode';

import { LogBookmarkService } from '../../services/LogBookmarkService';
import { RemoveAllBookmarksTool } from '../../tools/RemoveAllBookmarksTool';
import { MockExtensionContext } from '../utils/Mocks';

suite('RemoveAllBookmarksTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns message when no bookmarks', async () => {
        const mockContext = new MockExtensionContext();
        const bookmarkService = new LogBookmarkService(mockContext);
        const tool = new RemoveAllBookmarksTool(bookmarkService);

        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No bookmarks'));
    });

    test('prepareInvocation returns confirmation', async () => {
        const mockContext = new MockExtensionContext();
        const bookmarkService = new LogBookmarkService(mockContext);
        const tool = new RemoveAllBookmarksTool(bookmarkService);

        const prepared = await tool.prepareInvocation(
            { input: {} } as vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
            token
        );

        assert.ok(prepared.invocationMessage);
        assert.ok(prepared.confirmationMessages);
    });
});
