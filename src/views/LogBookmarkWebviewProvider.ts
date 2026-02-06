import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { BookmarkWebviewMessage, SerializedBookmarkItem } from '../models/WebviewModels';
import { Constants } from '../constants';
import { Logger } from '../services/Logger';
import { LogBookmarkHtmlGenerator } from './LogBookmarkHtmlGenerator';

export class LogBookmarkWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastAddedUri?: string;
    private _foldedUris: Set<string> = new Set();
    private _activeUriStr?: string;
    private _htmlGenerator: LogBookmarkHtmlGenerator;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _bookmarkService: LogBookmarkService,
        private readonly _logger: Logger
    ) {
        this._htmlGenerator = new LogBookmarkHtmlGenerator(this._extensionUri, this._bookmarkService, this._logger);

        this._bookmarkService.onDidChangeBookmarks(() => {
            this.updateContent();
        });

        this._bookmarkService.onDidAddBookmark((uri) => {
            const addedKey = uri.toString();
            this._lastAddedUri = addedKey;

            // Preserve state, no forced collapse on add
            this._foldedUris.delete(addedKey);

            this.updateContent();
            // Clear flash after 1 second
            setTimeout(() => {
                this._lastAddedUri = undefined;
                this.updateContent();
            }, 1000);
        });

        // Listen for active editor changes to auto-expand/collapse
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.handleActiveEditorChange(editor);
        });
    }

    private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
        if (editor) {
            const newActiveUri = editor.document.uri.toString();
            if (this._activeUriStr !== newActiveUri) {
                this._activeUriStr = newActiveUri;

                // Only act if the new active file is actually in our bookmarks
                const bookmarks = this._bookmarkService.getBookmarks();
                if (bookmarks.has(newActiveUri)) {
                    // Auto-expand active
                    this._foldedUris.delete(newActiveUri);
                }

                // Use postMessage to update UI without reloading
                if (this._view && this._view.visible) {
                    this._view.webview.postMessage({
                        type: 'setActive',
                        uriString: newActiveUri
                    });
                } else {
                    this.updateContent();
                }
            }
        } else {
            this._activeUriStr = undefined;
            if (this._view && this._view.visible) {
                this._view.webview.postMessage({ type: 'setActive', uriString: '' });
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        try {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this._extensionUri
                ]
            };

            webviewView.webview.onDidReceiveMessage((data: BookmarkWebviewMessage) => {
                switch (data.type) {
                    case 'jump':
                        if (data.item) {
                            this.jumpToBookmark(data.item);
                        }
                        break;
                    case 'remove':
                        if (data.item) {
                            this.removeBookmark(data.item);
                        }
                        break;
                    case 'copyAll':
                        if (data.uriString) {
                            const withLn = this._bookmarkService.isIncludeLineNumbersEnabled(data.uriString);
                            vscode.commands.executeCommand(Constants.Commands.CopyBookmarkFile, vscode.Uri.parse(data.uriString), withLn);
                        } else {
                            vscode.commands.executeCommand(Constants.Commands.CopyAllBookmarks);
                        }
                        break;
                    case 'openAll':
                        if (data.uriString) {
                            const withLn = this._bookmarkService.isIncludeLineNumbersEnabled(data.uriString);
                            vscode.commands.executeCommand(Constants.Commands.OpenBookmarkFile, vscode.Uri.parse(data.uriString), withLn);
                        } else {
                            vscode.commands.executeCommand(Constants.Commands.OpenAllBookmarks);
                        }
                        break;
                    case 'collapseAll':
                        this.collapseAll();
                        break;
                    case 'clearAll':
                        vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);
                        break;

                    case 'removeGroup':
                        if (data.groupId) {
                            vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkGroup, data.groupId);
                        }
                        break;
                    case 'focusFile':
                        if (data.uriString) {
                            this.focusFile(data.uriString);
                        }
                        break;
                    case 'removeFile':
                        if (data.uriString) {
                            this.removeBookmarkFile(data.uriString);
                        }
                        break;
                    case 'toggleWordWrap':
                        this._bookmarkService.toggleWordWrap();
                        break;
                    case 'mouseEnter':
                        vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, true);
                        break;
                    case 'mouseLeave':
                        vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, false);
                        break;
                    case 'toggleFold':
                        if (data.uriString) {
                            if (this._foldedUris.has(data.uriString)) {
                                this._foldedUris.delete(data.uriString);
                            } else {
                                this._foldedUris.add(data.uriString);
                            }
                            this.updateContent();
                        }
                        break;
                    case 'toggleLineNumbers':
                        if (data.uriString) {
                            this._bookmarkService.toggleIncludeLineNumbers(data.uriString);
                        }
                        break;
                }
            });

            this.updateContent();
        } catch (e) {
            this._logger.error(`Error resolving webview view: ${e}`);
            webviewView.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                Critical Error resolving view: ${e}
            </div></body></html>`;
        }
    }

    private collapseAll() {
        const bookmarksMap = this._bookmarkService.getBookmarks();
        for (const key of bookmarksMap.keys()) {
            this._foldedUris.add(key);
        }
        this.updateContent();
    }

    // expandAll removed per user request

    private jumpToBookmark(item: SerializedBookmarkItem) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString),
            groupId: item.groupId || ''
        };
        vscode.commands.executeCommand(Constants.Commands.JumpToBookmark, hydratedItem);
    }

    private removeBookmark(item: SerializedBookmarkItem) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString),
            groupId: item.groupId || ''
        };
        vscode.commands.executeCommand(Constants.Commands.RemoveBookmark, hydratedItem);
    }

    private async focusFile(uriStr: string) {
        if (!uriStr) {
            return;
        }
        try {
            const uri = vscode.Uri.parse(uriStr);
            const doc = await vscode.workspace.openTextDocument(uri);

            // Check if the document is already visible in any editor
            const visibleEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());

            if (visibleEditor) {
                // If found, reveal it
                await vscode.window.showTextDocument(doc, {
                    viewColumn: visibleEditor.viewColumn,
                    preview: true
                });
            } else {
                // If not found, open in active editor
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        } catch (e) {
            this._logger.error(`Error focusing file: ${e}`);
        }
    }

    private removeBookmarkFile(uriStr: string) {
        if (uriStr) {
            vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkFile, vscode.Uri.parse(uriStr));
        }
    }

    private async updateContent() {
        if (!this._view) {
            return;
        }

        try {
            const html = await this._htmlGenerator.generateHtml(
                this._view.webview,
                this._activeUriStr,
                this._lastAddedUri,
                this._foldedUris
            );
            this._view.webview.html = html;
        } catch (e) {
            this._view.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                Error loading bookmarks: ${e}<br/>
            </div></body></html>`;
        }
    }
}
