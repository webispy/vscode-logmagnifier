import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { BookmarkItem } from '../models/Bookmark';
import { BookmarkWebviewMessage, SerializedBookmarkItem } from '../models/WebviewModels';

import { LogBookmarkService } from '../services/LogBookmarkService';
import { Logger } from '../services/Logger';
import { escapeHtml } from '../utils/WebviewUtils';
import { LogBookmarkHtmlGenerator } from './LogBookmarkHtmlGenerator';

export class LogBookmarkWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView;
    private lastAddedUri?: string;
    private foldedUris: Set<string> = new Set();
    private activeUriStr?: string;
    private htmlGenerator: LogBookmarkHtmlGenerator;
    private disposables: vscode.Disposable[] = [];
    private updateTimeout?: NodeJS.Timeout;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly bookmarkService: LogBookmarkService,
        private readonly logger: Logger
    ) {
        this.htmlGenerator = new LogBookmarkHtmlGenerator(this.extensionUri, this.bookmarkService, this.logger);

        this.disposables.push(this.bookmarkService.onDidChangeBookmarks(() => {
            this.updateContent().catch((e: unknown) =>
                this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
            );
        }));

        this.disposables.push(this.bookmarkService.onDidAddBookmark((uri) => {
            const addedKey = uri.toString();
            this.lastAddedUri = addedKey;

            // Preserve state, no forced collapse on add
            this.foldedUris.delete(addedKey);

            this.updateContent().catch((e: unknown) =>
                this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
            );
            // Clear flash after 1 second
            setTimeout(() => {
                this.lastAddedUri = undefined;
                this.updateContent().catch((e: unknown) =>
                    this.logger.error(`[BookmarkWebview] Failed to update after flash: ${e instanceof Error ? e.message : String(e)}`)
                );
            }, 1000);
        }));

        // Listen for active editor changes to auto-expand/collapse
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            this.handleActiveEditorChange(editor);
        }));
    }

    private handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
        if (editor) {
            const newActiveUri = editor.document.uri.toString();
            if (this.activeUriStr !== newActiveUri) {
                this.activeUriStr = newActiveUri;

                // Only act if the new active file is actually in our bookmarks
                const bookmarks = this.bookmarkService.getBookmarks();
                if (bookmarks.has(newActiveUri)) {
                    // Auto-expand active
                    this.foldedUris.delete(newActiveUri);
                }

                // Use postMessage to update UI without reloading
                if (this.view && this.view.visible) {
                    this.view.webview.postMessage({
                        type: 'setActive',
                        uriString: newActiveUri
                    });
                } else {
                    this.updateContent().catch((e: unknown) =>
                        this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
                    );
                }
            }
        } else {
            this.activeUriStr = undefined;
            if (this.view && this.view.visible) {
                this.view.webview.postMessage({ type: 'setActive', uriString: '' });
            }
        }
    }

    /** Initializes the webview with bookmark HTML and registers message handlers. */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.view = webviewView;

        try {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this.extensionUri
                ]
            };

            this.disposables.push(webviewView.webview.onDidReceiveMessage((data: BookmarkWebviewMessage) => {
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
                            const withLn = this.bookmarkService.isIncludeLineNumbersEnabled(data.uriString);
                            vscode.commands.executeCommand(Constants.Commands.CopyBookmarkFile, vscode.Uri.parse(data.uriString), withLn);
                        } else {
                            vscode.commands.executeCommand(Constants.Commands.CopyAllBookmarks);
                        }
                        break;
                    case 'openAll':
                        if (data.uriString) {
                            const withLn = this.bookmarkService.isIncludeLineNumbersEnabled(data.uriString);
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
                        this.bookmarkService.toggleWordWrap();
                        break;
                    case 'mouseEnter':
                        vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, true);
                        break;
                    case 'mouseLeave':
                        vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, false);
                        break;
                    case 'toggleFold':
                        if (data.uriString) {
                            if (this.foldedUris.has(data.uriString)) {
                                this.foldedUris.delete(data.uriString);
                            } else {
                                this.foldedUris.add(data.uriString);
                            }
                            this.updateContent().catch((e: unknown) =>
                                this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
                            );
                        }
                        break;
                    case 'toggleLineNumbers':
                        if (data.uriString) {
                            this.bookmarkService.toggleIncludeLineNumbers(data.uriString);
                        }
                        break;
                }
            }));

            this.updateContent().catch((e: unknown) =>
                this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
            );
        } catch (e: unknown) {
            this.logger.error(`[LogBookmarkWebviewProvider] Error resolving webview view: ${e instanceof Error ? e.message : String(e)}`);
            webviewView.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                Critical Error resolving view: ${escapeHtml(e instanceof Error ? e.message : String(e))}
            </div></body></html>`;
        }
    }

    private collapseAll() {
        const bookmarksMap = this.bookmarkService.getBookmarks();
        for (const key of bookmarksMap.keys()) {
            this.foldedUris.add(key);
        }
        this.updateContent().catch((e: unknown) =>
            this.logger.error(`[BookmarkWebview] Update failed: ${e instanceof Error ? e.message : String(e)}`)
        );
    }

    // expandAll removed per user request

    private jumpToBookmark(item: SerializedBookmarkItem) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString),
            groupId: item.groupId || ''
        };

        if (this.bookmarkService.isFileMissing(hydratedItem.uri.toString())) {
            vscode.window.showErrorMessage(`File not found: ${hydratedItem.uri.fsPath}`);
            return;
        }

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

        if (this.bookmarkService.isFileMissing(uriStr)) {
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
        } catch (e: unknown) {
            this.logger.error(`[LogBookmarkWebviewProvider] Error focusing file: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private removeBookmarkFile(uriStr: string) {
        if (uriStr) {
            vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkFile, vscode.Uri.parse(uriStr));
        }
    }

    private async updateContent() {
        if (!this.view) {
            return;
        }

        // Debounce updates to prevent UI flickering on mass changes
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = setTimeout(async () => {
            if (!this.view) { return; }
            try {
                const html = await this.htmlGenerator.generateHtml(
                    this.view.webview,
                    this.activeUriStr,
                    this.lastAddedUri,
                    this.foldedUris
                );
                this.view.webview.html = html;
            } catch (e: unknown) {
                this.view.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                    Error loading bookmarks: ${escapeHtml(e instanceof Error ? e.message : String(e))}<br/>
                </div></body></html>`;
            }
        }, 100);
    }

    /** Cancels pending updates and disposes all subscriptions. */
    public dispose() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
