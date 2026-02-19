import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { BookmarkItem, BookmarkResult } from '../models/Bookmark';
import { Constants } from '../Constants';
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

    // Track missing files
    private _missingFiles: Set<string> = new Set();
    // Map of directory path -> FileSystemWatcher
    private _fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

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

    public isFileMissing(uriStr: string): boolean {
        return this._missingFiles.has(uriStr);
    }

    private updateWatcher() {
        // Identify all unique directories for current bookmarks
        const directories = new Set<string>();
        for (const key of this._bookmarks.keys()) {
            try {
                const uri = vscode.Uri.parse(key);
                if (uri.scheme === 'file') {
                    // Use standard path.dirname
                    const dir = vscode.Uri.joinPath(uri, '..').fsPath;
                    directories.add(dir);
                }
            } catch (_e) {
                // Ignore non-file URIs or errors
            }
        }

        // 1. Remove watchers for directories no longer needed
        for (const [dir, watcher] of this._fileWatchers.entries()) {
            if (!directories.has(dir)) {
                watcher.dispose();
                this._fileWatchers.delete(dir);
            }
        }

        // 2. Create watchers for new directories
        for (const dir of directories) {
            if (!this._fileWatchers.has(dir)) {
                try {
                    // Watch for changes in this directory
                    // patterns: * (all files)
                    const pattern = new vscode.RelativePattern(dir, '*');
                    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

                    watcher.onDidDelete(uri => this.handleFileDelete(uri));
                    watcher.onDidCreate(uri => this.handleFileCreate(uri));

                    this._fileWatchers.set(dir, watcher);
                } catch (e) {
                    this.logger.error(`Failed to create watcher for ${dir}: ${e}`);
                }
            }
        }
    }

    private handleFileDelete(uri: vscode.Uri) {
        const key = uri.toString();
        if (this._bookmarks.has(key)) {
            this._missingFiles.add(key);
            this._onDidChangeBookmarks.fire();
        }
    }

    private handleFileCreate(uri: vscode.Uri) {
        const key = uri.toString();
        if (this._bookmarks.has(key)) {
            this._missingFiles.delete(key);
            this._onDidChangeBookmarks.fire();
        }
    }

    private async checkFilesExistence() {
        const keys = Array.from(this._bookmarks.keys());
        // Use Promise.all for parallel checking
        const checkPromises = keys.map(async (key) => {
            try {
                const uri = vscode.Uri.parse(key);
                if (uri.scheme === 'file') {
                    try {
                        await fs.promises.access(uri.fsPath);
                        this._missingFiles.delete(key);
                    } catch {
                        this._missingFiles.add(key);
                    }
                }
            } catch (e) {
                this.logger.warn(`Error checking file existence for ${key}: ${e}`);
            }
        });

        await Promise.all(checkPromises);
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
                this.updateWatcher();
            }
            this._missingFiles.delete(key);

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
            this.updateWatcher();
        }
        this._missingFiles.delete(key);

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
                if (bookmarks.length === 0) {
                    this._bookmarks.delete(key);
                    this.updateWatcher();
                }
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
            this._missingFiles.delete(key);

            // Remove from file order
            this._fileOrder = this._fileOrder.filter(k => k !== key);

            this.updateWatcher();
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public removeAllBookmarks() {
        this._bookmarks.clear();
        this._fileOrder = [];
        this._missingFiles.clear();
        this.updateWatcher();
        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    public removeBookmarkGroup(groupId: string) {
        let anyRemoved = false;
        let keysRemoved = false;

        // 1. Remove from master bookmark list
        for (const [uri, items] of this._bookmarks.entries()) {
            const initialLength = items.length;
            const filtered = items.filter(item => item.groupId !== groupId);

            if (filtered.length !== initialLength) {
                anyRemoved = true;
                if (filtered.length === 0) {
                    this._bookmarks.delete(uri);
                    this._missingFiles.delete(uri);
                    // Update file order if file is empty
                    this._fileOrder = this._fileOrder.filter(k => k !== uri);
                    keysRemoved = true;
                } else {
                    this._bookmarks.set(uri, filtered);
                }
            }
        }

        if (anyRemoved) {
            if (keysRemoved) {
                this.updateWatcher();
            }
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
        // Return a defensive copy: new Map with new Arrays for values
        // This prevents consumers from mutating the internal arrays (e.g. push/pop)
        const copy = new Map<string, BookmarkItem[]>();
        for (const [key, value] of this._bookmarks) {
            copy.set(key, [...value]);
        }
        return copy;
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

        for (const watcher of this._fileWatchers.values()) {
            watcher.dispose();
        }
        this._fileWatchers.clear();
    }

    private async saveToState() {
        const bookmarksData: { [key: string]: unknown[] } = {};
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

        await this.context.globalState.update(Constants.GlobalState.BookmarkIncludeLnMap, lnObj);
        await this.context.globalState.update(Constants.GlobalState.BookmarkWordWrap, this._isWordWrapEnabled);

        // Save file order
        await this.context.globalState.update(Constants.GlobalState.BookmarkFileOrder, this._fileOrder);

        this.logger.info(`Saved bookmarks to state. Files with bookmarks: ${this._bookmarks.size}`);
    }

    private loadFromState() {
        const bookmarksData = this.context.globalState.get<{ [key: string]: unknown[] }>(Constants.GlobalState.Bookmarks);

        if (bookmarksData) {
            for (const key in bookmarksData) {
                const bookmarks = bookmarksData[key].map(item => {
                    const b = item as Record<string, unknown>; // Safe cast after check
                    try {
                        if (!b || typeof b !== 'object') {
                            return null;
                        }
                        if (!b.id || !b.uri) {
                            return null;
                        }

                        return {
                            id: b.id as string,
                            uri: vscode.Uri.parse(b.uri as string),
                            line: typeof b.line === 'number' ? b.line : 0,
                            content: (b.content as string) || '',
                            groupId: (b.groupId as string) || Date.now().toString(), // Fallback for old bookmarks
                            matchText: b.matchText as string | undefined
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

        const lnMapData = this.context.globalState.get<Record<string, boolean>>(Constants.GlobalState.BookmarkIncludeLnMap);

        // Load file order
        const fileOrderData = this.context.globalState.get<string[]>(Constants.GlobalState.BookmarkFileOrder);
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

        const wordWrapData = this.context.globalState.get<boolean>(Constants.GlobalState.BookmarkWordWrap);
        if (wordWrapData !== undefined) {
            this._isWordWrapEnabled = wordWrapData;
        }

        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
        this._onDidChangeBookmarks.fire();

        this.checkFilesExistence();
        this.updateWatcher();

        this.logger.info(`[Bookmark] Loaded bookmarks from state. Files with bookmarks: ${this._bookmarks.size}`);
    }
}
