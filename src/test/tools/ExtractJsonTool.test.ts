import * as assert from 'assert';
import * as vscode from 'vscode';

import { ExtractJsonTool } from '../../tools/ExtractJsonTool';

suite('ExtractJsonTool', () => {
    let tool: ExtractJsonTool;
    const token = new vscode.CancellationTokenSource().token;

    setup(() => {
        tool = new ExtractJsonTool();
    });

    test('returns error when no editor', async () => {
        // Close all editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        const result = await tool.invoke(
            { input: { line: 1 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No active editor'));
    });

    test('extracts JSON from log line', async () => {
        const content = '2024-01-15 14:30:00 INFO Response: {"status": 200, "data": {"id": 1}}';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc);

        const result = await tool.invoke(
            { input: { line: 1 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('"status": 200'), 'Should contain parsed JSON');
        assert.ok(text.includes('"id": 1'), 'Should contain nested data');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('returns error for line without JSON', async () => {
        const content = 'This is a plain log line without any JSON';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc);

        const result = await tool.invoke(
            { input: { line: 1 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('No JSON'));

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('requires line or startLine/endLine', async () => {
        const content = 'test';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc);

        const result = await tool.invoke(
            { input: {}, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('Specify'));

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('handles multi-line extraction', async () => {
        const content = 'Line 1\n{"key": "value"}\nLine 3';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc);

        const result = await tool.invoke(
            { input: { startLine: 1, endLine: 3 }, toolInvocationToken: undefined as never },
            token
        );

        const text = (result.content[0] as vscode.LanguageModelTextPart).value;
        assert.ok(text.includes('"key": "value"'));

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
});
