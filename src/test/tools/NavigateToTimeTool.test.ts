import * as assert from 'assert';
import * as vscode from 'vscode';

import { NavigateToTimeTool } from '../../tools/NavigateToTimeTool';

suite('NavigateToTimeTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error or handles gracefully when no timestamp index', async () => {
        // Provide minimal mock so the tool doesn't crash if an editor happens to be open
        const mockTs = {
            getIndex: () => undefined,
        } as never;
        const tool = new NavigateToTimeTool(mockTs);

        const result = await tool.invoke(
            { input: { time: '14:30' }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        // Either no active editor or no timestamps detected
        assert.ok(
            text.includes('No active editor') || text.includes('No timestamps'),
            `Unexpected response: ${text}`
        );
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
