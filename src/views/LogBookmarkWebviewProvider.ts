import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { Constants } from '../constants';

export class LogBookmarkWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _bookmarkService: LogBookmarkService
    ) {
        this._bookmarkService.onDidChangeBookmarks(() => {
            this.updateContent();
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
                        vscode.commands.executeCommand(Constants.Commands.CopyAllBookmarks);
                        break;
                    case 'openAll':
                        vscode.commands.executeCommand(Constants.Commands.OpenAllBookmarks);
                        break;
                    case 'clearAll':
                        vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);
                        break;
                    case 'back':
                        this._bookmarkService.back();
                        break;
                    case 'forward':
                        this._bookmarkService.forward();
                        break;
                    case 'removeGroup':
                        vscode.commands.executeCommand('logmagnifier.removeBookmarkGroup', data.groupId);
                        break;
                    case 'toggleWordWrap':
                        this._bookmarkService.toggleWordWrap();
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
        vscode.commands.executeCommand('logmagnifier.jumpToBookmark', hydratedItem);
    }

    private removeBookmark(item: any) {
        // Hydrate URI
        const hydratedItem: BookmarkItem = {
            ...item,
            uri: vscode.Uri.parse(item.uriString)
        };
        vscode.commands.executeCommand('logmagnifier.removeBookmark', hydratedItem);
    }

    private removeBookmarkFile(uriStr: string) {
        if (uriStr) {
            vscode.commands.executeCommand('logmagnifier.removeBookmarkFile', vscode.Uri.parse(uriStr));
        }
    }

    private copyBookmarkFile(uriStr: string, withLineNumber: boolean) {
        if (uriStr) {
            vscode.commands.executeCommand('logmagnifier.copyBookmarkFile', vscode.Uri.parse(uriStr), withLineNumber);
        }
    }

    private openBookmarkFile(uriStr: string, withLineNumber: boolean) {
        if (uriStr) {
            vscode.commands.executeCommand('logmagnifier.openBookmarkFile', vscode.Uri.parse(uriStr), withLineNumber);
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

        // Calculate group unique tags
        const groupMap = new Map<string, { keyword: string, count: number }>();
        for (const items of bookmarksMap.values()) {
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
        }

        const tagsHtml = Array.from(groupMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([groupId, data]) => `
            <span class="tag" title="${data.keyword} (${data.count} lines)">
                <span class="tag-label">${data.keyword}</span>
                <span class="tag-remove" onclick="removeGroup('${groupId}', event)">×</span>
            </span>
        `).join('');

        const itemsMap: Record<string, any> = {};
        let filesHtml = '';

        // Sort files by name
        const sortedUris = Array.from(bookmarksMap.keys()).sort();

        for (const uriStr of sortedUris) {
            const items = bookmarksMap.get(uriStr)!;
            const filename = uriStr.split('/').pop() || 'Unknown File';

            let fileLines = '';
            for (const item of items) {
                if (!item || !item.id) {
                    continue;
                }
                const paddedLine = ((item.line || 0) + 1).toString();
                const content = item.content || '';
                let safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

                // Underline matchText if present
                if (item.matchText) {
                    const safeMatchText = item.matchText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    if (safeMatchText) {
                        try {
                            // Escape special regex characters in safeMatchText
                            const escapedMatch = safeMatchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(escapedMatch, 'gi');
                            safeContent = safeContent.replace(regex, (match) => `<u class="match-highlight">${match}</u>`);
                        } catch (e) {
                            // Fallback if regex fails
                        }
                    }
                }

                const itemUriStr = item.uri ? item.uri.toString() : '';

                itemsMap[item.id] = {
                    id: item.id,
                    line: item.line || 0,
                    content: content,
                    uriString: itemUriStr,
                    matchText: item.matchText
                };

                fileLines += `
                    <div class="log-line" onclick="jumpTo('${item.id}')">
                        <div class="gutter">
                            <span class="remove-btn" onclick="removeBookmark('${item.id}', event)">×</span>
                            <span class="line-number">${paddedLine}</span>
                        </div>
                        <div class="line-content">${safeContent}</div>
                    </div>`;
            }

            filesHtml += `
                <div class="file-section">
                    <div class="file-header">
                        <span class="file-name">${filename}</span>
                    </div>
                    <div class="file-lines">${fileLines}</div>
                </div>`;
        }

        let finalHtml = filesHtml;
        if (sortedUris.length === 0) {
            finalHtml = '<div class="empty-state">No bookmarks. Right-click on a line to add.</div>';
        }

        const canGoBack = (this._bookmarkService as any).canGoBack();
        const canGoForward = (this._bookmarkService as any).canGoForward();
        const lineCount = (this._bookmarkService as any).getActiveLinesCount();
        const groupCount = (this._bookmarkService as any).getHistoryGroupsCount();
        const wordWrapEnabled = this._bookmarkService.isWordWrapEnabled();

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
                    .toolbar {
                        display: flex;
                        padding: 2px 4px;
                        background-color: var(--vscode-sideBar-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        gap: 3px;
                        position: sticky;
                        top: 0;
                        z-index: 100;
                        align-items: center;
                    }
                    .tag-scroll-view {
                        display: flex;
                        gap: 4px;
                        overflow-x: auto;
                        flex: 1;
                        padding: 2px 4px;
                        scrollbar-width: none; /* Firefox */
                        -ms-overflow-style: none;  /* IE and Edge */
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
                    .stats-label {
                        font-size: 10px;
                        color: var(--vscode-descriptionForeground);
                        margin-left: 8px;
                        white-space: nowrap;
                    }
                    .content {
                        flex: 1;
                        overflow-y: auto;
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
                    .file-section {
                        padding-bottom: 4px;
                    }
                    .file-header {
                        padding: 2px 8px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background-color: var(--vscode-list-hoverBackground);
                        opacity: 0.8;
                    }
                    .file-name {
                        font-weight: bold;
                        font-size: 11px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
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
            <body>
                <div class="toolbar">
                    <button class="nav-btn" onclick="back()" title="Back" ${canGoBack ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" d="M11.354 1.646l-6 6 6 6 .708-.708L6.773 7.646l5.289-5.292z"/></svg>
                    </button>
                    <button class="nav-btn" onclick="forward()" title="Forward" ${canGoForward ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" d="M4.646 1.646l6 6-6 6-.708-.708 5.292-5.292-5.289-5.292z"/></svg>
                    </button>
                    <div class="stats-label">Ln ${lineCount}, Gr ${groupCount}</div>
                    
                    <div class="tag-scroll-view">
                        ${tagsHtml}
                    </div>
                    
                    <button class="action-btn ${wordWrapEnabled ? 'active' : ''}" onclick="toggleWordWrap()" title="Toggle Word Wrap" ${lineCount > 0 ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M1.5 3H14.5V4H1.5V3ZM1.5 6H11.5V7H1.5V6ZM1.5 9H8.5V10H1.5V9ZM2 12.5C2 11.6716 2.67157 11 3.5 11H14V12H3.5C3.22386 12 3 12.2239 3 12.5C3 12.7761 3.22386 13 3.5 13H14V14H3.5C2.67157 14 2 13.3284 2 12.5Z"/></svg>
                    </button>
                    <button class="action-btn" onclick="copyAll()" title="Copy All Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
                    </button>
                    <button class="action-btn" onclick="openAll()" title="Open All in Tab" ${lineCount > 0 ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L11.774 2.774 6.28 8.268a.75.75 0 0 1-1.06-1.06l5.494-5.494-2.796-2.796A.25.25 0 0 1 8.094 1Z"/></svg>
                    </button>
                    <button class="action-btn" onclick="clearAll()" title="Clear All Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
                        <svg viewBox="0 0 16 16"><path fill="currentColor" d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                    </button>
                </div>
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
                    function back() {
                         vscode.postMessage({ type: 'back' });
                    }
                    function forward() {
                         vscode.postMessage({ type: 'forward' });
                    }
                    function copyAll() {
                         vscode.postMessage({ type: 'copyAll' });
                    }
                    function openAll() {
                         vscode.postMessage({ type: 'openAll' });
                    }
                    function clearAll() {
                         vscode.postMessage({ type: 'clearAll' });
                    }
                    function removeGroup(groupId, event) {
                         if (event) event.stopPropagation();
                         vscode.postMessage({ type: 'removeGroup', groupId: groupId });
                    }
                    function toggleWordWrap() {
                         vscode.postMessage({ type: 'toggleWordWrap' });
                    }
                </script>
            </body>
            </html>`;
    }
}
