import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { Constants } from '../constants';
import { Logger } from '../services/Logger';

export class LogBookmarkWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _lastAddedUri?: string;
    private _foldedUris: Set<string> = new Set();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _bookmarkService: LogBookmarkService
    ) {
        this._bookmarkService.onDidChangeBookmarks(() => {
            this.updateContent();
        });

        this._bookmarkService.onDidAddBookmark((uri) => {
            this._lastAddedUri = uri.toString();
            this.updateContent();
            // Clear flash after 1 second
            setTimeout(() => {
                this._lastAddedUri = undefined;
                this.updateContent();
            }, 1000);
        });
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

            webviewView.webview.onDidReceiveMessage(data => {
                switch (data.type) {
                    case 'jump':
                        this.jumpToBookmark(data.item);
                        break;
                    case 'remove':
                        this.removeBookmark(data.item);
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
                    case 'clearAll':
                        vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);
                        break;
                    case 'back':
                        this._bookmarkService.back(data.uriString);
                        break;
                    case 'forward':
                        this._bookmarkService.forward(data.uriString);
                        break;
                    case 'removeGroup':
                        vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkGroup, data.groupId);
                        break;
                    case 'focusFile':
                        this.focusFile(data.uriString);
                        break;
                    case 'removeFile':
                        this.removeBookmarkFile(data.uriString);
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
                        if (this._foldedUris.has(data.uriString)) {
                            this._foldedUris.delete(data.uriString);
                        } else {
                            this._foldedUris.add(data.uriString);
                        }
                        break;
                    case 'toggleLineNumbers':
                        this._bookmarkService.toggleIncludeLineNumbers(data.uriString);
                        break;
                }
            });

            this.updateContent();
        } catch (e) {
            console.error('Error resolving webview view:', e);
            webviewView.webview.html = `<html><body><div style="padding: 20px; color: var(--vscode-errorForeground);">
                Critical Error resolving view: ${e}
            </div></body></html>`;
        }
    }

    private jumpToBookmark(item: any) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString)
        };
        vscode.commands.executeCommand(Constants.Commands.JumpToBookmark, hydratedItem);
    }

    private removeBookmark(item: any) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString)
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
            await vscode.window.showTextDocument(doc, { preview: true });
        } catch (e) {
            console.error('Error focusing file:', e);
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
                <button onclick="acquireVsCodeApi().postMessage({type: 'back'})">Try Back</button>
            </div></body></html>`;
        }
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const bookmarksMap = this._bookmarkService.getBookmarks();
        const activeEditor = vscode.window.activeTextEditor;
        const activeUriStr = activeEditor?.document.uri.toString();

        const sortedUris = Array.from(bookmarksMap.keys()).sort();

        const wordWrapEnabled = this._bookmarkService.isWordWrapEnabled();
        const itemsMap: Record<string, any> = {};
        let filesHtml = '';

        const toggleLnIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'list-ordered.svg'));
        const toggleWordWrapIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'word-wrap.svg'));
        const removeFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'trash.svg'));
        const copyFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'copy.svg'));
        const openFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'link-external.svg'));

        for (const uriStr of sortedUris) {
            const withLn = this._bookmarkService.isIncludeLineNumbersEnabled(uriStr);
            const items = bookmarksMap.get(uriStr)!;
            const filename = uriStr.split('/').pop() || 'Unknown File';
            const displayFilename = filename.length > 15 ? filename.substring(0, 15) + '...' : filename;
            const isFolded = this._foldedUris.has(uriStr);

            // Calculate per-file tags
            const groupMap = new Map<string, { keyword: string, count: number }>();
            for (const item of items) {
                if (item.groupId) {
                    const existing = groupMap.get(item.groupId);
                    if (existing) {
                        existing.count++;
                    } else {
                        groupMap.set(item.groupId, {
                            keyword: item.matchText || 'Manual',
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

            const canGoBack = (this._bookmarkService as any).canGoBack(uriStr);
            const canGoForward = (this._bookmarkService as any).canGoForward(uriStr);
            const lineCount = (this._bookmarkService as any).getFileActiveLinesCount(uriStr);
            const groupCount = (this._bookmarkService as any).getFileHistoryGroupsCount(uriStr);

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
                if (lineItems.length === 0) continue;

                // Use the first item for basic line info
                const primaryItem = lineItems[0];
                const paddedLine = ((primaryItem.line || 0) + 1).toString();
                const content = primaryItem.content || '';

                // Collect all match texts for this line
                const uniqueMatchTexts = new Set<string>();
                lineItems.forEach(item => {
                    if (item.matchText) uniqueMatchTexts.add(item.matchText);
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

                // For the "Click" action, we probably want to just jump to the line. Using primaryItem ID works.
                // For "Remove" action (X button), we should probably remove ALL bookmarks for this line.
                // Store all IDs for this line
                const allIds = lineItems.map(i => i.id);
                // We'll pass the first ID to the map, but we might need a "removeLine" vs "removeItem" concept.
                // Current UI calls `removeBookmark(id)`. 
                // Let's make `removeBookmark` in webview accept an ID, and we'll implement a `removeLine` helper in JS
                // or just iterate and remove all?
                // Ideally, the "X" on the gutter implies "Clear this line".

                // Let's modify the HTML generation to embed all IDs in the remove button call.
                const allIdsStr = JSON.stringify(allIds).replace(/"/g, '&quot;');

                // Use primary ID for jump
                itemsMap[primaryItem.id] = {
                    id: primaryItem.id, // This is just for jump lookup
                    line: primaryItem.line || 0,
                    content: content,
                    uriString: itemUriStr
                };

                fileLines += `
                    <div class="log-line" onclick="jumpTo('${primaryItem.id}')">
                        <div class="gutter">
                            <span class="remove-btn" onclick="removeLineBookmars(${allIdsStr}, event)">×</span>
                            <span class="line-number">${paddedLine}</span>
                        </div>
                        <div class="line-content">${safeContent}</div>
                    </div>`;
            }

            filesHtml += `
                <div class="file-section ${isFolded ? 'folded' : ''}" id="section-${uriStr}">
                    <div class="file-header">
                        <div class="header-left">
                            <button class="fold-toggle" onclick="toggleFold('${uriStr}')" title="Toggle Fold">
                                <svg viewBox="0 0 16 16"><path fill="currentColor" d="M6 4l4 4-4 4V4z"/></svg>
                            </button>
                            <span class="file-name ${uriStr === this._lastAddedUri ? 'flash-active' : ''}" onclick="focusFile('${uriStr}')" title="${filename}">${displayFilename}</span>
                            <button class="nav-btn" onclick="back('${uriStr}')" title="Back" ${canGoBack ? '' : 'disabled'}>
                                <svg viewBox="0 0 16 16"><path fill="currentColor" d="M11.354 1.646l-6 6 6 6 .708-.708L6.773 7.646l5.289-5.292z"/></svg>
                            </button>
                            <button class="nav-btn" onclick="forward('${uriStr}')" title="Forward" ${canGoForward ? '' : 'disabled'}>
                                <svg viewBox="0 0 16 16"><path fill="currentColor" d="M4.646 1.646l6 6-6 6-.708-.708 5.292-5.292-5.289-5.292z"/></svg>
                            </button>
                            <div class="stats-label">Ln:${lineCount}, Gr:${groupCount}</div>
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
                        min-width: 0;
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
                        display: inline-flex;
                        align-items: center;
                        white-space: nowrap;
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
                    .stats-label {
                        font-size: 9px;
                        color: var(--vscode-descriptionForeground);
                        margin: 0 4px;
                        white-space: nowrap;
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
                        gap: 4px;
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
                <div class="content ${wordWrapEnabled ? 'word-wrap' : ''}">
                    ${finalHtml}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const itemsMap = ${JSON.stringify(itemsMap).replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/<\/script>/g, '<\\/script>')};

                    // Scroll preservation logic
                    const contentDiv = document.querySelector('.content');
                    const previousState = vscode.getState();
                    if (previousState && previousState.scrollPos && contentDiv) {
                        contentDiv.scrollTop = previousState.scrollPos;
                    }

                    if (contentDiv) {
                        contentDiv.addEventListener('scroll', () => {
                            vscode.setState({ scrollPos: contentDiv.scrollTop });
                        });
                    }

                    function jumpTo(id) {
                         const item = itemsMap[id];
                         if (item) {
                             vscode.postMessage({ type: 'jump', item: item });
                         }
                    }
                    function removeBookmark(id, event) {
                         const item = itemsMap[id];
                         if (item) {
                             vscode.postMessage({ type: 'remove', item: item });
                         }
                         if (event) {
                             event.stopPropagation();
                         }
                    }
                    function removeLineBookmars(ids, event) {
                        if (ids && ids.length > 0) {
                            // We can just iterate and send remove messages, or send a batch. 
                            // Since we don't have batch remove message type yet, iterate.
                            ids.forEach(id => {
                                const item = itemsMap[id];
                                if (item) {
                                    vscode.postMessage({ type: 'remove', item: item });
                                }
                            });
                        }
                        if (event) {
                            event.stopPropagation();
                        }
                    }
                    function toggleFold(uriStr) {
                         const section = document.getElementById('section-' + uriStr);
                         if (section) {
                             section.classList.toggle('folded');
                             vscode.postMessage({ type: 'toggleFold', uriString: uriStr });
                         }
                    }
                    function back(uriStr) {
                         vscode.postMessage({ type: 'back', uriString: uriStr });
                    }
                    function forward(uriStr) {
                         vscode.postMessage({ type: 'forward', uriString: uriStr });
                    }
                    function copyFile(uriStr) {
                         vscode.postMessage({ type: 'copyAll', uriString: uriStr });
                    }
                    function openFile(uriStr) {
                         vscode.postMessage({ type: 'openAll', uriString: uriStr });
                    }
                    function clearAll() {
                         vscode.postMessage({ type: 'clearAll' });
                    }
                    function removeFile(uriStr) {
                         vscode.postMessage({ type: 'removeFile', uriString: uriStr });
                    }
                    function removeGroup(groupId, event) {
                         if (event) event.stopPropagation();
                         vscode.postMessage({ type: 'removeGroup', groupId: groupId });
                    }
                    function toggleWordWrap() {
                         vscode.postMessage({ type: 'toggleWordWrap' });
                    }
                    function toggleLineNumbers(uriStr) {
                         vscode.postMessage({ type: 'toggleLineNumbers', uriString: uriStr });
                    }
                    function focusFile(uriString) {
                         vscode.postMessage({ type: 'focusFile', uriString: uriString });
                    }
                    function removeFile(uriString, event) {
                         if (event) event.stopPropagation();
                         vscode.postMessage({ type: 'removeFile', uriString: uriString });
                    }
                </script>
            </body>
            </html>`;
    }
}
