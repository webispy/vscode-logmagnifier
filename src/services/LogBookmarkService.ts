import * as vscode from 'vscode';
import { BookmarkItem } from '../models/Bookmark';
import { Constants } from '../constants';

import { Logger } from './Logger';

export class LogBookmarkService implements vscode.Disposable {
    private _bookmarks: Map<string, BookmarkItem[]> = new Map();
    private _onDidChangeBookmarks: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeBookmarks: vscode.Event<void> = this._onDidChangeBookmarks.event;

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

    public addBookmark(editor: vscode.TextEditor, line: number) {
        const uri = editor.document.uri;
        const key = uri.toString();

        if (!this._bookmarks.has(key)) {
            this._bookmarks.set(key, []);
        }

        const list = this._bookmarks.get(key)!;
        // Check if already exists
        if (list.some(b => b.line === line)) {
            return;
        }

        const lineContent = editor.document.lineAt(line).text;
        const bookmark: BookmarkItem = {
            id: Date.now().toString() + Math.random().toString().slice(2),
            uri: uri,
            line: line,
            content: lineContent.trim()
        };

        list.push(bookmark);
        // Sort by line number
        list.sort((a, b) => a.line - b.line);

        this._onDidChangeBookmarks.fire();

        // Update decorations for all visible editors displaying this document
        vscode.window.visibleTextEditors.forEach(e => {
            if (e.document.uri.toString() === uri.toString()) {
                this.updateDecorations(e);
            }
        });

        this.saveToState();
    }

    public removeBookmark(item: BookmarkItem) {
        const key = item.uri.toString();
        if (this._bookmarks.has(key)) {
            const list = this._bookmarks.get(key)!;
            const index = list.findIndex(b => b.id === item.id);
            if (index !== -1) {
                list.splice(index, 1);
                if (list.length === 0) {
                    this._bookmarks.delete(key);
                }
                this._onDidChangeBookmarks.fire();

                // Update decorations for all visible editors displaying this document
                vscode.window.visibleTextEditors.forEach(e => {
                    if (e.document.uri.toString() === item.uri.toString()) {
                        this.updateDecorations(e);
                    }
                });

                this.saveToState();
            }
        }
    }

    public getBookmarks(): Map<string, BookmarkItem[]> {
        return this._bookmarks;
    }

    public removeBookmarksForUri(uri: vscode.Uri) {
        const key = uri.toString();
        if (this._bookmarks.has(key)) {
            this._bookmarks.delete(key);
            this._onDidChangeBookmarks.fire();
            this.saveToState();
        }
    }



    private updateDecorations(editor: vscode.TextEditor) {
        const key = editor.document.uri.toString();
        if (this._bookmarks.has(key)) {
            const bookmarks = this._bookmarks.get(key)!;
            const ranges = bookmarks.map(b => new vscode.Range(b.line, 0, b.line, 0));
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
                uri: b.uri.toString(), // Store URI as string
                line: b.line,
                content: b.content
            }));
        }
        await this.context.globalState.update(Constants.GlobalState.Bookmarks, bookmarksData);
        this.logger.info(`Saved bookmarks to state: ${Object.keys(bookmarksData).length} files.`);
    }

    private loadFromState() {
        const bookmarksData = this.context.globalState.get<{ [key: string]: any[] }>(Constants.GlobalState.Bookmarks);
        this.logger.info(`Loading bookmarks from state... Found: ${bookmarksData ? Object.keys(bookmarksData).length + ' files' : 'None'}`);
        if (bookmarksData) {
            for (const key in bookmarksData) {
                const bookmarks = bookmarksData[key].map(b => {
                    try {
                        return {
                            id: b.id,
                            uri: vscode.Uri.parse(b.uri), // Restore URI
                            line: b.line,
                            content: b.content
                        } as BookmarkItem;
                    } catch (e) {
                        console.error('Failed to restore bookmark uri', b.uri, e);
                        return null;
                    }
                }).filter(b => b !== null) as BookmarkItem[];

                if (bookmarks.length > 0) {
                    this._bookmarks.set(key, bookmarks);
                }
            }
            // Notify that bookmarks are loaded, though UI might not be ready.
            // But existing open editors will get decorations via onDidChangeVisibleTextEditors callback if they become active/visible?
            // Actually, we should probably manually trigger an update if there are active editors right now.
            vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor));
            this._onDidChangeBookmarks.fire();
        }
    }
}
