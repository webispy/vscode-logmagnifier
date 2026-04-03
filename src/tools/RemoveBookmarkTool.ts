import * as vscode from 'vscode';

import { LogBookmarkService } from '../services/LogBookmarkService';

interface RemoveBookmarkInput {
    line: number;
}

/** Removes a bookmark at a specific line in the active file. */
export class RemoveBookmarkTool implements vscode.LanguageModelTool<RemoveBookmarkInput> {
    constructor(private readonly bookmarkService: LogBookmarkService) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RemoveBookmarkInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Removing bookmark at line ${options.input.line}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RemoveBookmarkInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const uriKey = editor.document.uri.toString();
        const allBookmarks = this.bookmarkService.getBookmarks();
        const fileBookmarks = allBookmarks.get(uriKey);

        if (!fileBookmarks || fileBookmarks.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No bookmarks for the active file.')
            ]);
        }

        const zeroBased = options.input.line - 1;
        const bookmark = fileBookmarks.find(b => b.line === zeroBased);

        if (!bookmark) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`No bookmark found at line ${options.input.line}.`)
            ]);
        }

        this.bookmarkService.removeBookmark(bookmark);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Removed bookmark at line ${options.input.line}.`)
        ]);
    }
}
