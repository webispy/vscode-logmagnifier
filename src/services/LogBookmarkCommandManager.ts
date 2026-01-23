import * as vscode from 'vscode';
import { LogBookmarkService } from './LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { FilterItem } from '../models/Filter';
import { HighlightService } from './HighlightService';
import { Constants } from '../constants';
import { RegexUtils } from '../utils/RegexUtils';

export class LogBookmarkCommandManager {
    constructor(
        context: vscode.ExtensionContext,
        private bookmarkService: LogBookmarkService,
        private highlightService: HighlightService
    ) {
        this.registerCommands(context);
    }

    private registerCommands(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddBookmark, () => this.addBookmark()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmark, (item: BookmarkItem) => this.removeBookmark(item)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.JumpToBookmark, (item: BookmarkItem) => this.jumpToBookmark(item)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddMatchListToBookmark, (filter: FilterItem) => this.addMatchListToBookmark(filter)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddSelectionMatchesToBookmark, () => this.addSelectionMatchesToBookmark()));
        context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.removeBookmarkFile', (uri: vscode.Uri) => this.removeBookmarkFile(uri)));
        context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.copyBookmarkFile', (uri: vscode.Uri, withLineNumber: boolean) => this.copyBookmarkFile(uri, withLineNumber)));
        context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.openBookmarkFile', (uri: vscode.Uri, withLineNumber: boolean) => this.openBookmarkFile(uri, withLineNumber)));
    }

    private addBookmark() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const line = editor.selection.active.line;
            const selection = editor.selection;
            const selectedText = !selection.isEmpty ? editor.document.getText(selection) : undefined;
            this.bookmarkService.addBookmark(editor, line, { matchText: selectedText });
        }
    }

    private async addSelectionMatchesToBookmark() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage('Please select a text to search for matches.');
            return;
        }

        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            return;
        }

        // Limit the number of lines to add
        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        // Default to 500 if not set, though package.json has default
        const MAX_MATCHES_TO_ADD = config.get<number>('bookmark.maxMatches', 500);

        const text = editor.document.getText();
        const lines = text.split(/\r?\n/);
        const matchedLines: number[] = [];

        // Escape regex characters for exact match
        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedText);

        // Iterate line by line to match
        for (let i = 0; i < lines.length; i++) {
            const lineContent = lines[i];

            if (regex.test(lineContent)) {
                matchedLines.push(i);
                if (matchedLines.length >= MAX_MATCHES_TO_ADD) {
                    break;
                }
            }
        }

        if (matchedLines.length > 0) {
            const addedCount = this.bookmarkService.addBookmarks(editor, matchedLines, { matchText: selectedText });
            if (matchedLines.length >= MAX_MATCHES_TO_ADD) {
                vscode.window.showInformationMessage(`Added ${addedCount} bookmarks (Limited to first ${MAX_MATCHES_TO_ADD} matches).`);
            } else {
                vscode.window.showInformationMessage(`Added ${addedCount} bookmarks.`);
            }
        } else {
            vscode.window.showInformationMessage('No matches found in the active editor.');
        }
    }

    private async addMatchListToBookmark(filter: FilterItem) {
        if (!filter) { return; }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor found.');
            return;
        }

        const keyword = filter.keyword;
        if (!keyword) { return; }

        // Use RegexUtils to create regex for searching
        const regex = RegexUtils.create(keyword, !!filter.isRegex, !!filter.caseSensitive);
        const text = editor.document.getText();
        const lines = text.split(/\r?\n/);

        let count = 0;

        // Iterate line by line to match
        for (let i = 0; i < lines.length; i++) {
            const lineContent = lines[i];

            // Reset lastIndex as RegexUtils returns a shared RegExp instance with global flag
            regex.lastIndex = 0;

            if (regex.test(lineContent)) {
                this.bookmarkService.addBookmark(editor, i, { matchText: keyword });
                count++;
            }
        }

        if (count > 0) {
            vscode.window.showInformationMessage(`Added ${count} bookmarks.`);
        } else {
            vscode.window.showInformationMessage('No matches found in the active editor.');
        }
    }

    private removeBookmark(item: BookmarkItem) {
        if (item) {
            this.bookmarkService.removeBookmark(item);
        }
    }

    private async jumpToBookmark(item: BookmarkItem) {
        if (!item) { return; }
        try {
            const doc = await vscode.workspace.openTextDocument(item.uri);
            const editor = await vscode.window.showTextDocument(doc, { preview: true });
            const range = new vscode.Range(item.line, 0, item.line, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.start);
            this.highlightService.flashLine(editor, item.line, Constants.Configuration.Bookmark.HighlightColor);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open bookmark: ${e}`);
        }
    }

    private removeBookmarkFile(uri: vscode.Uri) {
        if (uri) {
            this.bookmarkService.removeBookmarksForUri(uri);
        }
    }

    private async copyBookmarkFile(uri: vscode.Uri, withLineNumber: boolean = true) {
        if (!uri) { return; }
        const bookmarksMap = this.bookmarkService.getBookmarks();
        const bookmarks = bookmarksMap.get(uri.toString());

        if (bookmarks && bookmarks.length > 0) {
            const content = bookmarks.map(b => withLineNumber ? `Line ${b.line + 1}: ${b.content}` : b.content).join('\n');
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage('Bookmarks copied to clipboard.');
        }
    }

    private async openBookmarkFile(uri: vscode.Uri, withLineNumber: boolean = true) {
        if (!uri) { return; }
        const bookmarksMap = this.bookmarkService.getBookmarks();
        const bookmarks = bookmarksMap.get(uri.toString());

        if (bookmarks && bookmarks.length > 0) {
            const content = bookmarks.map(b => withLineNumber ? `Line ${b.line + 1}: ${b.content}` : b.content).join('\n');
            const filename = uri.path.split('/').pop() || 'file';
            const docName = `Bookmark: ${filename}`;

            // Create a specialized URI for the untitled document to set its name
            // The format is untitled:<path> where the last segment is used as the name
            const untitledUri = vscode.Uri.parse(`untitled:${docName}`);

            try {
                const doc = await vscode.workspace.openTextDocument(untitledUri);
                const editor = await vscode.window.showTextDocument(doc);

                // Replace content
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length)
                );

                await editor.edit(editBuilder => {
                    editBuilder.replace(fullRange, content);
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to open bookmark tab: ${e}`);
            }
        }
    }
}

