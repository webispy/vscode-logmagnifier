import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BookmarkItem, BookmarkResult } from '../models/Bookmark';
import { Constants } from '../constants';
import { SourceMapService } from './SourceMapService';

import { Logger } from './Logger';

export class LogBookmarkService implements vscode.Disposable {
    private _bookmarks: Map<string, BookmarkItem[]> = new Map();
    // History stack of active bookmark IDs in each file (URI -> steps)
    private _fileOrder: string[] = [];

    private _onDidChangeBookmarks: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeBookmarks: vscode.Event<void> = this._onDidChangeBookmarks.event;
    private _onDidAddBookmark: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidAddBookmark: vscode.Event<vscode.Uri> = this._onDidAddBookmark.event;

    private _includeLineNumbers: Map<string, boolean> = new Map();
    private _isWordWrapEnabled: boolean = false;

    private decorationType: vscode.TextEditorDecorationType;

    private context: vscode.ExtensionContext;
    private logger: Logger;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath('resources/bookmark.svg'),
            gutterIconSize: 'contain',
            overviewRulerColor: 'blue',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        // Load bookmarks from state
        this.loadFromState();

        // Listen for editor changes to update decorations
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            editors.forEach(editor => this.updateDecorations(editor));
        }, null, context.subscriptions);

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.updateDecorations(editor);
            }
        }, null, context.subscriptions);

        // Remove bookmarks for untitled files when they are closed
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.uri.scheme === Constants.Schemes.Untitled) {
                this.removeBookmarksForUri(doc.uri);
            }
        }, null, context.subscriptions);
    }

    public getBookmarkAt(uri: vscode.Uri, line: number, matchText?: string): BookmarkItem | undefined {
        const key = uri.toString();
        const bookmarks = this._bookmarks.get(key);
        if (!bookmarks) {
            return undefined;
        }

        if (matchText) {
            return bookmarks.find(b => b.line === line && b.matchText === matchText);
        }
        return bookmarks.find(b => b.line === line);
    }

    public toggleBookmark(editor: vscode.TextEditor, line: number): BookmarkResult {
        const bookmark = this.getBookmarkAt(editor.document.uri, line);
        if (bookmark) {
            this.removeBookmark(bookmark);
            return { success: true };
        } else {
            return this.addBookmark(editor, line);
        }
    }

    private updateFileOrder(key: string) {
        if (this._fileOrder.includes(key)) {
            this._fileOrder = this._fileOrder.filter(k => k !== key);
        }
        this._fileOrder.unshift(key);
    }

    private createBookmarkId(): string {
        return crypto.randomUUID();
    }

    public addBookmark(editor: vscode.TextEditor, line: number, options?: { matchText?: string, groupId?: string }): BookmarkResult {
        try {
            const matchText = options?.matchText;
            const doc = editor.document;
            const uri = doc.uri;
            const key = uri.toString();

            // Basic validations
            if (uri.scheme === 'output') {
                return { success: false, message: 'Bookmarks are not supported in output panels.' };
            }
            if (uri.scheme === 'vscode-terminal') {
                return { success: false, message: 'Bookmarks are not supported for terminal content.' };
            }
            if (uri.scheme === 'debug') {
                return { success: false, message: 'Bookmarks are not supported in debug console.' };
            }

            if (line < 0 || line >= doc.lineCount) {
                return { success: false, message: 'Invalid line number.' };
            }

            // Check if it's a filtered log
            const sourceMapService = SourceMapService.getInstance();
            if (sourceMapService.hasMapping(uri)) {
                // We show a warning but allow adding the bookmark
                vscode.window.showWarningMessage(Constants.Messages.Warn.FilteredLogViewBookmark);
            }

            // LIFO Sorting: Move to top of file order
            this.updateFileOrder(key);

            if (!this._bookmarks.has(key)) {
                this._bookmarks.set(key, []);
            }

            const list = this._bookmarks.get(key)!;

            const isDuplicate = list.some(b =>
                b.line === line &&
                b.matchText === matchText
            );

            if (isDuplicate) {
                return { success: false, message: 'Bookmark already exists for this keyword on this line.' };
            }

            const lineContent = doc.lineAt(line).text;
            const groupId = options?.groupId || Date.now().toString();
            const bookmark: BookmarkItem = {
                id: this.createBookmarkId(),
                uri: uri,
                line: line,
                content: lineContent,
                groupId: groupId,
                matchText: matchText
            };

            list.push(bookmark);
            list.sort((a, b) => a.line - b.line);

            this._onDidChangeBookmarks.fire();
            this._onDidAddBookmark.fire(uri);
            this.refreshAllDecorations();
            this.saveToState();
            return { success: true };
        } catch (e) {
            this.logger.error(`Error adding bookmark: ${e}`);
            return { success: false, message: `Internal error: ${e}` };
        }
    }

    public addBookmarks(editor: vscode.TextEditor, lines: number[], options?: { matchText?: string, groupId?: string }) {
        const matchText = options?.matchText;
        const uri = editor.document.uri;
        const key = uri.toString();

        // LIFO Sorting: Move to top of file order
        this.updateFileOrder(key);

        if (!this._bookmarks.has(key)) {
            this._bookmarks.set(key, []);
        }

        const list = this._bookmarks.get(key)!;

        let addedCount = 0;
        const groupId = options?.groupId || Date.now().toString();

        for (const line of lines) {
            // Check if EXACT exists
            if (list.some(b => b.line === line && b.matchText === matchText)) {
                continue;
            }

            const lineContent = editor.document.lineAt(line).text;
            const bookmark: BookmarkItem = {
                id: this.createBookmarkId(),
                uri: uri,
                line: line,
                content: lineContent,
                groupId: groupId,
                matchText: matchText
            };

            list.push(bookmark);
            addedCount++;
        }

        if (addedCount > 0) {
            list.sort((a, b) => a.line - b.line);

            this._onDidChangeBookmarks.fire();
            this._onDidAddBookmark.fire(uri);
            this.refreshAllDecorations();
            this.saveToState();
        }

        return addedCount;
    }

    public removeBookmark(item: BookmarkItem) {
        const key = item.uri.toString();
        const bookmarks = this._bookmarks.get(key);
        if (bookmarks) {
            const index = bookmarks.findIndex(b => b.id === item.id);
            if (index !== -1) {
                bookmarks.splice(index, 1);
                this._onDidChangeBookmarks.fire();
                this.refreshAllDecorations();
                this.saveToState();
            }
        }
    }

    public removeBookmarksForUri(uri: vscode.Uri) {
        const key = uri.toString();

        // Completely remove from bookmarks map
        if (this._bookmarks.has(key)) {
            this._bookmarks.delete(key);

            // Remove from file order
            this._fileOrder = this._fileOrder.filter(k => k !== key);

            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public removeAllBookmarks() {
        this._bookmarks.clear();
        this._fileOrder = [];
        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    public removeBookmarkGroup(groupId: string) {
        let anyRemoved = false;

        // 1. Remove from master bookmark list
        for (const [uri, items] of this._bookmarks.entries()) {
            const initialLength = items.length;
            const filtered = items.filter(item => item.groupId !== groupId);

            if (filtered.length !== initialLength) {
                anyRemoved = true;
                if (filtered.length === 0) {
                    this._bookmarks.delete(uri);
                    // Update file order if file is empty
                    this._fileOrder = this._fileOrder.filter(k => k !== uri);
                } else {
                    this._bookmarks.set(uri, filtered);
                }
            }
        }

        if (anyRemoved) {
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }


    public getActiveLinesCount(): number {
        // Legacy/Global count: sum of all files
        let total = 0;
        for (const uri of this._bookmarks.keys()) {
            total += this.getFileActiveLinesCount(uri);
        }
        return total;
    }

    public getFileActiveLinesCount(uriKey: string): number {
        const bookmarks = this._bookmarks.get(uriKey);
        return bookmarks ? bookmarks.length : 0;
    }

    public isWordWrapEnabled(): boolean {
        return this._isWordWrapEnabled;
    }

    public toggleWordWrap() {
        this._isWordWrapEnabled = !this._isWordWrapEnabled;
        this._onDidChangeBookmarks.fire();
        this.saveToState();
    }

    public isIncludeLineNumbersEnabled(uriKey: string): boolean {
        return this._includeLineNumbers.get(uriKey) || false;
    }

    public toggleIncludeLineNumbers(uriKey: string) {
        const current = this.isIncludeLineNumbersEnabled(uriKey);
        this._includeLineNumbers.set(uriKey, !current);
        this._onDidChangeBookmarks.fire();
        this.saveToState();
    }

    public getHistoryGroupsCount(): number {
        // Legacy/Global count
        let total = 0;
        for (const uri of this._bookmarks.keys()) {
            total += this.getFileHistoryGroupsCount(uri);
        }
        return total;
    }

    public getFileHistoryGroupsCount(uriKey: string): number {
        const bookmarks = this._bookmarks.get(uriKey) || [];
        const uniqueGroupIds = new Set<string>();
        for (const item of bookmarks) {
            if (item.groupId) {
                uniqueGroupIds.add(item.groupId);
            }
        }
        return uniqueGroupIds.size;
    }

    private refreshAllDecorations() {
        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
    }

    public getBookmarks(): Map<string, BookmarkItem[]> {
        return new Map(this._bookmarks);
    }

    /*
     * Returns file keys sorted by insertion order (LIFO).
     */
    public getFileKeys(): string[] {
        // Filter out any keys that might have been deleted from _bookmarks but lingering in _fileOrder (safety check)
        // And append any new keys that might be in _bookmarks but not in _fileOrder (migration/safety)
        const validKeys = this._fileOrder.filter(key => this._bookmarks.has(key));
        const missingKeys = Array.from(this._bookmarks.keys()).filter(key => !validKeys.includes(key));
        return [...validKeys, ...missingKeys.sort()]; // Fallback to alpha sort for missing
    }

    private updateDecorations(editor: vscode.TextEditor) {
        try {
            const key = editor.document.uri.toString();
            const activeBookmarks = this._bookmarks.get(key);

            if (activeBookmarks && activeBookmarks.length > 0) {
                const ranges = activeBookmarks.map(b => new vscode.Range(b.line, 0, b.line, 0));
                editor.setDecorations(this.decorationType, ranges);
            } else {
                editor.setDecorations(this.decorationType, []);
            }
        } catch (e) {
            this.logger.error(`Error updating decorations: ${e}`);
        }
    }

    public dispose() {
        this.decorationType.dispose();
        this._onDidChangeBookmarks.dispose();
        this._onDidAddBookmark.dispose();
    }

    private async saveToState() {
        const bookmarksData: { [key: string]: any[] } = {};
        for (const [key, bookmarks] of this._bookmarks) {
            bookmarksData[key] = bookmarks.map(b => ({
                id: b.id,
                uri: b.uri.toString(),
                line: b.line,
                content: b.content,
                groupId: b.groupId,
                matchText: b.matchText
            }));
        }
        await this.context.globalState.update(Constants.GlobalState.Bookmarks, bookmarksData);

        // Convert _includeLineNumbers Map to Object for storage
        const lnObj: Record<string, boolean> = {};
        for (const [k, v] of this._includeLineNumbers.entries()) { lnObj[k] = v; }

        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_include_ln_map', lnObj);
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_wordWrap', this._isWordWrapEnabled);

        // Save file order
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_fileOrder', this._fileOrder);

        this.logger.info(`Saved bookmarks to state. Files with bookmarks: ${this._bookmarks.size}`);
    }

    private loadFromState() {
        const bookmarksData = this.context.globalState.get<{ [key: string]: any[] }>(Constants.GlobalState.Bookmarks);

        if (bookmarksData) {
            for (const key in bookmarksData) {
                const bookmarks = bookmarksData[key].map(b => {
                    try {
                        if (!b || typeof b !== 'object') {
                            return null;
                        }
                        if (!b.id || !b.uri) {
                            return null;
                        }

                        return {
                            id: b.id,
                            uri: vscode.Uri.parse(b.uri),
                            line: typeof b.line === 'number' ? b.line : 0,
                            content: b.content || '',
                            groupId: b.groupId || Date.now().toString(), // Fallback for old bookmarks
                            matchText: b.matchText
                        } as BookmarkItem;
                    } catch (e) {
                        this.logger.error(`Error parsing bookmark from state: ${e}`);
                        return null;
                    }
                }).filter(b => b !== null) as BookmarkItem[];

                if (bookmarks.length > 0) {
                    this._bookmarks.set(key, bookmarks);
                }
            }
        }

        const lnMapData = this.context.globalState.get<Record<string, boolean>>(Constants.GlobalState.Bookmarks + '_include_ln_map');

        // Load file order
        const fileOrderData = this.context.globalState.get<string[]>(Constants.GlobalState.Bookmarks + '_fileOrder');
        if (fileOrderData) {
            this._fileOrder = fileOrderData;
        } else {
            // Migration: initialize with whatever we have, sorted alphabetically or just keys
            this._fileOrder = Array.from(this._bookmarks.keys()).sort();
        }

        if (lnMapData) {
            for (const key in lnMapData) {
                this._includeLineNumbers.set(key, lnMapData[key]);
            }
        }

        const wordWrapData = this.context.globalState.get<boolean>(Constants.GlobalState.Bookmarks + '_wordWrap');
        if (wordWrapData !== undefined) {
            this._isWordWrapEnabled = wordWrapData;
        }

        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
        this._onDidChangeBookmarks.fire();
        this.logger.info(`[Bookmark] Loaded bookmarks from state. Files with bookmarks: ${this._bookmarks.size}`);
    }
}
