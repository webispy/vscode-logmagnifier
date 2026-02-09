import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { FileHierarchyService } from '../services/FileHierarchyService';
import { BookmarkItem } from '../models/Bookmark';
import { FilterItem } from '../models/Filter';
import { HighlightService } from '../services/HighlightService';
import { Constants } from '../constants';
import { RegexUtils } from '../utils/RegexUtils';
import { EditorUtils } from '../utils/EditorUtils';

export class LogBookmarkCommandManager {
    private _lastActiveEditor: vscode.TextEditor | undefined;

    constructor(
        context: vscode.ExtensionContext,
        private bookmarkService: LogBookmarkService,
        private highlightService: HighlightService
    ) {
        this.registerCommands(context);
        this.registerEventListeners(context);
    }

    private registerEventListeners(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this._lastActiveEditor = editor;
            }
        }));

        // Initialize with current active editor
        if (vscode.window.activeTextEditor) {
            this._lastActiveEditor = vscode.window.activeTextEditor;
        }
    }

    private registerCommands(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddBookmark, async () => await this.addBookmark()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmark, (item: BookmarkItem) => this.removeBookmark(item)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.JumpToBookmark, (item: BookmarkItem) => this.jumpToBookmark(item)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddMatchListToBookmark, (filter: FilterItem) => this.addMatchListToBookmark(filter)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddSelectionMatchesToBookmark, async () => await this.addSelectionMatchesToBookmark()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmarkFile, (uri: vscode.Uri) => this.removeBookmarkFile(uri)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyBookmarkFile, (uri: vscode.Uri, withLineNumber: boolean) => this.copyBookmarkFile(uri, withLineNumber)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.OpenBookmarkFile, (uri: vscode.Uri, withLineNumber: boolean) => this.openBookmarkFile(uri, withLineNumber)));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleBookmark, async () => await this.toggleBookmark()));

        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyAllBookmarks, () => this.copyAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.OpenAllBookmarks, () => this.openAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveAllBookmarks, () => this.removeAllBookmarks()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleBookmarkWordWrap, () => this.toggleBookmarkWordWrap()));
        context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveBookmarkGroup, (groupId: string) => this.removeBookmarkGroup(groupId)));
    }

    private async getActiveEditor(): Promise<vscode.TextEditor | undefined> {
        return EditorUtils.getActiveEditorAsync(this._lastActiveEditor, 'add bookmark');
    }

    private removeBookmarkGroup(groupId: string) {
        this.bookmarkService.removeBookmarkGroup(groupId);
    }

    private getAllBookmarksContent(): string | null {
        const bookmarksMap = this.bookmarkService.getBookmarks();
        if (bookmarksMap.size === 0) { return null; }

        const allLines: string[] = [];
        const sortedUris = Array.from(bookmarksMap.keys()).sort();
        for (const uri of sortedUris) {
            const items = bookmarksMap.get(uri)!;
            items.forEach(b => allLines.push(`Line ${b.line + 1}: ${b.content}`));
        }
        return allLines.join('\n');
    }

    private getBookmarksContentForUri(uri: vscode.Uri, withLineNumber: boolean): string | null {
        const bookmarksMap = this.bookmarkService.getBookmarks();
        const bookmarks = bookmarksMap.get(uri.toString());

        if (bookmarks && bookmarks.length > 0) {
            return bookmarks.map(b => withLineNumber ? `Line ${b.line + 1}: ${b.content}` : b.content).join('\n');
        }
        return null;
    }

    private copyAllBookmarks() {
        const content = this.getAllBookmarksContent();
        if (content) {
            vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage(Constants.Messages.Info.AllBookmarksCopied);
        }
    }

    private async openAllBookmarks() {
        const content = this.getAllBookmarksContent();
        if (!content) { return; }

        const untitledUri = vscode.Uri.parse(`untitled:All Bookmarks`);
        try {
            const doc = await vscode.workspace.openTextDocument(untitledUri);
            const editor = await vscode.window.showTextDocument(doc);
            await editor.edit(editBuilder => {
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                editBuilder.replace(fullRange, content);
            });
        } catch (e) {
            vscode.window.showErrorMessage(Constants.Messages.Error.FailedToOpenBookmarks.replace('{0}', String(e)));
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

    private async addBookmark() {
        const editor = await this.getActiveEditor();
        if (!editor) { return; }

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

    private processBookmarkMatches(editor: vscode.TextEditor, matchedLines: number[], matchText: string, maxMatches: number) {
        if (matchedLines.length === 0) {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoMatchesFound);
            return;
        }

        if (matchedLines.length > maxMatches) {
            const truncatedLines = matchedLines.slice(0, maxMatches);
            vscode.window.showWarningMessage(
                Constants.Messages.Warn.FoundMoreThanMaxMatches.replace(/\{0\}/g, maxMatches.toString())
            );
            this.bookmarkService.addBookmarks(editor, truncatedLines, { matchText: matchText });
        } else {
            const count = this.bookmarkService.addBookmarks(editor, matchedLines, { matchText: matchText });
            vscode.window.showInformationMessage(Constants.Messages.Info.AddedBookmarks.replace('{0}', count.toString()));
        }
    }

    private async toggleBookmark() {
        const editor = await this.getActiveEditor();
        if (!editor) { return; }

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

        const regex = RegexUtils.create(selectedText, false, true);

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
            vscode.window.showInformationMessage(Constants.Messages.Info.RemovedBookmarks.replace('{0}', removedCount.toString()).replace('{1}', selectedText));
        } else {
            this.processBookmarkMatches(editor, matchedLines, selectedText, MAX_MATCHES);
        }
    }

    private async addSelectionMatchesToBookmark() {
        const editor = await this.getActiveEditor();
        if (!editor) { return; }

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

        const regex = RegexUtils.create(selectedText, false, true);

        const matchedLines: number[] = [];
        this.findMatchingLines(editor.document, regex, MAX_MATCHES + 1, (line) => matchedLines.push(line));

        this.processBookmarkMatches(editor, matchedLines, selectedText, MAX_MATCHES);
    }

    private async addMatchListToBookmark(filter: FilterItem) {
        if (!filter) {
            return;
        }

        const editor = await this.getActiveEditor();
        if (!editor) { return; }

        const keyword = filter.keyword;
        if (!keyword) {
            return;
        }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const MAX_MATCHES = config.get<number>(Constants.Configuration.Bookmark.MaxMatches, 500);

        const regex = RegexUtils.create(keyword, !!filter.isRegex, !!filter.caseSensitive);
        const matchedLines: number[] = [];
        this.findMatchingLines(editor.document, regex, MAX_MATCHES + 1, (line) => matchedLines.push(line));

        this.processBookmarkMatches(editor, matchedLines, keyword, MAX_MATCHES);
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
            vscode.window.showErrorMessage(Constants.Messages.Error.OpenBookmarkFailed.replace('{0}', String(e)));
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
        const content = this.getBookmarksContentForUri(uri, withLineNumber);

        if (content) {
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage(Constants.Messages.Info.BookmarksCopied);
        }
    }

    private async openBookmarkFile(uri: vscode.Uri, withLineNumber: boolean = true) {
        if (!uri) {
            return;
        }
        const content = this.getBookmarksContentForUri(uri, withLineNumber);

        if (content) {
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

                // Register with FileHierarchyService
                // The 'uri' argument is the source file containing bookmarks (Parent)
                // 'doc.uri' is the new untitled document (Child)
                FileHierarchyService.getInstance().registerChild(uri, doc.uri, 'bookmark', docName);

            } catch (e) {
                vscode.window.showErrorMessage(Constants.Messages.Error.OpenBookmarkTabFailed.replace('{0}', String(e)));
            }
        }
    }
}

