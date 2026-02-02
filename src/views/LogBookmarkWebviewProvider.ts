import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { BookmarkWebviewMessage, SerializedBookmarkItem } from '../models/WebviewModels';
import { Constants } from '../constants';
import { Logger } from '../services/Logger';

export class LogBookmarkWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastAddedUri?: string;
    private _foldedUris: Set<string> = new Set();
    private _activeUriStr?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _bookmarkService: LogBookmarkService,
        private readonly _logger: Logger
    ) {
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
        context: vscode.WebviewViewResolveContext,
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

    private copyBookmarkFile(uriStr: string, withLineNumber: boolean) {
        if (uriStr) {
            vscode.commands.executeCommand(Constants.Commands.CopyBookmarkFile, vscode.Uri.parse(uriStr), withLineNumber);
        }
    }

    private openBookmarkFile(uriStr: string, withLineNumber: boolean) {
        if (uriStr) {
            vscode.commands.executeCommand(Constants.Commands.OpenBookmarkFile, vscode.Uri.parse(uriStr), withLineNumber);
        }
    }

    private updateContent() {
        if (!this._view) {
            return;
        }

        try {
            const html = this.getHtmlForWebview(this._view.webview);
            this._view.webview.html = html;
        } catch (e) {
            this._view.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                Error loading bookmarks: ${e}<br/>
            </div></body></html>`;
        }
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const bookmarksMap = this._bookmarkService.getBookmarks();
        // Use getFileKeys for insertion order sorting (LIFO)
        let sortedUris = this._bookmarkService.getFileKeys();

        // LIFO order implies no re-sorting of active file to top


        // Check active editor if not set (initial load)
        if (!this._activeUriStr && vscode.window.activeTextEditor) {
            this._activeUriStr = vscode.window.activeTextEditor.document.uri.toString();
        }

        const wordWrapEnabled = this._bookmarkService.isWordWrapEnabled();
        const itemsMap: Record<string, SerializedBookmarkItem> = {};
        let filesHtml = '';
        let headerButtonsHtml = '';

        const toggleLnIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'list-ordered.svg'));
        const toggleWordWrapIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'word-wrap.svg'));
        const removeFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'trash.svg'));
        const copyFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'copy.svg'));
        const openFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'link-external.svg'));

        for (const uriStr of sortedUris) {
            const withLn = this._bookmarkService.isIncludeLineNumbersEnabled(uriStr);
            const items = bookmarksMap.get(uriStr)!;
            const filename = uriStr.split('/').pop() || 'Unknown File';
            const isFolded = this._foldedUris.has(uriStr);
            const isActive = uriStr === this._activeUriStr;

            // --- Header Button Generation ---
            // Truncate filename for button if too long, strictly
            let btnLabel = filename;
            if (btnLabel.length > 20) {
                btnLabel = btnLabel.substring(0, 17) + '...';
            }

            headerButtonsHtml += `
                <button class="file-nav-btn ${isActive ? 'active' : ''}" data-uri="${uriStr}" onclick="focusFileScroll('${uriStr}')" title="${filename}">
                    ${btnLabel}
                </button>
            `;
            // -------------------------------

            // Calculate per-file tags
            const groupMap = new Map<string, { keyword: string, count: number }>();
            for (const item of items) {
                if (item.groupId) {
                    const existing = groupMap.get(item.groupId);
                    if (existing) {
                        existing.count++;
                    } else {
                        groupMap.set(item.groupId, {
                            keyword: item.matchText || `L:${item.line + 1}`,
                            count: 1
                        });
                    }
                }
            }

            const tagsHtml = Array.from(groupMap.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([groupId, data]) => `
                <span class="tag" title="${data.keyword} (${data.count} lines)">
                    <span class="tag-label">${data.keyword}</span>
                    <span class="tag-remove" onclick="removeGroup('${groupId}', event)">×</span>
                </span>
            `).join('');


            const lineCount = this._bookmarkService.getFileActiveLinesCount(uriStr);


            // Group items by line
            const lineItemsMap = new Map<number, typeof items>();
            for (const item of items) {
                const line = item.line || 0;
                if (!lineItemsMap.has(line)) {
                    lineItemsMap.set(line, []);
                }
                lineItemsMap.get(line)!.push(item);
            }

            const sortedLines = Array.from(lineItemsMap.keys()).sort((a, b) => a - b);

            let fileLines = '';
            for (const line of sortedLines) {
                const lineItems = lineItemsMap.get(line)!;
                if (lineItems.length === 0) {
                    continue;
                }

                // Use the first item for basic line info
                const primaryItem = lineItems[0];
                const paddedLine = ((primaryItem.line || 0) + 1).toString();
                const content = primaryItem.content || '';

                // Collect all match texts for this line
                const uniqueMatchTexts = new Set<string>();
                lineItems.forEach(item => {
                    if (item.matchText) {
                        uniqueMatchTexts.add(item.matchText);
                    }
                });

                let safeContent = content; // Start with raw content

                // Combined highlighting
                if (uniqueMatchTexts.size > 0) {
                    // Create a combined regex: (match1|match2|...)
                    // Escape each match text
                    const escapedMatches = Array.from(uniqueMatchTexts).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                    // distinct matching logic handled by simple joining?
                    // Be careful about overlapping matches. Detailed tokenization is better but complex.
                    // Simple approach: Construct one regex.
                    // Sort by length destending to match longest first (e.g. "Error" vs "Error Code")
                    escapedMatches.sort((a, b) => b.length - a.length);

                    const combinedPattern = escapedMatches.join('|');

                    try {
                        const regex = new RegExp(combinedPattern, 'gi');

                        const parts: string[] = [];
                        let lastIndex = 0;
                        let match: RegExpExecArray | null;

                        while ((match = regex.exec(content)) !== null) {
                            const before = content.substring(lastIndex, match.index);
                            parts.push(before.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));

                            const matchedStr = match[0].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                            parts.push(`<u class="match-highlight">${matchedStr}</u>`);

                            lastIndex = regex.lastIndex;
                        }

                        const remaining = content.substring(lastIndex);
                        parts.push(remaining.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));

                        safeContent = parts.join('');

                    } catch (e) {
                        safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    }
                } else {
                    safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }

                const itemUriStr = primaryItem.uri ? primaryItem.uri.toString() : '';

                // Embed all IDs for remove action
                const allIds = lineItems.map(i => i.id);
                const allIdsStr = JSON.stringify(allIds).replace(/"/g, '&quot;');

                // Use primary ID for jump
                itemsMap[primaryItem.id] = {
                    id: primaryItem.id, // This is just for jump lookup
                    line: primaryItem.line || 0,
                    content: content,
                    uriString: itemUriStr
                };

                // Add data-id to lines for targeted scrolling
                fileLines += `
                    <div class="log-line" onclick="markActiveLine('${primaryItem.id}', '${uriStr}'); jumpTo('${primaryItem.id}')" data-id="${primaryItem.id}">
                        <div class="gutter">
                            <span class="remove-btn" onclick="removeLineBookmarks(${allIdsStr}, event)">×</span>
                            <span class="line-number">${paddedLine}</span>
                        </div>
                        <div class="line-content">${safeContent}</div>
                    </div>`;
            }

            filesHtml += `
                <div class="file-section ${isFolded ? 'folded' : ''} ${isActive ? 'active-file' : ''}" id="section-${uriStr}">
                    <div class="file-header">
                        <div class="header-left">
                            <button class="fold-toggle" onclick="toggleFold('${uriStr}')" title="Toggle Fold">
                                <svg viewBox="0 0 16 16"><path fill="currentColor" d="M6 4l4 4-4 4V4z"/></svg>
                            </button>
                            <span class="file-name ${uriStr === this._lastAddedUri ? 'flash-active' : ''}" onclick="focusFileScroll('${uriStr}')" title="${filename}">${filename}</span>

                            <div class="header-tags">
                                 ${tagsHtml}
                            </div>
                        </div>
                        <div class="file-actions">
                            <button class="action-btn ${wordWrapEnabled ? 'active' : ''}" onclick="toggleWordWrap()" title="Toggle Word Wrap" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${toggleWordWrapIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn toggle-ln ${withLn ? 'active' : ''}" onclick="toggleLineNumbers('${uriStr}')" title="Include Line Numbers" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${toggleLnIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" onclick="copyFile('${uriStr}')" title="Copy Current File Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${copyFileIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" onclick="openFile('${uriStr}')" title="Open File in Tab" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${openFileIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" onclick="removeFile('${uriStr}')" title="Clear Current File Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${removeFileIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                        </div>
                    </div>
                    <div class="file-lines-container" id="fold-${uriStr}">
                        <div class="file-lines">${fileLines}</div>
                    </div>
                </div>`;
        }

        let finalHtml = filesHtml;
        if (sortedUris.length === 0) {
            finalHtml = '<div class="empty-state">No bookmarks. Right-click on a line to add.</div>';
        }

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Log Bookmarks</title>
                <style>
                    body {
                        font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
                        font-size: var(--vscode-editor-font-size, 12px);
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        padding: 0;
                        margin: 0;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        overflow: hidden;
                    }

                    /* Header Layout */
                    .global-actions-container {
                        display: flex;
                        flex-direction: row; /* One line */
                        justify-content: space-between;
                        align-items: center;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        overflow: hidden;
                    }

                    .file-nav-bar {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 4px 8px;
                        overflow-x: auto;
                        scrollbar-width: none;
                        flex: 1; /* Take remaining space */
                        min-width: 0; /* Allow shrinking */
                        border-bottom: none; /* Merged */
                    }
                    .file-nav-bar::-webkit-scrollbar {
                         display: none;
                    }

                    .global-actions {
                        display: flex;
                        justify-content: flex-end;
                        align-items: center;
                        padding: 4px 8px;
                        gap: 8px;
                        flex-shrink: 0; /* No shrink */
                        border-left: 1px solid var(--vscode-panel-border);
                        background-color: var(--vscode-editor-background);
                        z-index: 10;
                        margin-left: auto; /* Push to right */
                    }

                    .file-nav-btn {
                        background-color: var(--vscode-tab-inactiveBackground);
                        color: var(--vscode-tab-inactiveForeground);
                        border: none;
                        border-radius: 4px; /* Pill/Tab look */
                        padding: 3px 6px;
                        font-size: 11px;
                        cursor: pointer;
                        white-space: nowrap;
                        max-width: 150px;
                        min-width: 30px; /* Allow small buttons */
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex-shrink: 1; /* Allow shrinking */
                        transition: all 0.1s ease;
                        opacity: 0.8;
                    }
                    .file-nav-btn:hover {
                         opacity: 1;
                        background-color: var(--vscode-tab-hoverBackground);
                    }
                    .file-nav-btn.active {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        opacity: 1;
                        font-weight: 600;
                    }

                    .global-btn {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 4px;
                        padding: 2px 8px;
                        font-size: 11px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        white-space: nowrap; /* Prevent wrap */
                    }
                    .global-btn:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    .global-btn svg {
                        width: 14px;
                        height: 14px;
                    }

                    .file-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background-color: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding: 2px 4px;
                        position: sticky;
                        top: 0;
                        z-index: 100;
                        gap: 4px;
                        transition: background-color 0.2s;
                    }
                    .file-section.active-file .file-header {
                        background-color: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    .file-section.active-file .file-name {
                        color: var(--vscode-list-activeSelectionForeground);
                        font-weight: 700;
                    }
                    /* Ensure icons inherit color in active state */
                    .file-section.active-file .action-btn,
                    .file-section.active-file .nav-btn,
                    .file-section.active-file .fold-toggle {
                        color: var(--vscode-list-activeSelectionForeground);
                    }

                    .header-left, .file-actions {
                        display: flex;
                        align-items: center;
                        gap: 2px;
                    }
                    .header-left {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        flex: 1;
                        min-width: 0; /* Crucial for flex truncation */
                        overflow: hidden;
                    }
                    .fold-toggle {
                        background: none;
                        border: none;
                        color: var(--vscode-foreground);
                        cursor: pointer;
                        padding: 0;
                        width: 16px;
                        height: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transform: rotate(90deg);
                        transition: transform 0.1s ease;
                        flex-shrink: 0;
                    }
                    .file-section.folded .fold-toggle {
                        transform: rotate(0deg);
                    }
                    .file-section.folded .file-lines-container {
                        display: none;
                    }
                    .file-lines-container {
                        overflow-x: auto;
                    }
                    .file-name {
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 10.5px;
                        color: var(--vscode-breadcrumb-foreground);
                        padding: 1px 4px;
                        border-radius: 4px;

                        /* Layout & Overflow */
                        display: inline-block;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex-shrink: 1; /* Allow shrinking */
                        min-width: 30px; /* Minimum width before it gets too small */
                    }
                    .file-name.flash-active {
                        animation: flash-bg 1s ease-out;
                    }
                    @keyframes flash-bg {
                        0% { background-color: var(--vscode-editor-findMatchHighlightBackground); }
                        100% { background-color: transparent; }
                    }
                    .file-name:hover {
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }
                    .header-tags {
                        display: flex;
                        gap: 4px;
                        overflow-x: auto;
                        scrollbar-width: none;
                        -ms-overflow-style: none;
                        flex: 1;
                        min-width: 0;
                        margin-left: 4px;
                    }
                    .header-tags::-webkit-scrollbar {
                        display: none;
                    }
                    .tag-scroll-view {
                        display: none;
                    }
                    .tag-scroll-view::-webkit-scrollbar {
                        display: none; /* Hide scrollbar for Chrome, Safari and Opera */
                    }
                    .tag {
                        display: inline-flex;
                        align-items: center;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 1px 6px;
                        border-radius: 10px;
                        font-size: 10px;
                        white-space: nowrap;
                    }
                    .tag-label {
                        max-width: 80px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .tag-remove {
                        margin-left: 4px;
                        cursor: pointer;
                        opacity: 0.7;
                        font-weight: bold;
                    }
                    .tag-remove:hover {
                        opacity: 1;
                    }
                    .tag.file-tag {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        color: var(--vscode-editor-foreground);
                        opacity: 0.9;
                    }
                    .tag.file-tag:hover {
                        opacity: 1;
                        background-color: var(--vscode-editor-selectionBackground);
                    }


                    .content {
                        flex: 1;
                        overflow-y: auto;
                        overflow-x: hidden;
                    }
                    .nav-btn {
                        background: none;
                        border: none;
                        color: var(--vscode-icon-foreground);
                        cursor: pointer;
                        padding: 4px;
                        border-radius: 3px;
                        display: flex;
                        align-items: center;
                        flex-shrink: 0;
                    }
                    .nav-btn:hover:not(:disabled) {
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }
                    .nav-btn:disabled {
                        opacity: 0.3;
                        cursor: default;
                    }
                    .nav-btn svg {
                        width: 16px;
                        height: 16px;
                    }
                    .nav-btn:hover:not(:disabled), .action-btn:hover:not(:disabled) {
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }
                    .nav-btn:disabled, .action-btn:disabled {
                        opacity: 0.3;
                        cursor: default;
                    }
                    .action-btn {
                        background: none;
                        border: none;
                        color: var(--vscode-icon-foreground);
                        cursor: pointer;
                        padding: 3px;
                        margin: 0 1px;
                        border-radius: 3px;
                        display: flex;
                        align-items: center;
                        flex-shrink: 0;
                    }
                    .action-btn svg {
                        width: 12px;
                        height: 12px;
                    }
                    .action-btn.active {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    .action-btn.active:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    .bookmark-group {
                        margin-bottom: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .group-header {
                        padding: 4px 8px;
                        font-size: 10px;
                        color: var(--vscode-descriptionForeground);
                        background-color: var(--vscode-sideBar-background);
                    }
                    .file-actions {
                        display: flex;
                        gap: 2px;
                        flex-shrink: 0;
                    }

                    .log-line {
                        display: flex;
                        white-space: pre;
                        cursor: pointer;
                    }
                    .log-line:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    .gutter {
                        min-width: 60px;
                        display: flex;
                        justify-content: space-between;
                        padding-right: 8px;
                        color: var(--vscode-editorLineNumber-foreground);
                        background-color: var(--vscode-editor-background);
                        border-right: 1px solid var(--vscode-panel-border);
                        user-select: none;
                    }
                    .line-number {
                        font-size: 11px;
                    }
                    .remove-btn {
                        visibility: hidden;
                        color: var(--vscode-errorForeground);
                        padding: 0 4px;
                    }
                    .log-line:hover .remove-btn {
                        visibility: visible;
                    }
                    .line-content {
                        padding-left: 8px;
                        flex: 1;
                    }
                    .match-highlight {
                        text-decoration: underline;
                        text-underline-offset: 2px;
                        text-decoration-color: var(--vscode-editorActionCodeAction-foreground);
                    }
                    .word-wrap .log-line {
                        white-space: pre-wrap;
                        word-break: break-all;
                    }
                    .empty-state {
                        padding: 20px;
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body onmouseenter="vscode.postMessage({type:'mouseEnter'})" onmouseleave="vscode.postMessage({type:'mouseLeave'})">
                <div class="global-actions-container">
                    <div class="file-nav-bar">${headerButtonsHtml}</div>
                    <div class="global-actions">
                        <button class="global-btn" onclick="collapseAll()" title="Collapse all files">
                            <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M9 9H4v1h5V9zM9 6H4v1h5V6zM9 3H4v1h5V3zM4 12h5v-1H4v1zM1 1v14h14V1H1zm13 13H2V2h12v12z"/></svg>
                            Collapse All
                        </button>
                        <button class="global-btn" onclick="clearAll()" title="Remove all bookmarks">
                            <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                            Clear All
                        </button>
                    </div>
                </div>
                <div class="content ${wordWrapEnabled ? 'word-wrap' : ''}">
                    ${finalHtml}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();

                    // Restore ID map for jumps
                    const itemsMap = ${JSON.stringify(itemsMap)};

                    // State Management for scroll position
                    let state = vscode.getState() || {};

                    function saveState() {
                        vscode.setState(state);
                    }

                    // On line click, save this as the last active line for this file
                    function markActiveLine(itemId, uriStr) {
                        state[uriStr] = itemId;
                        saveState();
                    }

                    function jumpTo(id) {
                        const item = itemsMap[id];
                        if (item) {
                            vscode.postMessage({ type: 'jump', item: item });
                        }
                    }

                    function focusFile(uriStr) {
                         vscode.postMessage({ type: 'focusFile', uriString: uriStr });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'setActive':
                                updateActiveState(message.uriString);
                                break;
                        }
                    });

                    function updateActiveState(uriStr) {
                        // 1. Remove old active classes
                        const activeFiles = document.querySelectorAll('.file-section.active-file');
                        activeFiles.forEach(el => el.classList.remove('active-file'));

                        const activeBtns = document.querySelectorAll('.file-nav-btn.active');
                        activeBtns.forEach(el => el.classList.remove('active'));

                        if (uriStr) {
                            // 2. Add active classes
                            const section = document.getElementById('section-' + uriStr);
                            if (section) {
                                section.classList.add('active-file');
                                section.classList.remove('folded'); // Ensure unfolded
                            }

                            const btn = document.querySelector('.file-nav-btn[data-uri="' + uriStr + '"]');
                            if (btn) btn.classList.add('active');

                            // 3. Smart Scroll
                            scrollToUri(uriStr);
                        }
                    }

                    // Alias for button click, also focuses VS Code editor side
                    function focusFileScroll(uriStr) {
                        // Instant Scroll first
                        scrollToUri(uriStr);

                        // Focus in editor
                        vscode.postMessage({ type: 'focusFile', uriString: uriStr });
                    }

                    function scrollToUri(uriStr) {
                        const el = document.getElementById('section-' + uriStr);
                        if (el) {
                             const rect = el.getBoundingClientRect();
                             const isVisible = (
                                rect.top >= 0 &&
                                rect.left >= 0 &&
                                rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                                rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                             );

                             if (!isVisible) {
                                 // Check if we have a saved line ID for this file
                                 let scrolled = false;
                                 if (state[uriStr]) {
                                     // Find the line element by data-id
                                     // Note: We need data-id on log lines for this selector to work
                                     const savedLineEl = el.querySelector('.log-line[data-id="' + state[uriStr] + '"]');
                                     if (savedLineEl) {
                                         savedLineEl.scrollIntoView({ behavior: 'auto', block: 'center' }); // Instant
                                         scrolled = true;
                                     }
                                 }

                                 if (!scrolled) {
                                     // Fallback: Scroll to file section (header/first item)
                                     const firstLine = el.querySelector('.log-line');
                                     if (firstLine) {
                                         firstLine.scrollIntoView({ behavior: 'auto', block: 'center' });
                                     } else {
                                         el.scrollIntoView({ behavior: 'auto', block: 'start' });
                                     }
                                 }
                             }
                        }
                    }

                    function removeLineBookmarks(ids, event) {
                        event.stopPropagation();
                         if (Array.isArray(ids)) {
                            ids.forEach(id => {
                                const item = itemsMap[id];
                                if (item) {
                                    vscode.postMessage({ type: 'remove', item: item });
                                }
                            });
                        }
                    }

                    function removeGroup(groupId, event) {
                        event.stopPropagation();
                         vscode.postMessage({ type: 'removeGroup', groupId: groupId });
                    }

                    function collapseAll() {
                        vscode.postMessage({ type: 'collapseAll' });
                    }

                    function clearAll() {
                        vscode.postMessage({ type: 'clearAll' });
                    }

                     function toggleWordWrap() {
                        vscode.postMessage({ type: 'toggleWordWrap' });
                    }

                    function removeFile(uriStr) {
                         event.stopPropagation();
                        vscode.postMessage({ type: 'removeFile', uriString: uriStr });
                    }

                     function copyFile(uriStr) {
                         event.stopPropagation();
                         vscode.postMessage({ type: 'copyAll', uriString: uriStr });
                    }

                    function openFile(uriStr) {
                        event.stopPropagation();
                         vscode.postMessage({ type: 'openAll', uriString: uriStr });
                    }

                     function toggleFold(uriStr) {
                         event.stopPropagation();
                         vscode.postMessage({ type: 'toggleFold', uriString: uriStr });
                    }

                    function toggleLineNumbers(uriStr) {
                        event.stopPropagation();
                         vscode.postMessage({ type: 'toggleLineNumbers', uriString: uriStr });
                    }

                    // Auto-Scroll to Active File on Load
                    window.addEventListener('load', () => {
                        const activeEl = document.querySelector('.file-section.active-file');
                        if (activeEl) {
                             // Smart scroll on load?
                             // Wait for layout
                            setTimeout(() => {
                                // Get Active URI from active element ID? ID="section-..."
                                const id = activeEl.id;
                                if (id && id.startsWith('section-')) {
                                    const uriStr = id.substring(8);

                                     // Check visibility first
                                    const rect = activeEl.getBoundingClientRect();
                                    const isVisible = (
                                        rect.top >= 0 &&
                                        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
                                    );

                                    if (!isVisible) {
                                         // Reuse logic
                                         let scrolled = false;
                                         if (state[uriStr]) {
                                             const savedLineEl = activeEl.querySelector('.log-line[data-id="' + state[uriStr] + '"]');
                                             if (savedLineEl) {
                                                 savedLineEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                                                 scrolled = true;
                                             }
                                         }

                                         if (!scrolled) {
                                              const firstLine = activeEl.querySelector('.log-line');
                                             if (firstLine) {
                                                 firstLine.scrollIntoView({ behavior: 'auto', block: 'center' });
                                             } else {
                                                 activeEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                                             }
                                         }
                                    }
                                }
                            }, 100);
                        }

                        // Also scroll Active Button into view in the nav bar
                         const activeBtn = document.querySelector('.file-nav-btn.active');
                        if (activeBtn) {
                             setTimeout(() => {
                                 activeBtn.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                            }, 100);
                        }
                    });

                </script>
            </body>
            </html>`;
    }
}
