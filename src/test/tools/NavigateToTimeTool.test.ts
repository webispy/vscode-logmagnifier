import * as assert from 'assert';
import * as vscode from 'vscode';

import { NavigateToTimeTool } from '../../tools/NavigateToTimeTool';

suite('NavigateToTimeTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error when no active editor', async () => {
        // TimestampService is not needed when there's no editor
        const mockTs = {} as never;
        const tool = new NavigateToTimeTool(mockTs);

        const result = await tool.invoke(
            { input: { time: '14:30' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No active editor'));
    });

    test('prepareInvocation returns message', async () => {
        const mockTs = {} as never;
        const tool = new NavigateToTimeTool(mockTs);

        const prepared = await tool.prepareInvocation(
            { input: { time: '14:30' } } as vscode.LanguageModelToolInvocationPrepareOptions<{ time: string }>,
            token
        );

        assert.ok(prepared.invocationMessage);
        assert.ok(String(prepared.invocationMessage).includes('14:30'));
    });
});
