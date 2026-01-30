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
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmarkFile, (uri: vscode.Uri) => this.removeBookmarkFile(uri)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyBookmarkFile, (uri: vscode.Uri, withLineNumber: boolean) => this.copyBookmarkFile(uri, withLineNumber)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.OpenBookmarkFile, (uri: vscode.Uri, withLineNumber: boolean) => this.openBookmarkFile(uri, withLineNumber)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleBookmark, () => this.toggleBookmark()));

        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyAllBookmarks, () => this.copyAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.OpenAllBookmarks, () => this.openAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveAllBookmarks, () => this.removeAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleBookmarkWordWrap, () => this.toggleBookmarkWordWrap()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmarkGroup, (groupId: string) => this.removeBookmarkGroup(groupId)));
    }

    private removeBookmarkGroup(groupId: string) {
        this.bookmarkService.removeBookmarkGroup(groupId);
    }

    private copyAllBookmarks() {
        const bookmarksMap = this.bookmarkService.getBookmarks();
        if (bookmarksMap.size === 0) { return; }

        const allLines: string[] = [];
        const sortedUris = Array.from(bookmarksMap.keys()).sort();
        for (const uri of sortedUris) {
            const items = bookmarksMap.get(uri)!;
            items.forEach(b => allLines.push(`Line ${b.line + 1}: ${b.content}`));
        }

        vscode.env.clipboard.writeText(allLines.join('\n'));
        vscode.window.showInformationMessage('All bookmarks copied to clipboard.');
    }

    private async openAllBookmarks() {
        const bookmarksMap = this.bookmarkService.getBookmarks();
        if (bookmarksMap.size === 0) { return; }

        const allLines: string[] = [];
        const sortedUris = Array.from(bookmarksMap.keys()).sort();
        for (const uri of sortedUris) {
            const items = bookmarksMap.get(uri)!;
            items.forEach(b => allLines.push(`Line ${b.line + 1}: ${b.content}`));
        }

        const untitledUri = vscode.Uri.parse(`untitled:All Bookmarks`);
        try {
            const doc = await vscode.workspace.openTextDocument(untitledUri);
            const editor = await vscode.window.showTextDocument(doc);
            await editor.edit(editBuilder => {
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                editBuilder.replace(fullRange, allLines.join('\n'));
            });
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open all bookmarks: ${e}`);
        }
    }

    private removeAllBookmarks() {
        this.bookmarkService.removeAllBookmarks();
    }

    private toggleBookmarkWordWrap() {
        this.bookmarkService.toggleWordWrap();
        const enabled = this.bookmarkService.isWordWrapEnabled();
        vscode.window.setStatusBarMessage(`Bookmark Word Wrap: ${enabled ? 'Enabled' : 'Disabled'}`, 3000);
    }

    private addBookmark() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveEditor);
            return;
        }

        const line = editor.selection.active.line;
        // Manual "Add Bookmark" should not use selection as matchText.
        // If user wants to match selection, they should use "Add Selection Matches to Bookmark".
        const result = this.bookmarkService.addBookmark(editor, line, { matchText: undefined });
        if (!result.success && result.message) {
            vscode.window.showErrorMessage(result.message);
        }
    }

    private findMatchingLines(document: vscode.TextDocument, regex: RegExp, maxMatches: number, callback: (line: number) => void) {
        const lineCount = document.lineCount;
        let matchCount = 0;
        for (let i = 0; i < lineCount; i++) {
            if (matchCount >= maxMatches) {
                break;
            }
            const line = document.lineAt(i);
            const lineContent = line.text;
            regex.lastIndex = 0;
            if (regex.test(lineContent)) {
                callback(i);
                matchCount++;
            }
        }
    }

    private toggleBookmark() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveEditor);
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            // Case 1: Single line toggle
            const line = selection.active.line;
            const result = this.bookmarkService.toggleBookmark(editor, line);
            if (!result.success && result.message) {
                vscode.window.showErrorMessage(result.message);
            }
            return;
        }

        // Case 2: Selection based keyword toggle
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            return;
        }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const MAX_MATCHES = config.get<number>(Constants.Configuration.Bookmark.MaxMatches, 500);

        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedText);

        const matchedLines: number[] = [];
        this.findMatchingLines(editor.document, regex, MAX_MATCHES + 1, (line) => matchedLines.push(line));

        if (matchedLines.length === 0) {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoMatchesFound);
            return;
        }

        // Check if ALL matched lines are already bookmarked WITH THE SAME KEYWORD
        const allBookmarked = matchedLines.every(line =>
            this.bookmarkService.getBookmarkAt(editor.document.uri, line, selectedText) !== undefined
        );

        if (allBookmarked) {
            let removedCount = 0;
            for (const line of matchedLines) {
                const b = this.bookmarkService.getBookmarkAt(editor.document.uri, line, selectedText);
                if (b) {
                    this.bookmarkService.removeBookmark(b);
                    removedCount++;
                }
            }
            vscode.window.showInformationMessage(`Removed ${removedCount} bookmarks matching selection '${selectedText}'.`);
        } else {
            if (matchedLines.length > MAX_MATCHES) {
                const truncatedLines = matchedLines.slice(0, MAX_MATCHES);
                vscode.window.showWarningMessage(
                    `Found more than ${MAX_MATCHES} matches. Limited to ${MAX_MATCHES} bookmarks based on your settings.`
                );
                this.bookmarkService.addBookmarks(editor, truncatedLines, { matchText: selectedText });
            } else {
                const count = this.bookmarkService.addBookmarks(editor, matchedLines, { matchText: selectedText });
                vscode.window.showInformationMessage(Constants.Messages.Info.AddedBookmarks.replace('{0}', count.toString()));
            }
        }
    }

    private addSelectionMatchesToBookmark() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveEditor);
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage(Constants.Messages.Info.SelectTextToSearch);
            return;
        }

        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            return;
        }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const MAX_MATCHES = config.get<number>(Constants.Configuration.Bookmark.MaxMatches, 500);

        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedText);

        const matchedLines: number[] = [];
        this.findMatchingLines(editor.document, regex, MAX_MATCHES + 1, (line) => matchedLines.push(line));

        if (matchedLines.length > 0) {
            if (matchedLines.length > MAX_MATCHES) {
                const truncatedLines = matchedLines.slice(0, MAX_MATCHES);
                vscode.window.showWarningMessage(
                    `Found more than ${MAX_MATCHES} matches. Limited to ${MAX_MATCHES} bookmarks based on your settings.`
                );
                this.bookmarkService.addBookmarks(editor, truncatedLines, { matchText: selectedText });
            } else {
                const count = this.bookmarkService.addBookmarks(editor, matchedLines, { matchText: selectedText });
                vscode.window.showInformationMessage(Constants.Messages.Info.AddedBookmarks.replace('{0}', count.toString()));
            }
        } else {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoMatchesFound);
        }
    }

    private async addMatchListToBookmark(filter: FilterItem) {
        if (!filter) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveEditor);
            return;
        }

        const keyword = filter.keyword;
        if (!keyword) {
            return;
        }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const MAX_MATCHES = config.get<number>(Constants.Configuration.Bookmark.MaxMatches, 500);

        const regex = RegexUtils.create(keyword, !!filter.isRegex, !!filter.caseSensitive);
        const matchedLines: number[] = [];
        this.findMatchingLines(editor.document, regex, MAX_MATCHES + 1, (line) => matchedLines.push(line));

        if (matchedLines.length > 0) {
            if (matchedLines.length > MAX_MATCHES) {
                const truncatedLines = matchedLines.slice(0, MAX_MATCHES);
                vscode.window.showWarningMessage(
                    `Found more than ${MAX_MATCHES} matches. Limited to ${MAX_MATCHES} bookmarks based on your settings.`
                );
                this.bookmarkService.addBookmarks(editor, truncatedLines, { matchText: keyword });
            } else {
                const count = this.bookmarkService.addBookmarks(editor, matchedLines, { matchText: keyword });
                vscode.window.showInformationMessage(Constants.Messages.Info.AddedBookmarks.replace('{0}', count.toString()));
            }
        } else {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoMatchesFound);
        }
    }

    private removeBookmark(item: BookmarkItem) {
        if (item) {
            this.bookmarkService.removeBookmark(item);
        }
    }

    private async jumpToBookmark(item: BookmarkItem) {
        if (!item) {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(item.uri);

            // Check if the document is already visible in any editor
            let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === item.uri.toString());

            if (editor) {
                // If found, reveal it
                // We need to showTextDocument with the existing viewColumn to focus it
                editor = await vscode.window.showTextDocument(doc, {
                    viewColumn: editor.viewColumn,
                    preview: true
                });
            } else {
                // If not found, open in active editor (or new one if needed) as before
                editor = await vscode.window.showTextDocument(doc, { preview: true });
            }

            const range = new vscode.Range(item.line, 0, item.line, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.start);
            this.highlightService.flashLine(editor, item.line, Constants.Configuration.Bookmark.HighlightColor);
        } catch (e) {
            vscode.window.showErrorMessage(Constants.Messages.Error.OpenBookmarkFailed.replace('{0}', e as string));
        }
    }

    private removeBookmarkFile(uri: vscode.Uri) {
        if (uri) {
            this.bookmarkService.removeBookmarksForUri(uri);
        }
    }

    private async copyBookmarkFile(uri: vscode.Uri, withLineNumber: boolean = true) {
        if (!uri) {
            return;
        }
        const bookmarksMap = this.bookmarkService.getBookmarks();
        const bookmarks = bookmarksMap.get(uri.toString());

        if (bookmarks && bookmarks.length > 0) {
            const content = bookmarks.map(b => withLineNumber ? `Line ${b.line + 1}: ${b.content}` : b.content).join('\n');
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage(Constants.Messages.Info.BookmarksCopied);
        }
    }

    private async openBookmarkFile(uri: vscode.Uri, withLineNumber: boolean = true) {
        if (!uri) {
            return;
        }
        const bookmarksMap = this.bookmarkService.getBookmarks();
        const bookmarks = bookmarksMap.get(uri.toString());

        if (bookmarks && bookmarks.length > 0) {
            const content = bookmarks.map(b => withLineNumber ? `Line ${b.line + 1}: ${b.content}` : b.content).join('\n');
            const filename = uri.path.split('/').pop() || 'file';
            const docName = `Bookmark: ${filename}`;

            // Create a specialized URI for the untitled document to set its name
            const untitledUri = vscode.Uri.parse(`${Constants.Schemes.Untitled}:${docName}`);

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
                vscode.window.showErrorMessage(Constants.Messages.Error.OpenBookmarkTabFailed.replace('{0}', e as string));
            }
        }
    }
}
