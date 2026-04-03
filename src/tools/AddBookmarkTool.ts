import * as vscode from 'vscode';

import { LogBookmarkService } from '../services/LogBookmarkService';

interface AddBookmarkInput {
    lines: number[];
    tag?: string;
}

/** Bookmarks specific lines in the active log file. */
export class AddBookmarkTool implements vscode.LanguageModelTool<AddBookmarkInput> {
    constructor(private readonly bookmarkService: LogBookmarkService) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<AddBookmarkInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { lines, tag } = options.input;
        const tagStr = tag ? ` with tag "${tag}"` : '';
        return {
            invocationMessage: `Bookmarking ${lines.length} line(s)${tagStr}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<AddBookmarkInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const { lines, tag } = options.input;
        // Convert 1-based to 0-based
        const zeroBasedLines = lines
            .map(l => l - 1)
            .filter(l => l >= 0 && l < editor.document.lineCount);

        if (zeroBasedLines.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No valid line numbers provided.')
            ]);
        }

        const bookmarkOptions = tag ? { matchText: tag } : undefined;
        this.bookmarkService.addBookmarks(editor, zeroBasedLines, bookmarkOptions);

        const tagStr = tag ? ` with tag "${tag}"` : '';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Bookmarked ${zeroBasedLines.length} line(s)${tagStr}.`
            )
        ]);
    }
}
