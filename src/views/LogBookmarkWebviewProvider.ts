import * as vscode from 'vscode';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';

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
                case 'removeFile':
                    this.removeBookmarkFile(data.uri);
                    break;
                case 'copyFile':
                    this.copyBookmarkFile(data.uri, data.withLineNumber);
                    break;
                case 'openFile':
                    this.openBookmarkFile(data.uri, data.withLineNumber);
                    break;
            }
        });

        this.updateContent();
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

        const html = this.getHtmlForWebview(this._view.webview);
        this._view.webview.html = html;
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const bookmarks = this._bookmarkService.getBookmarks();

        // Prepare data map for client-side
        const itemsMap: Record<string, any> = {};

        let fileGroups = '';

        for (const [uriStr, items] of bookmarks) {
            const uri = vscode.Uri.parse(uriStr);
            const filename = uri.path.split('/').pop();
            // Removed manual zero-padding logic as CSS handles alignment

            let fileLines = '';
            for (const item of items) {
                const paddedLine = (item.line + 1).toString();

                // Escape HTML in content for display ONLY
                const safeContent = item.content.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");

                // Store raw item data in map
                const safeItem = {
                    id: item.id,
                    line: item.line,
                    content: item.content,
                    uriString: item.uri.toString()
                };
                itemsMap[item.id] = safeItem;

                // Flattened structure (Table): log-line (row) > gutter (cell) + line-content (cell)
                // Changed line-content from span to div for better table-cell behavior
                fileLines += `<div class="log-line" onclick="jumpTo('${item.id}')"><div class="gutter"><div class="gutter-content"><span class="remove-btn" onclick="removeBookmark('${item.id}')" title="Remove Bookmark">×</span><span class="line-number">${paddedLine}</span></div></div><div class="line-content">${safeContent}</div></div>`;
            }

            fileGroups += `
            <div class="file-group" id="group-${uriStr.replace(/[^a-zA-Z0-9]/g, '')}">
                <div class="file-header">
                    <span class="file-name">${filename}</span>
                    <div class="file-actions">
                         <span class="action-btn toggle-ln" onclick="toggleLineNumbers(this, '${uriStr}')" title="Toggle Line Numbers in Copy/Open">
                            <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M3.68423 1.01091C3.87729 1.05479 4.01368 1.2207 4.01368 1.41166V4.70581C4.01368 4.93322 3.82219 5.11757 3.58596 5.11757C3.34974 5.11757 3.15825 4.93322 3.15825 4.70581V2.57963C2.97169 2.73831 2.75056 2.89181 2.49409 3.01526C2.28281 3.11697 2.02589 3.03452 1.92025 2.83112C1.81461 2.62771 1.90025 2.38037 2.11153 2.27867C2.46535 2.10836 2.74051 1.84713 2.93118 1.61767C3.02531 1.50441 3.09555 1.40286 3.1415 1.33097C3.1627 1.2978 3.18339 1.26423 3.20219 1.22973C3.29453 1.06158 3.48853 0.966435 3.68423 1.01091ZM2.15471 7.05586C1.98767 6.89507 1.98765 6.63435 2.15467 6.47354L2.15572 6.47253L2.15693 6.47137L2.15988 6.46859L2.16776 6.46129C2.17391 6.45568 2.18184 6.44859 2.19152 6.44025C2.21087 6.42357 2.23731 6.40176 2.27057 6.3766C2.33688 6.32642 2.43152 6.26193 2.55214 6.19802C2.79299 6.07042 3.1454 5.94109 3.58393 5.94111L3.59112 5.94117C3.91125 5.94637 4.25871 6.0263 4.53792 6.22535C4.83289 6.43563 5.02344 6.76107 5.02344 7.17649C5.02344 7.62757 4.81618 7.94311 4.53538 8.16839C4.32073 8.34059 4.04529 8.47067 3.82121 8.5765C3.78525 8.59348 3.7506 8.60985 3.7177 8.62568C3.45144 8.75385 3.24954 8.86678 3.10777 9.01691C3.05092 9.07712 2.99998 9.14746 2.96119 9.23535H4.59572C4.83194 9.23535 5.02344 9.4197 5.02344 9.64712C5.02344 9.87453 4.83146 10.0589 4.59524 10.0589H2.45713C2.22091 10.0589 2.02941 9.87453 2.02941 9.64712C2.02941 9.13717 2.19981 8.75415 2.4748 8.46294C2.73402 8.18843 3.06676 8.01827 3.33515 7.88909C3.37811 7.86841 3.41971 7.84859 3.45892 7.8299C3.69012 7.71973 3.85827 7.6396 3.98775 7.53573C4.10794 7.4393 4.168 7.34307 4.168 7.17649C4.168 7.02774 4.11074 6.94556 4.02884 6.88718C3.93179 6.81799 3.77468 6.76838 3.58027 6.76465C3.3214 6.76534 3.1117 6.84157 2.9646 6.91951C2.89091 6.95855 2.83494 6.99702 2.7992 7.02406C2.78144 7.0375 2.76901 7.04787 2.76223 7.05372L2.7566 7.05867C2.58935 7.21663 2.32076 7.2157 2.15471 7.05586ZM3.09366 12.9412C3.09366 12.7137 3.28516 12.5294 3.52138 12.5294C3.81461 12.5294 3.97666 12.4498 4.05829 12.3786C4.13892 12.3083 4.17203 12.221 4.1686 12.1331C4.1624 11.9737 4.00959 11.7059 3.52138 11.7059C3.16851 11.7059 2.98575 11.7896 2.9032 11.8426C2.85995 11.8703 2.8367 11.8944 2.82745 11.9051L2.82395 11.9093C2.82756 11.9032 2.83103 11.8969 2.83435 11.8906L2.83348 11.8922L2.83236 11.8943L2.83029 11.8981L2.82682 11.9042C2.82481 11.9077 2.82222 11.9116 2.82222 11.9116L2.82395 11.9093C2.71246 12.0985 2.46527 12.1726 2.2608 12.0742C2.04952 11.9725 1.96388 11.7251 2.06952 11.5217L2.07013 11.5205L2.07077 11.5193L2.07213 11.5168L2.07516 11.5112L2.08257 11.4982C2.08813 11.4888 2.09495 11.4778 2.10316 11.4655C2.11958 11.4409 2.14161 11.411 2.17029 11.3779C2.22786 11.3114 2.31154 11.2325 2.42869 11.1574C2.66693 11.0045 3.01882 10.8823 3.52138 10.8823C4.40187 10.8823 4.99757 11.438 5.02344 12.1022C5.03523 12.4048 4.92247 12.7081 4.68433 12.9412C4.92247 13.1743 5.03523 13.4775 5.02344 13.7801C4.99757 14.4443 4.40187 15 3.52138 15C3.01882 15 2.66693 14.8779 2.42869 14.725C2.31154 14.6498 2.22786 14.5709 2.17029 14.5044C2.14161 14.4713 2.11958 14.4414 2.10316 14.4168C2.09495 14.4045 2.08813 14.3935 2.08257 14.3841L2.07516 14.3711L2.07213 14.3655L2.07077 14.363L2.07013 14.3618L2.06952 14.3606C1.96388 14.1572 2.04952 13.9099 2.2608 13.8082C2.46527 13.7098 2.71246 13.7838 2.82395 13.973L2.82745 13.9772C2.8367 13.9879 2.85995 14.012 2.9032 14.0397C2.98575 14.0927 3.16851 14.1765 3.52138 14.1765C4.00959 14.1765 4.1624 13.9086 4.1686 13.7493C4.17203 13.6613 4.13892 13.574 4.05829 13.5037C3.97666 13.4325 3.81461 13.3529 3.52138 13.3529C3.28516 13.3529 3.09366 13.1686 3.09366 12.9412ZM7.5 3C7.22386 3 7 3.22386 7 3.5C7 3.77614 7.22386 4 7.5 4H13.5C13.7761 4 14 3.77614 14 3.5C14 3.22386 13.7761 3 13.5 3H7.5ZM7.5 7C7.22386 7 7 7.22386 7 7.5C7 7.77614 7.22386 8 7.5 8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H7.5ZM7.5 11C7.22386 11 7 11.2239 7 11.5C7 11.7761 7.22386 12 7.5 12H13.5C13.7761 12 14 11.7761 14 11.5C14 11.2239 13.7761 11 13.5 11H7.5Z"/></svg>
                        </span>
                        <span class="action-btn" onclick="copyFile('${uriStr}')" title="Copy to Clipboard">
                            <svg viewBox="0 0 16 16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
                        </span>
                        <span class="action-btn" onclick="openFile('${uriStr}')" title="Open in New Tab">
                            <svg viewBox="0 0 16 16"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L11.774 2.774 6.28 8.268a.75.75 0 0 1-1.06-1.06l5.494-5.494-2.796-2.796A.25.25 0 0 1 8.094 1Z"/></svg>
                        </span>
                        <span class="separator"></span>
                        <span class="action-btn" onclick="removeFile('${uriStr}')" title="Delete All">
                            <svg viewBox="0 0 16 16"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                        </span>
                    </div>
                </div>
                <div class="file-content"><div class="lines-inner">${fileLines}</div></div>
            </div>`;
        }

        if (bookmarks.size === 0) {
            fileGroups = '<div class="empty-state">No bookmarks yet. Right-click on a line in an editor and select "Add line to LogMagnifier bookmark".</div>';
        }

        // Serialize the full map to inject into the script
        const serializedMap = JSON.stringify(itemsMap);

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
                    }
                    .file-group {
                        margin-bottom: 0px;
                        display: flex;
                        flex-direction: column;
                    }
                    .file-header {
                        font-family: var(--vscode-font-family, sans-serif);
                        font-size: 11px;
                        font-weight: bold;
                        color: var(--vscode-sideBarTitle-foreground);
                        background-color: var(--vscode-sideBar-background);
                        opacity: 1.0;
                        padding: 4px 10px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                    }
                    .file-name {
                        flex: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .file-actions {
                        display: flex;
                        gap: 8px;
                        margin-left: 8px;
                    }
                    .action-btn {
                        cursor: pointer;
                        color: var(--vscode-icon-foreground);
                        opacity: 0.6;
                        transition: opacity 0.2s, color 0.2s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 20px;
                        height: 20px;
                        border-radius: 3px;
                    }
                    .action-btn:hover {
                        opacity: 1;
                        background-color: var(--vscode-toolbar-hoverBackground);
                        color: var(--vscode-foreground);
                    }
                    .action-btn.active {
                        opacity: 1;
                        color: var(--vscode-editorOption-activeForeground, var(--vscode-foreground));
                    }
                    .action-btn:not(.active).toggle-ln {
                        opacity: 0.3;
                    }
                    .action-btn svg {
                        width: 14px;
                        height: 14px;
                        fill: currentColor;
                    }
                    .separator {
                        width: 1px;
                        height: 14px;
                        background-color: var(--vscode-panel-border);
                        margin: 0 4px;
                        opacity: 0.5;
                    }
                    .file-content {
                        display: block;
                        overflow-x: auto;
                    }
                    .lines-inner {
                        /* Table layout enforces strictest width alignment */
                        display: table;
                        width: 100%; /* Will expand if content forces it */
                        border-collapse: collapse; /* For border rendering */
                    }
                    .log-line {
                        display: table-row;
                        line-height: 18px;
                        cursor: pointer;
                        /* border-bottom on tr is tricky, handled by cells */
                    }
                    .log-line:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
 s
                    /* Unified Sticky Gutter */
                    .gutter {
                        display: table-cell;
                        position: sticky;
                        left: 0;
                        z-index: 10;
                        vertical-align: top;
                        background-color: var(--vscode-editor-background);
                        border-right: 1px solid var(--vscode-editorRuler-foreground);
                        padding: 0; /* Clear internal padding */
                        width: 1px; /* Shrink to fit content */
                        white-space: nowrap;
                    }
                    /* Needs internal wrapper for flex alignment inside the cell if needed,
                       but we remove flex from gutter to act as pure cell */
                    .log-line:hover .gutter {
                        background-color: var(--vscode-list-hoverBackground);
                    }

                    .gutter-content {
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        height: 100%;
                    }

                    .remove-btn {
                        display: inline-block; /* Inline inside table cell gutter */
                        vertical-align: middle;
                        cursor: pointer;
                        color: transparent;
                        width: 20px;
                        text-align: center;
                        font-size: 14px;
                        transition: color 0.1s;
                        height: 18px;
                        line-height: 18px;
                        user-select: none; /* Prevent copying */
                    }
                    .log-line:hover .remove-btn {
                        color: var(--vscode-icon-foreground);
                    }
                    .remove-btn:hover {
                        color: var(--vscode-errorForeground) !important;
                    }

                    .line-number {
                        display: inline-block; /* Inline inside table cell gutter */
                        vertical-align: middle;
                        color: var(--vscode-editorLineNumber-foreground);
                        min-width: 40px;
                        text-align: right;
                        padding-right: 15px;
                        user-select: none;
                        height: 18px;
                        line-height: 18px;
                    }

                    .line-content {
                        display: table-cell;
                        vertical-align: top;
                        color: var(--vscode-editor-foreground);
                        padding-left: 10px;
                        padding-right: 10px;
                        white-space: pre;
                        font-family: inherit;
                        tab-size: 4;
                        z-index: 0;
                        width: 100%;
                    }

                    .empty-state {
                        color: var(--vscode-descriptionForeground);
                        padding: 20px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                ${fileGroups}
                <script>
                    const vscode = acquireVsCodeApi();
                    const itemsMap = ${serializedMap};
                    const lineNumbersState = {};

                    function jumpTo(id) {
                         const item = itemsMap[id];
                         if (item) {
                             vscode.postMessage({ type: 'jump', item: item });
                         }
                    }
                    function removeBookmark(id) {
                         const item = itemsMap[id];
                         if (item) {
                             vscode.postMessage({ type: 'remove', item: item });
                         }
                         // Prevent bubbling to jump
                         event.stopPropagation();
                    }
                    function removeFile(uri) {
                         vscode.postMessage({ type: 'removeFile', uri: uri });
                    }
                    function toggleLineNumbers(btn, uri) {
                         const isActive = btn.classList.contains('active');
                         if (isActive) {
                             btn.classList.remove('active');
                             lineNumbersState[uri] = false;
                         } else {
                             btn.classList.add('active');
                             lineNumbersState[uri] = true;
                         }
                    }
                    function copyFile(uri) {
                         const withLineNumber = lineNumbersState[uri] === true; // Default false
                         vscode.postMessage({ type: 'copyFile', uri: uri, withLineNumber: withLineNumber });
                    }
                    function openFile(uri) {
                         const withLineNumber = lineNumbersState[uri] === true; // Default false
                         vscode.postMessage({ type: 'openFile', uri: uri, withLineNumber: withLineNumber });
                    }
                </script>
            </body>
            </html>`;
    }
}
