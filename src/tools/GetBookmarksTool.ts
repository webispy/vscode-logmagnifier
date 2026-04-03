import * as vscode from 'vscode';

import { LogBookmarkService } from '../services/LogBookmarkService';

/** Returns bookmarks for the active log file. */
export class GetBookmarksTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly bookmarkService: LogBookmarkService) {}

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
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

        const result = fileBookmarks.map(b => ({
            line: b.line + 1,
            content: b.content,
            tag: b.matchText,
        }));

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
    }
}
