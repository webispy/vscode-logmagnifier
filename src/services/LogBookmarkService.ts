import * as vscode from 'vscode';
import { BookmarkItem, BookmarkResult } from '../models/Bookmark';
import { Constants } from '../constants';
import { SourceMapService } from './SourceMapService';

import { Logger } from './Logger';

export class LogBookmarkService implements vscode.Disposable {
    private _bookmarks: Map<string, BookmarkItem[]> = new Map();
    // History stack of active bookmark IDs in each file (URI -> steps)
    private _history: Map<string, string[][]> = new Map();
    private _historyIndices: Map<string, number> = new Map();
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
    }

    public getBookmarkAt(uri: vscode.Uri, line: number): BookmarkItem | undefined {
        const key = uri.toString();
        const bookmarks = this._bookmarks.get(key);
        if (!bookmarks) {
            return undefined;
        }

        const activeIds = this.getActiveIds(key);
        return bookmarks.find(b => b.line === line && activeIds.has(b.id));
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

    public addBookmark(editor: vscode.TextEditor, line: number, options?: { matchText?: string }): BookmarkResult {
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
                vscode.window.showWarningMessage('Note: This is a filtered log view. Bookmarks added here may be lost if you re-apply filters or close this temporary file.');
            }

            if (!this._bookmarks.has(key)) {
                this._bookmarks.set(key, []);
            }

            const list = this._bookmarks.get(key)!;
            const currentActiveIds = this.getActiveIds(key);
            if (list.some(b => b.line === line && currentActiveIds.has(b.id))) {
                return { success: false, message: 'Bookmark already exists on this line.' };
            }

            const lineContent = doc.lineAt(line).text;
            const groupId = Date.now().toString();
            const bookmark: BookmarkItem = {
                id: Date.now().toString() + Math.random().toString().slice(2),
                uri: uri,
                line: line,
                content: lineContent.trim(),
                groupId: groupId,
                matchText: matchText
            };

            list.push(bookmark);
            list.sort((a, b) => a.line - b.line);

            currentActiveIds.add(bookmark.id);
            this.pushToHistory(key, Array.from(currentActiveIds));

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

    public addBookmarks(editor: vscode.TextEditor, lines: number[], options?: { matchText?: string }) {
        const matchText = options?.matchText;
        const uri = editor.document.uri;
        const key = uri.toString();

        if (!this._bookmarks.has(key)) {
            this._bookmarks.set(key, []);
        }

        const list = this._bookmarks.get(key)!;
        let addedCount = 0;
        const currentActiveIds = this.getActiveIds(key);
        const groupId = Date.now().toString();

        for (const line of lines) {
            // Check if already exists
            if (list.some(b => b.line === line && currentActiveIds.has(b.id))) {
                continue;
            }

            const lineContent = editor.document.lineAt(line).text;
            const bookmark: BookmarkItem = {
                id: Date.now().toString() + Math.random().toString().slice(2),
                uri: uri,
                line: line,
                content: lineContent.trim(),
                groupId: groupId,
                matchText: matchText
            };

            list.push(bookmark);
            currentActiveIds.add(bookmark.id);
            addedCount++;
        }

        if (addedCount > 0) {
            list.sort((a, b) => a.line - b.line);
            this.pushToHistory(key, Array.from(currentActiveIds));
            this._onDidChangeBookmarks.fire();
            this._onDidAddBookmark.fire(uri);
            this.refreshAllDecorations();
            this.saveToState();
        }

        return addedCount;
    }

    public removeBookmark(item: BookmarkItem) {
        const key = item.uri.toString();
        const currentActiveIds = this.getActiveIds(key);
        if (currentActiveIds.has(item.id)) {
            currentActiveIds.delete(item.id);
            this.pushToHistory(key, Array.from(currentActiveIds));
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public removeBookmarksForUri(uri: vscode.Uri) {
        const key = uri.toString();
        const items = this._bookmarks.get(key);
        if (items) {
            const currentActiveIds = this.getActiveIds(key); // Get active IDs for this specific URI
            let changed = false;
            items.forEach(item => {
                if (currentActiveIds.has(item.id)) {
                    currentActiveIds.delete(item.id);
                    changed = true;
                }
            });

            if (changed) {
                this.pushToHistory(key, Array.from(currentActiveIds)); // Push updated history for this URI
                this._onDidChangeBookmarks.fire();
                this.refreshAllDecorations();
                this.saveToState();
            }
        }
        // Also clear history for this URI if all bookmarks are removed
        this._history.delete(key);
        this._historyIndices.delete(key);
    }

    public removeAllBookmarks() {
        this._bookmarks.clear();
        this._history.clear();
        this._historyIndices.clear();
        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    public removeBookmarkGroup(groupId: string) {
        const removedIds = new Set<string>();

        // 1. Remove from master bookmark list
        for (const [uri, items] of this._bookmarks.entries()) {
            const filtered = items.filter(item => {
                if (item.groupId === groupId) {
                    removedIds.add(item.id);
                    return false;
                }
                return true;
            });

            if (filtered.length !== items.length) {
                if (filtered.length === 0) {
                    this._bookmarks.delete(uri);
                } else {
                    this._bookmarks.set(uri, filtered);
                }
            }
        }

        if (removedIds.size === 0) {
            return;
        }

        // 2. Purge from all history steps across all files
        for (const [uriKey, fileHistory] of this._history.entries()) {
            const historyIndex = this._historyIndices.get(uriKey) ?? -1;
            const newHistory: string[][] = [];

            for (let i = 0; i < fileHistory.length; i++) {
                const step = fileHistory[i];
                const filteredStep = step.filter(id => !removedIds.has(id));

                // Deduplicate: don't add if it's identical to the previous step after filtering
                if (newHistory.length === 0 || JSON.stringify(newHistory[newHistory.length - 1]) !== JSON.stringify(filteredStep)) {
                    newHistory.push(filteredStep);
                }
            }

            this._history.set(uriKey, newHistory);
            this._historyIndices.set(uriKey, newHistory.length > 0 ? Math.min(historyIndex, newHistory.length - 1) : -1);
        }

        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    private getActiveIds(uriKey: string): Set<string> {
        const historySteps = this._history.get(uriKey);
        const historyIndex = this._historyIndices.get(uriKey) ?? -1;
        if (historySteps && historyIndex >= 0 && historyIndex < historySteps.length) {
            return new Set(historySteps[historyIndex]);
        }
        return new Set();
    }

    private pushToHistory(uriKey: string, ids: string[]) {
        let historySteps = this._history.get(uriKey) || [];
        let historyIndex = this._historyIndices.get(uriKey) ?? -1;

        // Clear future history if we were in a back state
        if (historyIndex < historySteps.length - 1) {
            historySteps = historySteps.slice(0, historyIndex + 1);
        }
        historySteps.push(ids);
        historyIndex++;

        this._history.set(uriKey, historySteps);
        this._historyIndices.set(uriKey, historyIndex);
    }

    public canGoBack(uriKey: string): boolean {
        const historyIndex = this._historyIndices.get(uriKey) ?? -1;
        return historyIndex > 0;
    }

    public canGoForward(uriKey: string): boolean {
        const historySteps = this._history.get(uriKey);
        const historyIndex = this._historyIndices.get(uriKey) ?? -1;
        return historySteps ? historyIndex < historySteps.length - 1 : false;
    }

    public back(uriKey: string) {
        if (this.canGoBack(uriKey)) {
            const index = this._historyIndices.get(uriKey)!;
            this._historyIndices.set(uriKey, index - 1);
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public forward(uriKey: string) {
        if (this.canGoForward(uriKey)) {
            const index = this._historyIndices.get(uriKey)!;
            this._historyIndices.set(uriKey, index + 1);
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
        const activeIds = this.getActiveIds(uriKey);
        return activeIds.size;
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
        const activeIds = this.getActiveIds(uriKey);
        const bookmarks = this._bookmarks.get(uriKey) || [];
        const uniqueGroupIds = new Set<string>();
        for (const item of bookmarks) {
            if (item.groupId && activeIds.has(item.id)) {
                uniqueGroupIds.add(item.groupId);
            }
        }
        return uniqueGroupIds.size;
    }

    private refreshAllDecorations() {
        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
    }

    public getBookmarks(): Map<string, BookmarkItem[]> {
        const filteredMap = new Map<string, BookmarkItem[]>();
        for (const [uri, items] of this._bookmarks) {
            const activeIds = this.getActiveIds(uri);
            const activeItems = items.filter(item => activeIds.has(item.id));
            if (activeItems.length > 0) {
                filteredMap.set(uri, activeItems);
            }
        }
        return filteredMap;
    }

    private updateDecorations(editor: vscode.TextEditor) {
        const key = editor.document.uri.toString();
        const activeBookmarks = this.getBookmarks().get(key);
        if (activeBookmarks) {
            const ranges = activeBookmarks.map(b => new vscode.Range(b.line, 0, b.line, 0));
            editor.setDecorations(this.decorationType, ranges);
        } else {
            editor.setDecorations(this.decorationType, []);
        }
    }

    public dispose() {
        this.decorationType.dispose();
        this._onDidChangeBookmarks.dispose();
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

        // Convert Map to Object for storage
        const historyObj: Record<string, string[][]> = {};
        for (const [k, v] of this._history.entries()) { historyObj[k] = v; }
        const indicesObj: Record<string, number> = {};
        for (const [k, v] of this._historyIndices.entries()) { indicesObj[k] = v; }

        // Convert _includeLineNumbers Map to Object for storage
        const lnObj: Record<string, boolean> = {};
        for (const [k, v] of this._includeLineNumbers.entries()) { lnObj[k] = v; }

        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_history_map', historyObj);
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_indices_map', indicesObj);
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_include_ln_map', lnObj);
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_wordWrap', this._isWordWrapEnabled);
        this.logger.info(`Saved bookmarks to state. Files with history: ${this._history.size}`);
    }

    private loadFromState() {
        const bookmarksData = this.context.globalState.get<{ [key: string]: any[] }>(Constants.GlobalState.Bookmarks);
        // Old history format (global)
        const oldHistoryData = this.context.globalState.get<{ history: string[][], index: number }>(Constants.GlobalState.Bookmarks + '_history');

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

        const historyMapData = this.context.globalState.get<Record<string, string[][]>>(Constants.GlobalState.Bookmarks + '_history_map');
        const indicesMapData = this.context.globalState.get<Record<string, number>>(Constants.GlobalState.Bookmarks + '_indices_map');
        const lnMapData = this.context.globalState.get<Record<string, boolean>>(Constants.GlobalState.Bookmarks + '_include_ln_map');

        if (lnMapData) {
            for (const key in lnMapData) {
                this._includeLineNumbers.set(key, lnMapData[key]);
            }
        }

        if (historyMapData && indicesMapData) {
            for (const key in historyMapData) {
                // Sanitize history: only keep IDs that actually exist in _bookmarks for this file
                const allValidIds = new Set<string>();
                this._bookmarks.get(key)?.forEach(item => allValidIds.add(item.id));

                const sanitizedHistory = historyMapData[key].map(step =>
                    step.filter(id => allValidIds.has(id))
                );
                this._history.set(key, sanitizedHistory);
                this._historyIndices.set(key, indicesMapData[key] ?? -1);
            }
        } else if (oldHistoryData && Array.isArray(oldHistoryData.history)) {
            // Handle migration from old global history to per-file history
            // This is a best-effort migration. The global history will be applied to all files.
            this.logger.info("Migrating old global bookmark history to per-file history.");
            const allValidIds = new Set<string>();
            for (const items of this._bookmarks.values()) {
                items.forEach(item => allValidIds.add(item.id));
            }

            const sanitizedGlobalHistory = oldHistoryData.history.map(step =>
                step.filter(id => allValidIds.has(id))
            );
            const globalHistoryIndex = typeof oldHistoryData.index === 'number' ? oldHistoryData.index : sanitizedGlobalHistory.length - 1;

            for (const uriKey of this._bookmarks.keys()) {
                // For each file, filter the global history to only include IDs relevant to that file
                const fileSpecificIds = new Set(this._bookmarks.get(uriKey)?.map(b => b.id) || []);
                const fileHistory = sanitizedGlobalHistory.map(step => step.filter(id => fileSpecificIds.has(id)));

                // Remove duplicate steps that might arise from filtering
                const uniqueFileHistory: string[][] = [];
                for (const step of fileHistory) {
                    if (uniqueFileHistory.length === 0 || JSON.stringify(uniqueFileHistory[uniqueFileHistory.length - 1]) !== JSON.stringify(step)) {
                        uniqueFileHistory.push(step);
                    }
                }

                this._history.set(uriKey, uniqueFileHistory);
                // Try to map the global index to the file-specific history
                let fileIndex = -1;
                if (uniqueFileHistory.length > 0) {
                    // Find the closest step in uniqueFileHistory to the globalHistoryIndex
                    // This is a heuristic, as direct mapping might not be possible
                    fileIndex = Math.min(globalHistoryIndex, uniqueFileHistory.length - 1);
                    if (fileIndex < 0) { fileIndex = 0; }
                }
                this._historyIndices.set(uriKey, fileIndex);
            }
            // Clear old global state after migration
            this.context.globalState.update(Constants.GlobalState.Bookmarks + '_history', undefined);
        } else {
            // Reconstruct initial history per file if missing (no old global history either)
            for (const [uriKey, bookmarks] of this._bookmarks.entries()) {
                const allIds = bookmarks.map(i => i.id);
                this._history.set(uriKey, [allIds]);
                this._historyIndices.set(uriKey, 0);
            }
        }

        const wordWrapData = this.context.globalState.get<boolean>(Constants.GlobalState.Bookmarks + '_wordWrap');
        if (wordWrapData !== undefined) {
            this._isWordWrapEnabled = wordWrapData;
        }

        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
        this._onDidChangeBookmarks.fire();
    }
}
