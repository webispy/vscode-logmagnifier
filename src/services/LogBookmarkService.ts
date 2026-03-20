import * as crypto from 'crypto';
import * as fs from 'fs';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { BookmarkItem, BookmarkResult } from '../models/Bookmark';

import { Logger } from './Logger';
import { SourceMapService } from './SourceMapService';

export class LogBookmarkService implements vscode.Disposable {
    private _onDidChangeBookmarks: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeBookmarks: vscode.Event<void> = this._onDidChangeBookmarks.event;
    private _onDidAddBookmark: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidAddBookmark: vscode.Event<vscode.Uri> = this._onDidAddBookmark.event;

    private bookmarkMap: Map<string, BookmarkItem[]> = new Map();
    private fileOrder: string[] = [];
    private includeLineNumbers: Map<string, boolean> = new Map();
    private wordWrapEnabled: boolean = false;
    private decorationType: vscode.TextEditorDecorationType;
    private context: vscode.ExtensionContext;
    private logger: Logger;
    private missingFiles: Set<string> = new Set();
    private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private saveDebounceTimer: NodeJS.Timeout | undefined;
    private watcherDebounceTimer: NodeJS.Timeout | undefined;

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

    /** Returns whether the bookmarked file at the given URI string is missing from disk. */
    public isFileMissing(uriStr: string): boolean {
        return this.missingFiles.has(uriStr);
    }

    private updateWatcher() {
        if (this.watcherDebounceTimer) {
            clearTimeout(this.watcherDebounceTimer);
        }
        this.watcherDebounceTimer = setTimeout(() => {
            this.watcherDebounceTimer = undefined;
            this.updateWatcherImmediate();
        }, 150);
    }

    private updateWatcherImmediate() {
        // Identify all unique directories for current bookmarks
        const directories = new Set<string>();
        for (const key of this.bookmarkMap.keys()) {
            try {
                const uri = vscode.Uri.parse(key);
                if (uri.scheme === 'file') {
                    // Use standard path.dirname
                    const dir = vscode.Uri.joinPath(uri, '..').fsPath;
                    directories.add(dir);
                }
            } catch {
                // Ignore non-file URIs or errors
            }
        }

        // 1. Remove watchers for directories no longer needed
        for (const [dir, watcher] of this.fileWatchers.entries()) {
            if (!directories.has(dir)) {
                watcher.dispose();
                this.fileWatchers.delete(dir);
            }
        }

        // 2. Create watchers for new directories
        for (const dir of directories) {
            if (!this.fileWatchers.has(dir)) {
                try {
                    // Watch for changes in this directory
                    // patterns: * (all files)
                    const pattern = new vscode.RelativePattern(dir, '*');
                    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

                    watcher.onDidDelete(uri => this.handleFileDelete(uri));
                    watcher.onDidCreate(uri => this.handleFileCreate(uri));

                    this.fileWatchers.set(dir, watcher);
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    this.logger.error(`[LogBookmarkService] Failed to create watcher for ${dir}: ${msg}`);
                }
            }
        }
    }

    private handleFileDelete(uri: vscode.Uri) {
        const key = uri.toString();
        if (this.bookmarkMap.has(key)) {
            this.missingFiles.add(key);
            this._onDidChangeBookmarks.fire();
        }
    }

    private handleFileCreate(uri: vscode.Uri) {
        const key = uri.toString();
        if (this.bookmarkMap.has(key)) {
            this.missingFiles.delete(key);
            this._onDidChangeBookmarks.fire();
        }
    }

    private async checkFilesExistence() {
        const keys = Array.from(this.bookmarkMap.keys());
        // Use Promise.all for parallel checking
        const checkPromises = keys.map(async (key) => {
            try {
                const uri = vscode.Uri.parse(key);
                if (uri.scheme === 'file') {
                    try {
                        await fs.promises.access(uri.fsPath);
                        this.missingFiles.delete(key);
                    } catch {
                        this.missingFiles.add(key);
                    }
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.warn(`[LogBookmarkService] Error checking file existence for ${key}: ${msg}`);
            }
        });

        await Promise.all(checkPromises);
    }

    /** Returns the bookmark at the given URI and line, optionally filtered by match text. */
    public getBookmarkAt(uri: vscode.Uri, line: number, matchText?: string): BookmarkItem | undefined {
        const key = uri.toString();
        const bookmarks = this.bookmarkMap.get(key);
        if (!bookmarks) {
            return undefined;
        }

        if (matchText) {
            return bookmarks.find(b => b.line === line && b.matchText === matchText);
        }
        return bookmarks.find(b => b.line === line);
    }

    /** Adds a bookmark at the given line if none exists, or removes it if one does. */
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
        if (this.fileOrder.includes(key)) {
            this.fileOrder = this.fileOrder.filter(k => k !== key);
        }
        this.fileOrder.unshift(key);
    }

    private createBookmarkId(): string {
        return crypto.randomUUID();
    }

    /**
     * Adds a single bookmark at the specified line in the editor.
     * @param editor - The text editor containing the document to bookmark.
     * @param line - Zero-based line number to bookmark.
     * @param options - Optional match text for keyword bookmarks and group ID for batch association.
     * @returns A result indicating success or a failure message.
     */
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

            if (!this.bookmarkMap.has(key)) {
                this.bookmarkMap.set(key, []);
                this.updateWatcher();
            }
            this.missingFiles.delete(key);

            const list = this.bookmarkMap.get(key) ?? [];

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
            this.debouncedSave();
            return { success: true };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[LogBookmarkService] Error adding bookmark: ${msg}`);
            return { success: false, message: `Internal error: ${msg}` };
        }
    }

    /**
     * Adds bookmarks at multiple lines in a single batch, skipping duplicates.
     * @returns The number of bookmarks actually added.
     */
    public addBookmarks(editor: vscode.TextEditor, lines: number[], options?: { matchText?: string, groupId?: string }) {
        const matchText = options?.matchText;
        const uri = editor.document.uri;
        const key = uri.toString();

        // LIFO Sorting: Move to top of file order
        this.updateFileOrder(key);

        if (!this.bookmarkMap.has(key)) {
            this.bookmarkMap.set(key, []);
            this.updateWatcher();
        }
        this.missingFiles.delete(key);

        const list = this.bookmarkMap.get(key) ?? [];

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
            this.debouncedSave();
        }

        return addedCount;
    }

    /** Removes a single bookmark by its identity. */
    public removeBookmark(item: BookmarkItem) {
        const key = item.uri.toString();
        const bookmarks = this.bookmarkMap.get(key);
        if (bookmarks) {
            const index = bookmarks.findIndex(b => b.id === item.id);
            if (index !== -1) {
                bookmarks.splice(index, 1);
                if (bookmarks.length === 0) {
                    this.bookmarkMap.delete(key);
                    this.updateWatcher();
                }
                this._onDidChangeBookmarks.fire();
                this.refreshAllDecorations();
                this.debouncedSave();
            }
        }
    }

    /** Removes all bookmarks associated with the given document URI. */
    public removeBookmarksForUri(uri: vscode.Uri) {
        const key = uri.toString();

        // Completely remove from bookmarks map
        if (this.bookmarkMap.has(key)) {
            this.bookmarkMap.delete(key);
            this.missingFiles.delete(key);

            // Remove from file order
            this.fileOrder = this.fileOrder.filter(k => k !== key);

            this.updateWatcher();
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.debouncedSave();
        }
    }

    /** Clears all bookmarks across every file. */
    public removeAllBookmarks() {
        this.bookmarkMap.clear();
        this.fileOrder = [];
        this.missingFiles.clear();
        this.updateWatcher();
        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    /** Removes all bookmarks that share the given group ID across all files. */
    public removeBookmarkGroup(groupId: string) {
        let anyRemoved = false;
        let keysRemoved = false;

        // 1. Remove from master bookmark list
        for (const [uri, items] of this.bookmarkMap.entries()) {
            const initialLength = items.length;
            const filtered = items.filter(item => item.groupId !== groupId);

            if (filtered.length !== initialLength) {
                anyRemoved = true;
                if (filtered.length === 0) {
                    this.bookmarkMap.delete(uri);
                    this.missingFiles.delete(uri);
                    // Update file order if file is empty
                    this.fileOrder = this.fileOrder.filter(k => k !== uri);
                    keysRemoved = true;
                } else {
                    this.bookmarkMap.set(uri, filtered);
                }
            }
        }

        if (anyRemoved) {
            if (keysRemoved) {
                this.updateWatcher();
            }
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.debouncedSave();
        }
    }

    /** Returns the total number of bookmarked lines across all files. */
    public getActiveLinesCount(): number {
        // Legacy/Global count: sum of all files
        let total = 0;
        for (const uri of this.bookmarkMap.keys()) {
            total += this.getFileActiveLinesCount(uri);
        }
        return total;
    }

    /** Returns the number of bookmarked lines for a specific file URI key. */
    public getFileActiveLinesCount(uriKey: string): number {
        const bookmarks = this.bookmarkMap.get(uriKey);
        return bookmarks ? bookmarks.length : 0;
    }

    /** Returns whether word wrap is enabled in the bookmarks view. */
    public isWordWrapEnabled(): boolean {
        return this.wordWrapEnabled;
    }

    /** Toggles word wrap for the bookmarks view and persists the setting. */
    public toggleWordWrap() {
        this.wordWrapEnabled = !this.wordWrapEnabled;
        this._onDidChangeBookmarks.fire();
        this.saveToState();
    }

    /** Returns whether line numbers are shown for bookmarks in the given file. */
    public isIncludeLineNumbersEnabled(uriKey: string): boolean {
        return this.includeLineNumbers.get(uriKey) ?? false;
    }

    /** Toggles line number display for bookmarks in the given file and persists the setting. */
    public toggleIncludeLineNumbers(uriKey: string) {
        const current = this.isIncludeLineNumbersEnabled(uriKey);
        this.includeLineNumbers.set(uriKey, !current);
        this._onDidChangeBookmarks.fire();
        this.saveToState();
    }

    /** Returns the total number of distinct bookmark groups across all files. */
    public getHistoryGroupsCount(): number {
        // Legacy/Global count
        let total = 0;
        for (const uri of this.bookmarkMap.keys()) {
            total += this.getFileHistoryGroupsCount(uri);
        }
        return total;
    }

    /** Returns the number of distinct bookmark groups for a specific file URI key. */
    public getFileHistoryGroupsCount(uriKey: string): number {
        const bookmarks = this.bookmarkMap.get(uriKey) || [];
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

    /** Returns a defensive copy of the bookmark map, preventing external mutation. */
    public getBookmarks(): Map<string, BookmarkItem[]> {
        const copy = new Map<string, BookmarkItem[]>();
        for (const [key, value] of this.bookmarkMap) {
            copy.set(key, [...value]);
        }
        return copy;
    }

    /** Returns file URI keys sorted by insertion order (most recent first). */
    public getFileKeys(): string[] {
        // Filter out any keys that might have been deleted from _bookmarks but lingering in _fileOrder (safety check)
        // And append any new keys that might be in _bookmarks but not in _fileOrder (migration/safety)
        const validKeys = this.fileOrder.filter(key => this.bookmarkMap.has(key));
        const validSet = new Set(validKeys);
        const missingKeys = Array.from(this.bookmarkMap.keys()).filter(key => !validSet.has(key));
        return [...validKeys, ...missingKeys.sort()]; // Fallback to alpha sort for missing
    }

    private updateDecorations(editor: vscode.TextEditor) {
        try {
            const key = editor.document.uri.toString();
            const activeBookmarks = this.bookmarkMap.get(key);

            if (activeBookmarks && activeBookmarks.length > 0) {
                const ranges = activeBookmarks.map(b => new vscode.Range(b.line, 0, b.line, 0));
                editor.setDecorations(this.decorationType, ranges);
            } else {
                editor.setDecorations(this.decorationType, []);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[LogBookmarkService] Error updating decorations: ${msg}`);
        }
    }

    /** Disposes all timers, decorations, event emitters, and file watchers. */
    public dispose() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = undefined;
        }
        if (this.watcherDebounceTimer) {
            clearTimeout(this.watcherDebounceTimer);
            this.watcherDebounceTimer = undefined;
        }
        this.decorationType.dispose();
        this._onDidChangeBookmarks.dispose();
        this._onDidAddBookmark.dispose();

        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
    }

    private debouncedSave() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = undefined;
            this.saveToState().catch(e => this.logger.error(`[LogBookmarkService] Failed to save bookmarks: ${e}`));
        }, 150);
    }

    private async saveToState() {
        const bookmarksData: { [key: string]: unknown[] } = {};
        for (const [key, bookmarks] of this.bookmarkMap) {
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
        for (const [k, v] of this.includeLineNumbers.entries()) { lnObj[k] = v; }

        await this.context.globalState.update(Constants.GlobalState.BookmarkIncludeLnMap, lnObj);
        await this.context.globalState.update(Constants.GlobalState.BookmarkWordWrap, this.wordWrapEnabled);

        // Save file order
        await this.context.globalState.update(Constants.GlobalState.BookmarkFileOrder, this.fileOrder);

        this.logger.info(`[LogBookmarkService] Saved bookmarks to state. Files with bookmarks: ${this.bookmarkMap.size}`);
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
                    } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e);
                        this.logger.error(`[LogBookmarkService] Error parsing bookmark from state: ${msg}`);
                        return null;
                    }
                }).filter(b => b !== null) as BookmarkItem[];

                if (bookmarks.length > 0) {
                    this.bookmarkMap.set(key, bookmarks);
                }
            }
        }

        const lnMapData = this.context.globalState.get<Record<string, boolean>>(Constants.GlobalState.BookmarkIncludeLnMap);

        // Load file order
        const fileOrderData = this.context.globalState.get<string[]>(Constants.GlobalState.BookmarkFileOrder);
        if (fileOrderData) {
            this.fileOrder = fileOrderData;
        } else {
            // Migration: initialize with whatever we have, sorted alphabetically or just keys
            this.fileOrder = Array.from(this.bookmarkMap.keys()).sort();
        }

        if (lnMapData) {
            for (const key in lnMapData) {
                this.includeLineNumbers.set(key, lnMapData[key]);
            }
        }

        const wordWrapData = this.context.globalState.get<boolean>(Constants.GlobalState.BookmarkWordWrap);
        if (wordWrapData !== undefined) {
            this.wordWrapEnabled = wordWrapData;
        }

        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
        this._onDidChangeBookmarks.fire();

        this.checkFilesExistence().catch(e =>
            this.logger.error(`[LogBookmarkService] File existence check failed: ${e instanceof Error ? e.message : String(e)}`)
        );
        this.updateWatcher();

        this.logger.info(`[LogBookmarkService] Loaded bookmarks from state. Files with bookmarks: ${this.bookmarkMap.size}`);
    }
}
