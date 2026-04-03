import * as vscode from 'vscode';

import { LogBookmarkService } from '../services/LogBookmarkService';

/** Removes all bookmarks across all files. */
export class RemoveAllBookmarksTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly bookmarkService: LogBookmarkService) {}

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Removing all bookmarks',
            confirmationMessages: {
                title: 'Remove All Bookmarks',
                message: new vscode.MarkdownString('This will remove **all** bookmarks across all files. Continue?'),
            },
        };
    }

    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const allBookmarks = this.bookmarkService.getBookmarks();
        let totalCount = 0;
        for (const bookmarks of allBookmarks.values()) {
            totalCount += bookmarks.length;
        }

        if (totalCount === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No bookmarks to remove.')
            ]);
        }

        this.bookmarkService.removeAllBookmarks();
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Removed all ${totalCount} bookmark(s).`)
        ]);
    }
}
