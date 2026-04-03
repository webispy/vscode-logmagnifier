import * as vscode from 'vscode';

import { TimestampService } from '../services/TimestampService';

interface NavigateToTimeInput {
    time: string;
}

/** Navigates the editor cursor to a specific timestamp in the log. */
export class NavigateToTimeTool implements vscode.LanguageModelTool<NavigateToTimeInput> {
    constructor(private readonly timestampService: TimestampService) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<NavigateToTimeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Navigating to time "${options.input.time}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<NavigateToTimeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const uri = editor.document.uri.toString();
        const index = this.timestampService.getIndex(uri);

        if (!index) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No timestamps detected in the active file.')
            ]);
        }

        const cursorLine = editor.selection.active.line;
        const cursorEntry = index.lineTimestamps.get(cursorLine);
        const cursorTime = cursorEntry ?? index.firstTime;

        const targetTime = this.timestampService.parseTimeInput(
            options.input.time, index.firstTime, cursorTime
        );

        if (!targetTime) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Could not parse time: "${options.input.time}". Supported formats: HH:MM, HH:MM:SS, HH:MM:SS.mmm, +5m, -30s, +1h, +100ms`
                )
            ]);
        }

        const line = this.timestampService.findLineByTime(index, targetTime);
        if (line < 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No log line found at the specified time.')
            ]);
        }

        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );

        const lineText = editor.document.lineAt(line).text;
        const preview = lineText.length > 120 ? lineText.substring(0, 120) + '...' : lineText;
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Navigated to line ${line + 1}: ${preview}`
            )
        ]);
    }
}
