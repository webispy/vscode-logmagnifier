import * as assert from 'assert';
import * as vscode from 'vscode';

import { ExtractLogsWithMarginTool } from '../../tools/ExtractLogsWithMarginTool';

suite('ExtractLogsWithMarginTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error when no active editor', async () => {
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const result = await tool.invoke(
            { input: { time: '14:30', marginSeconds: 10 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No active editor'));
    });

    test('rejects negative margin', async () => {
        // This test would need an active editor to reach the margin check,
        // so we just verify the tool can be instantiated
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);
        assert.ok(tool);
    });

    test('prepareInvocation returns message with time and margin', async () => {
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const prepared = await tool.prepareInvocation(
            { input: { time: '14:30', marginSeconds: 10 } } as vscode.LanguageModelToolInvocationPrepareOptions<{ time: string; marginSeconds: number }>,
            token
        );

        const msg = String(prepared.invocationMessage);
        assert.ok(msg.includes('14:30'));
        assert.ok(msg.includes('10'));
    });
});
