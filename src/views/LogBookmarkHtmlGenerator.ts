import * as vscode from 'vscode';

import { LogBookmarkService } from '../services/LogBookmarkService';
import { BookmarkItem } from '../models/Bookmark';
import { SerializedBookmarkItem } from '../models/WebviewModels';
import { getNonce } from '../utils/WebviewUtils';
import { Logger } from '../services/Logger';

export class LogBookmarkHtmlGenerator {
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _bookmarkService: LogBookmarkService,
        private readonly _logger: Logger
    ) { }

    public async generateHtml(webview: vscode.Webview, activeUriStr?: string, lastAddedUri?: string, foldedUris: Set<string> = new Set()): Promise<string> {
        const bookmarksMap = this._bookmarkService.getBookmarks();
        const sortedUris = this._bookmarkService.getFileKeys();
        const wordWrapEnabled = this._bookmarkService.isWordWrapEnabled();

        const itemsMap: Record<string, SerializedBookmarkItem> = {};
        let filesHtml = '';
        let headerButtonsHtml = '';

        const toggleLnIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'list-ordered.svg'));
        const toggleWordWrapIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'word-wrap.svg'));
        const removeFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'trash.svg'));
        const copyFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'copy.svg'));
        const openFileIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'link-external.svg'));

        const nonce = getNonce();

        for (const uriStr of sortedUris) {
            const withLn = this._bookmarkService.isIncludeLineNumbersEnabled(uriStr);
            const items = bookmarksMap.get(uriStr)!;
            const filename = uriStr.split('/').pop() || 'Unknown File';
            const isFolded = foldedUris.has(uriStr);
            const isActive = uriStr === activeUriStr;

            // --- Header Button Generation ---
            let btnLabel = filename;
            if (btnLabel.length > 20) {
                btnLabel = btnLabel.substring(0, 17) + '...';
            }

            headerButtonsHtml += `
                <button class="file-nav-btn ${isActive ? 'active' : ''}" data-action="focusFileScroll" data-uri="${uriStr}" title="${filename}">
                    ${btnLabel}
                </button>
            `;

            // --- Tags Generation ---
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
                    <span class="tag-remove" data-action="removeGroup" data-group-id="${groupId}">×</span>
                </span>
            `).join('');

            const lineCount = this._bookmarkService.getFileActiveLinesCount(uriStr);

            // --- Lines Generation ---
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

                const primaryItem = lineItems[0];
                const paddedLine = ((primaryItem.line || 0) + 1).toString();
                const content = primaryItem.content || '';

                const uniqueMatchTexts = new Set<string>();
                lineItems.forEach((item: BookmarkItem) => {
                    if (item.matchText) {
                        uniqueMatchTexts.add(item.matchText);
                    }
                });

                let safeContent = content;
                if (uniqueMatchTexts.size > 0) {
                    const escapedMatches = Array.from(uniqueMatchTexts).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
                    } catch (_e) {
                        safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    }
                } else {
                    safeContent = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }

                const itemUriStr = primaryItem.uri ? primaryItem.uri.toString() : '';
                const allIds = lineItems.map((i: BookmarkItem) => i.id);
                const allIdsStr = JSON.stringify(allIds).replace(/"/g, '&quot;');

                itemsMap[primaryItem.id] = {
                    id: primaryItem.id,
                    line: primaryItem.line || 0,
                    content: content,
                    uriString: itemUriStr
                };

                fileLines += `
                    <div class="log-line" data-action="lineClick" data-id="${primaryItem.id}" data-uri="${uriStr}">
                        <div class="gutter">
                            <span class="remove-btn" data-action="removeLineBookmarks" data-ids='${allIdsStr}'>×</span>
                            <span class="line-number">${paddedLine}</span>
                        </div>
                        <div class="line-content">${safeContent}</div>
                    </div>`;
            }

            filesHtml += `
                <div class="file-section ${isFolded ? 'folded' : ''} ${isActive ? 'active-file' : ''}" id="section-${uriStr}">
                    <div class="file-header">
                        <div class="header-left">
                            <button class="fold-toggle" data-action="toggleFold" data-uri="${uriStr}" title="Toggle Fold">
                                <svg viewBox="0 0 16 16"><path fill="currentColor" d="M6 4l4 4-4 4V4z"/></svg>
                            </button>
                            <span class="file-name ${uriStr === lastAddedUri ? 'flash-active' : ''}" data-action="focusFileScroll" data-uri="${uriStr}" title="${filename}">${filename}</span>

                            <div class="header-tags">
                                 ${tagsHtml}
                            </div>
                        </div>
                        <div class="file-actions">
                            <button class="action-btn ${wordWrapEnabled ? 'active' : ''}" data-action="toggleWordWrap" title="Toggle Word Wrap" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${toggleWordWrapIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn toggle-ln ${withLn ? 'active' : ''}" data-action="toggleLineNumbers" data-uri="${uriStr}" title="Include Line Numbers" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${toggleLnIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" data-action="copyFile" data-uri="${uriStr}" title="Copy Current File Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${copyFileIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" data-action="openFile" data-uri="${uriStr}" title="Open File in Tab" ${lineCount > 0 ? '' : 'disabled'}>
                                <div style="width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: url('${openFileIconUri}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"></div>
                            </button>
                            <button class="action-btn" data-action="removeFile" data-uri="${uriStr}" title="Clear Current File Bookmarks" ${lineCount > 0 ? '' : 'disabled'}>
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

        const templatePath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'log-bookmark-template.html');
        try {
            const templateBytes = await vscode.workspace.fs.readFile(templatePath);
            let template = new TextDecoder('utf-8').decode(templateBytes);

            template = template.replace(/{{\s*CSP_SOURCE\s*}}/g, webview.cspSource);
            template = template.replace(/{{\s*NONCE\s*}}/g, nonce);
            template = template.replace(/{{\s*NAV_BAR\s*}}/g, headerButtonsHtml);
            template = template.replace(/{{\s*WORD_WRAP_CLASS\s*}}/g, wordWrapEnabled ? 'word-wrap' : '');
            template = template.replace(/{{\s*CONTENT\s*}}/g, finalHtml);
            template = template.replace(/{{\s*ITEMS_MAP\s*}}/g, JSON.stringify(itemsMap));

            return template;
        } catch (e) {
            this._logger.error(`Error reading template: ${e}`);
            return `<html><body>Error reading template: ${e}</body></html>`;
        }
    }
}
