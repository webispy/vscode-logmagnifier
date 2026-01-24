import * as vscode from 'vscode';
import { BookmarkItem } from '../models/Bookmark';
import { Constants } from '../constants';

import { Logger } from './Logger';

export class LogBookmarkService implements vscode.Disposable {
    private _bookmarks: Map<string, BookmarkItem[]> = new Map();
    // History stack of active bookmark IDs in each step
    private _history: string[][] = [];
    private _historyIndex: number = -1;
    private _onDidChangeBookmarks: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeBookmarks: vscode.Event<void> = this._onDidChangeBookmarks.event;

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

        // Listen for document close to remove bookmarks
        vscode.workspace.onDidCloseTextDocument(doc => {
            this.removeBookmarksForUri(doc.uri);
        }, null, context.subscriptions);
    }

    public getBookmarkAt(uri: vscode.Uri, line: number): BookmarkItem | undefined {
        const key = uri.toString();
        const bookmarks = this._bookmarks.get(key);
        if (!bookmarks) {
            return undefined;
        }

        const activeIds = this.getActiveIds();
        return bookmarks.find(b => b.line === line && activeIds.has(b.id));
    }

    public toggleBookmark(editor: vscode.TextEditor, line: number) {
        const bookmark = this.getBookmarkAt(editor.document.uri, line);
        if (bookmark) {
            this.removeBookmark(bookmark);
        } else {
            this.addBookmark(editor, line);
        }
    }

    public addBookmark(editor: vscode.TextEditor, line: number, options?: { matchText?: string }) {
        const matchText = options?.matchText;
        const uri = editor.document.uri;
        const key = uri.toString();

        if (!this._bookmarks.has(key)) {
            this._bookmarks.set(key, []);
        }

        const list = this._bookmarks.get(key)!;
        // Check if already exists in current state (though we should check all for ID reuse)
        const currentActiveIds = this.getActiveIds();
        if (list.some(b => b.line === line && currentActiveIds.has(b.id))) {
            return;
        }

        const lineContent = editor.document.lineAt(line).text;
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
        // Sort by line number
        list.sort((a, b) => a.line - b.line);

        // Record new set of active IDs
        currentActiveIds.add(bookmark.id);
        this.pushToHistory(Array.from(currentActiveIds));

        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
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
        const currentActiveIds = this.getActiveIds();
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
            this.pushToHistory(Array.from(currentActiveIds));
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }

        return addedCount;
    }

    public removeBookmark(item: BookmarkItem) {
        const currentActiveIds = this.getActiveIds();
        if (currentActiveIds.has(item.id)) {
            currentActiveIds.delete(item.id);
            this.pushToHistory(Array.from(currentActiveIds));
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public removeBookmarksForUri(uri: vscode.Uri) {
        const key = uri.toString();
        const items = this._bookmarks.get(key);
        if (items) {
            const currentActiveIds = this.getActiveIds();
            let changed = false;
            items.forEach(item => {
                if (currentActiveIds.has(item.id)) {
                    currentActiveIds.delete(item.id);
                    changed = true;
                }
            });

            if (changed) {
                this.pushToHistory(Array.from(currentActiveIds));
                this._onDidChangeBookmarks.fire();
                this.refreshAllDecorations();
                this.saveToState();
            }
        }
    }

    public removeAllBookmarks() {
        this._bookmarks.clear();
        this._history = [];
        this._historyIndex = -1;
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

        // 2. Purge from all history steps
        const currentHistoryStep = this._historyIndex >= 0 ? this._history[this._historyIndex] : [];
        const currentStepIds = new Set(currentHistoryStep);
        let currentStepAffected = false;

        const newHistory: string[][] = [];
        for (let i = 0; i < this._history.length; i++) {
            const step = this._history[i];
            const filteredStep = step.filter(id => !removedIds.has(id));

            if (i === this._historyIndex && filteredStep.length !== step.length) {
                currentStepAffected = true;
            }

            // Deduplicate: don't add if it's identical to the previous step after filtering
            if (newHistory.length === 0 || JSON.stringify(newHistory[newHistory.length - 1]) !== JSON.stringify(filteredStep)) {
                newHistory.push(filteredStep);
            }
        }

        // 3. Update history and index
        // Find where the current index should point to in the new history
        // If the current step was modified or removed, we try to find a reasonable mapping
        // Simplest: if we purged, we just update the whole history and keep index bounded

        const oldIndex = this._historyIndex;
        this._history = newHistory;

        // Adjust index: if history shrank, make sure index is still valid
        if (this._history.length === 0) {
            this._historyIndex = -1;
        } else {
            this._historyIndex = Math.min(oldIndex, this._history.length - 1);
            if (this._historyIndex < 0 && this._history.length > 0) {
                this._historyIndex = 0;
            }
        }

        this._onDidChangeBookmarks.fire();
        this.refreshAllDecorations();
        this.saveToState();
    }

    private getActiveIds(): Set<string> {
        if (this._historyIndex >= 0 && this._historyIndex < this._history.length) {
            return new Set(this._history[this._historyIndex]);
        }
        return new Set();
    }

    private pushToHistory(ids: string[]) {
        // Clear future history if we were in a back state
        if (this._historyIndex < this._history.length - 1) {
            this._history = this._history.slice(0, this._historyIndex + 1);
        }
        this._history.push(ids);
        this._historyIndex++;
    }

    public canGoBack(): boolean {
        return this._historyIndex > 0;
    }

    public canGoForward(): boolean {
        return this._historyIndex < this._history.length - 1;
    }

    public back() {
        if (this.canGoBack()) {
            this._historyIndex--;
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public forward() {
        if (this.canGoForward()) {
            this._historyIndex++;
            this._onDidChangeBookmarks.fire();
            this.refreshAllDecorations();
            this.saveToState();
        }
    }

    public getActiveLinesCount(): number {
        const bookmarksMap = this.getBookmarks();
        let totalLines = 0;
        for (const items of bookmarksMap.values()) {
            totalLines += items.length;
        }
        return totalLines;
    }

    public isWordWrapEnabled(): boolean {
        return this._isWordWrapEnabled;
    }

    public toggleWordWrap() {
        this._isWordWrapEnabled = !this._isWordWrapEnabled;
        this._onDidChangeBookmarks.fire();
        this.saveToState();
    }

    public getHistoryGroupsCount(): number {
        const bookmarksMap = this.getBookmarks();
        const uniqueGroupIds = new Set<string>();
        for (const items of bookmarksMap.values()) {
            for (const item of items) {
                if (item.groupId) {
                    uniqueGroupIds.add(item.groupId);
                }
            }
        }
        return uniqueGroupIds.size;
    }

    private refreshAllDecorations() {
        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
    }

    public getBookmarks(): Map<string, BookmarkItem[]> {
        const activeIds = this.getActiveIds();
        const filteredMap = new Map<string, BookmarkItem[]>();
        for (const [uri, items] of this._bookmarks) {
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
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_history', {
            history: this._history,
            index: this._historyIndex
        });
        await this.context.globalState.update(Constants.GlobalState.Bookmarks + '_wordWrap', this._isWordWrapEnabled);
        this.logger.info(`Saved bookmarks to state. History speed: ${this._historyIndex}/${this._history.length}`);
    }

    private loadFromState() {
        const bookmarksData = this.context.globalState.get<{ [key: string]: any[] }>(Constants.GlobalState.Bookmarks);
        const historyData = this.context.globalState.get<{ history: string[][], index: number }>(Constants.GlobalState.Bookmarks + '_history');

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

        if (historyData && Array.isArray(historyData.history)) {
            // Sanitize history: only keep IDs that actually exist in _bookmarks
            const allValidIds = new Set<string>();
            for (const items of this._bookmarks.values()) {
                items.forEach(item => allValidIds.add(item.id));
            }

            this._history = historyData.history.map(step =>
                step.filter(id => allValidIds.has(id))
            );
            this._historyIndex = typeof historyData.index === 'number' ? historyData.index : this._history.length - 1;
        } else if (this._bookmarks.size > 0) {
            // Reconstruct initial history if missing
            const allIds = Array.from(this._bookmarks.values()).flatMap(items => items.map(i => i.id));
            this._history = [allIds];
            this._historyIndex = 0;
        }

        const wordWrapData = this.context.globalState.get<boolean>(Constants.GlobalState.Bookmarks + '_wordWrap');
        if (wordWrapData !== undefined) {
            this._isWordWrapEnabled = wordWrapData;
        }

        vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
        this._onDidChangeBookmarks.fire();
    }
}
