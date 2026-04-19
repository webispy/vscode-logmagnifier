import * as assert from 'assert';
import * as vscode from 'vscode';

import { ExtractLogsWithMarginTool } from '../../tools/ExtractLogsWithMarginTool';

suite('ExtractLogsWithMarginTool', () => {
    const token = new vscode.CancellationTokenSource().token;

    test('returns error or handles gracefully when no timestamp index', async () => {
        // Provide minimal mock so the tool doesn't crash if an editor happens to be open
        const mockTs = {
            getIndex: () => undefined,
        } as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const result = await tool.invoke(
            { input: { time: '14:30', marginSeconds: 10 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        // Either no active editor or no timestamps detected
        assert.ok(
            text.includes('No active editor') || text.includes('No timestamps'),
            `Unexpected response: ${text}`
        );
    });

    test('rejects negative margin', async () => {
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const result = await tool.invoke(
            { input: { time: '14:30', marginSeconds: -1 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('non-negative'), `Unexpected response: ${text}`);
    });

    test('rejects margin above 24h cap', async () => {
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const result = await tool.invoke(
            { input: { time: '14:30', marginSeconds: 86401 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('86400'), `Unexpected response: ${text}`);
        assert.ok(text.includes('24 hours'), `Unexpected response: ${text}`);
    });

    test('rejects non-finite margin (NaN)', async () => {
        const mockTs = {} as never;
        const mockSm = {} as never;
        const mockLogger = {} as never;
        const tool = new ExtractLogsWithMarginTool(mockTs, mockSm, mockLogger);

        const result = await tool.invoke(
            { input: { time: '14:30', marginSeconds: Number.NaN }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('finite'), `Unexpected response: ${text}`);
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
