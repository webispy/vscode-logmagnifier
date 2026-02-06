import * as vscode from 'vscode';
import { getNonce } from '../utils/WebviewUtils';

export class JsonTreeWebview {
    private panel: vscode.WebviewPanel | undefined;

    private readonly _onDidRevealLine = new vscode.EventEmitter<{ uri: string, line: number }>();
    public readonly onDidRevealLine = this._onDidRevealLine.event;

    constructor(private readonly context: vscode.ExtensionContext) { }

    public show(data: unknown, title: string = 'JSON Preview', status: 'valid' | 'invalid' | 'no-json' = 'valid', tabSize: number = 2, sourceUri?: string, sourceLine?: number, preserveFocus: boolean = false) {
        if (this.panel) {
            const expansionDepth = this.context.globalState.get<number>('jsonPreview.expansionDepth', 1);
            this.panel.reveal(vscode.ViewColumn.Beside, preserveFocus);
            this.panel.webview.postMessage({ command: 'update', data, status, tabSize, sourceUri, sourceLine, expansionDepth });
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'logmagnifier-json-tree',
                title,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: preserveFocus },
                {
                    enableScripts: true,
                    localResourceRoots: [this.context.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'reveal') {
                    this._onDidRevealLine.fire({ uri: message.uri, line: message.line });
                } else if (message.command === 'saveState') {
                    this.context.globalState.update('jsonPreview.expansionDepth', message.expansionDepth);
                }
            });

            // Initial data
            const expansionDepth = this.context.globalState.get<number>('jsonPreview.expansionDepth', 1);
            this.panel.webview.html = this.getHtmlForWebview(data, status, tabSize, sourceUri, sourceLine, expansionDepth);
        }
    }

    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    public get isVisible(): boolean {
        return !!this.panel;
    }

    private getHtmlForWebview(data: unknown, status: 'valid' | 'invalid' | 'no-json', tabSize: number = 2, sourceUri?: string, sourceLine?: number, expansionDepth: number = 1): string {
        const initialData = JSON.stringify(data);
        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel?.webview.cspSource || 'vscode-resource:'} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>JSON Preview</title>
            <style>
                :root {
                    --tree-item-padding: 3px 0;
                    --tree-indent: 20px;
                    --key-color: var(--vscode-symbolIcon-propertyForeground);
                    --string-color: var(--vscode-debugTokenExpression-string);
                    --number-color: var(--vscode-debugTokenExpression-number);
                    --boolean-color: var(--vscode-debugTokenExpression-boolean);
                    --null-color: var(--vscode-debugTokenExpression-keyword);
                    --row-hover-bg: var(--vscode-list-hoverBackground);
                    --row-focus-bg: var(--vscode-list-activeSelectionBackground);
                    --row-focus-fg: var(--vscode-list-activeSelectionForeground);

                    /* Stronger highlights */
                    --highlight-bg: #ea5c00;
                    --highlight-fg: #ffffff;
                    --current-match-bg: #007acc;
                    --current-match-fg: #ffffff;
                }
                .status-badge {
                    padding: 3px 8px;
                    border-radius: 3px;
                    font-size: 11px;
                    font-weight: bold;
                    margin-right: 10px;
                    display: inline-block;
                    line-height: normal;
                }
                .status-valid {
                    background-color: #2da042;
                    color: #fff;
                }
                .status-invalid {
                    background-color: #d73a49;
                    color: #fff;
                }
                .error {
                    color: #d73a49 !important;
                    font-weight: bold;
                    /* text-decoration: underline wavy #d73a49; optional */
                }
                html {
                    scroll-padding-top: 60px; /* Top toolbar space */
                    scroll-padding-bottom: 60px; /* Bottom toolbar space */
                }
                body {
                    font-family: var(--vscode-editor-font-family); /* Use editor font for everything */
                    font-size: 14px; /* Larger text */
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 10px;
                    padding-bottom: 50px; /* Space for bottom toolbar */
                    margin: 0;
                    overflow-x: hidden;
                }
                .top-toolbar {
                    display: flex;
                    justify-content: flex-start;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--vscode-widget-border);
                    margin-bottom: 15px;
                    position: sticky;
                    top: 0;
                    background-color: var(--vscode-editor-background);
                    z-index: 10;
                }
                .search-box {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1; /* Take remaining space */
                    min-width: 0;
                }
                .bottom-toolbar {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 40px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-widget-border);
                    display: flex;
                    align-items: center;
                    padding: 0 10px;
                    gap: 10px;
                    z-index: 20;
                    justify-content: flex-start;
                }

                .search-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    width: 35ch; /* User requested default 35 chars */
                    max-width: 50ch; /* User requested max 50 chars */
                    min-width: 10ch;
                    flex-shrink: 1;
                }

                input[type="text"] {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 4px 6px;
                    padding-right: 80px; /* Increased space for count */
                    border-radius: 2px;
                    font-size: 13px;
                    width: 100%;
                }
                input[type="text"]:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }

                .count-overlay {
                    position: absolute;
                    right: 6px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 13px; /* Same as input font size */
                    color: var(--vscode-textLink-foreground);
                    pointer-events: none; /* Let clicks pass through to input */
                    white-space: nowrap;
                    text-align: right;
                    max-width: 75px; /* Increased to prevent truncation */
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .search-actions {
                    display: flex;
                    gap: 4px;
                    flex-shrink: 0;
                }

                /* Text Label Buttons */
                #btn-compact, #btn-toggle-view {
                    /* Keep text but allow shrink if really needed already handled by button CSS */
                }


                button {
                    background: none;
                    border: 1px solid transparent;
                    color: var(--vscode-button-foreground);
                    background-color: var(--vscode-button-background);
                    padding: 4px; /* Reduced padding for icons */
                    cursor: pointer;
                    border-radius: 2px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 24px;   /* Fixed height */
                }
                /* Text buttons override */
                #btn-compact, #btn-toggle-view {
                     width: auto;
                     padding: 5px 10px;
                     display: inline-block; /* revert flex center for text? or keep flex but auto width */
                }

                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                input[type="number"]:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }

                /* Rich UI Depth Control */
                .depth-control {
                    display: inline-flex;
                    align-items: center;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px; /* Rounded corners */
                    overflow: hidden; /* For child button borders */
                    margin-right: 10px;
                }

                .depth-btn {
                    background: transparent;
                    border: none;
                    color: var(--vscode-input-foreground);
                    width: 28px;
                    height: 24px;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 16px; /* Larger symbol */
                    font-weight: bold;
                    border-radius: 0;
                }

                .depth-btn:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }

                .depth-btn:active {
                   background-color: var(--vscode-list-activeSelectionBackground);
                   color: var(--vscode-list-activeSelectionForeground);
                }

                .depth-label {
                    padding: 0 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    user-select: none;
                    min-width: 50px; /* Fixed width for stability */
                    text-align: center;
                    border-left: 1px solid var(--vscode-widget-border);
                    border-right: 1px solid var(--vscode-widget-border);
                    height: 24px;
                    line-height: 24px;
                    background-color: var(--vscode-editor-background); /* Slight contrast if desired, or transparent */
                }

                /* Text Label Buttons */

                .tree-root {
                    user-select: text; /* Allow selection */
                    padding-top: 4px;
                }

                .text-block.compact-wrap {
                    white-space: pre-wrap;
                    word-break: break-all;
                }

                .tree-row {
                    display: flex;
                    align-items: center;
                    padding: var(--tree-item-padding);
                    cursor: pointer;
                    border: 1px solid transparent;
                    white-space: pre-wrap; /* Allow wrapping if needed, but usually single line */
                    font-family: var(--vscode-editor-font-family);
                }

                .tree-row:hover {
                    background-color: var(--row-hover-bg);
                }

                .tree-row.focused {
                    background-color: var(--row-focus-bg);
                    color: var(--row-focus-fg);
                    outline: none;
                }

                .arrow {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    line-height: 20px;
                    text-align: center;
                    margin-right: 2px;
                    font-size: 14px;
                    transition: transform 0.1s;
                    flex-shrink: 0;
                }

                .arrow::before {
                    content: '▶';
                    display: inline-block;
                    font-size: 12px;
                }

                .expanded > .tree-row > .arrow::before {
                    transform: rotate(90deg);
                }


                .leaf-spacer {
                    width: 20px;
                    display: inline-block;
                    flex-shrink: 0;
                }

                .key {
                    font-weight: bold;
                    color: var(--key-color);
                    margin-right: 6px;
                }
                .focused .key { color: inherit; }

                /* Separator removed as requested, but we still need structure */
                .separator {
                    display: none;
                }

                .value { font-family: var(--vscode-editor-font-family); }
                .value.string { color: var(--string-color); }
                .value.number { color: var(--number-color); }
                .value.boolean { color: var(--boolean-color); }
                .value.null { color: var(--null-color); }

                .focused .value { color: inherit; }

                .meta {
                    opacity: 0.6;
                    font-size: 0.9em;
                    margin-left: 5px;
                }

                .children { display: none; }
                .expanded > .children { display: block; }

                /* Search Highlights */
                .highlight {
                    background-color: var(--highlight-bg);
                    color: var(--highlight-fg);
                    font-weight: bold;
                    border-radius: 2px;
                }
                .current-match {
                    background-color: var(--current-match-bg) !important;
                    color: var(--current-match-fg) !important;
                    outline: 1px solid #fff;
                }

                .text-root {
                    display: none;
                    padding-top: 4px;
                }

                .text-block {
                    white-space: pre-wrap;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px; /* Slightly smaller for code */
                    line-height: 1.5;
                    margin-bottom: 30px;
                    tab-size: 2;
                }

            </style>
        </head>
        <body>
            <div class="top-toolbar">
                <div class="depth-control">
                    <button id="btn-collapse" class="depth-btn" title="Decrease Depth">-</button>
                    <span id="depth-display" class="depth-label">Depth ${expansionDepth}</span>
                    <button id="btn-expand" class="depth-btn" title="Increase Depth">+</button>
                </div>
                <button id="btn-compact" style="display: none;">Compact</button>
                <button id="btn-toggle-view">Beautifier</button>
                <button id="btn-reveal">Go to Definition</button>
            </div>

            <div id="tree-container" class="tree-root" tabindex="0"></div>
            <div id="text-container" class="text-root" tabindex="0"></div>

            <div class="bottom-toolbar">
                <div class="search-wrapper">
                    <input type="text" id="search-input" placeholder="Search...">
                    <span id="search-count" class="count-overlay"></span>
                </div>
                <div class="search-actions">
                    <button id="btn-prev" disabled>Prev</button>
                    <button id="btn-next" disabled>Next</button>
                </div>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const searchInput = document.getElementById('search-input');
                const btnPrev = document.getElementById('btn-prev');
                const btnNext = document.getElementById('btn-next');
                const countLabel = document.getElementById('search-count');
                const btnToggleView = document.getElementById('btn-toggle-view');
                const btnCompact = document.getElementById('btn-compact');
                const btnReveal = document.getElementById('btn-reveal');
                const treeContainer = document.getElementById('tree-container');
                const textContainer = document.getElementById('text-container');
                const btnExpand = document.getElementById('btn-expand');
                const btnCollapse = document.getElementById('btn-collapse');
                const depthDisplay = document.getElementById('depth-display');

                let rootData = ${initialData};
                let currentStatus = '${status}';
                let tabSize = ${tabSize};
                let sourceUri = '${sourceUri || ''}';
                let sourceLine = ${sourceLine ?? -1};
                let currentDepth = ${expansionDepth};

                let focusedRowDetails = null;
                let isCompact = false;
                let isTreeView = true;

                // Search State
                let searchMatches = [];
                let currentMatchIndex = -1;

                function getItems() {
                    let items = [];
                    if (Array.isArray(rootData) && (rootData.length === 0 || rootData[0].data)) {
                        items = rootData;
                    } else if (rootData) {
                        items = [{ data: rootData, status: currentStatus }];
                    }
                    return items;
                }

                function render() {
                    treeContainer.innerHTML = '';

                    const items = getItems();
                    if (items.length === 0) return;

                    // Render Tree
                    items.forEach((item, index) => {
                        renderMultiRootItem(treeContainer, item.data, item.status, index + 1);
                    });

                    // Render Text
                    renderTextContainer();
                }

                function renderTextContainer() {
                    textContainer.innerHTML = '';
                    const items = getItems();
                    if (items.length === 0) return;

                    items.forEach((item, index) => {
                         renderTextItem(textContainer, item.data, item.text, item.status, index + 1, item.raw);
                    });
                }

                function renderTextItem(parent, data, text, status, index, rawData) {
                    const wrapper = document.createElement('div');
                    wrapper.style.marginBottom = '30px';
                    wrapper.dataset.originalText = text;
                    // Store raw JSON if valid, to allow re-beautifying
                    wrapper.dataset.jsonData = (status === 'valid' && rawData) ? JSON.stringify(rawData) : '';

                    const header = document.createElement('div');
                    header.style.marginBottom = '4px';

                    const badge = document.createElement('span');
                    badge.className = 'status-badge ' + (status === 'valid' ? 'status-valid' : 'status-invalid');
                    badge.textContent = status === 'valid' ? 'Valid JSON' : (status === 'no-json' ? 'No JSON' : 'Invalid JSON');
                    header.appendChild(badge);
                    wrapper.appendChild(header);

                    const pre = document.createElement('div');
                    pre.className = 'text-block';

                    if (status === 'valid' && rawData) {
                         // Use rawData for correct structure
                         if (isCompact) {
                             pre.textContent = JSON.stringify(rawData);
                             pre.classList.add('compact-wrap');
                         } else {
                             pre.textContent = JSON.stringify(rawData, null, tabSize);
                         }
                    } else {
                         // Fallback to text (which is beautified string from service, or best effort)
                         if (isCompact && data) {
                             // Try to compact invalid JSON if parsed data exists (lenient parse)
                             try {
                                 pre.textContent = JSON.stringify(data);
                                 pre.classList.add('compact-wrap');
                             } catch (e) {
                                 pre.textContent = text;
                             }
                         } else {
                             pre.textContent = text;
                         }
                    }
                    wrapper.appendChild(pre);

                    parent.appendChild(wrapper);
                }

                function renderRootContent(container, data) {
                    if (data.type === 'object' && Array.isArray(data.children)) {
                        if (data.children.length === 0) {
                            const empty = document.createElement('div');
                            empty.className = 'tree-row';
                            empty.style.color = 'var(--vscode-descriptionForeground)'; // Muted color
                            empty.style.fontStyle = 'italic';
                            empty.textContent = '{}';
                            container.appendChild(empty);
                        } else {
                            // Render top-level properties directly
                            for (const child of data.children) {
                                renderNode(container, child.key, child.value, 0, false, child.isKeyError);
                            }
                        }
                    } else if (data.type === 'array' && Array.isArray(data.items) && data.items.length === 0) {
                         // Empty array root case (if handled here)
                         const empty = document.createElement('div');
                         empty.className = 'tree-row';
                         empty.style.color = 'var(--vscode-descriptionForeground)';
                         empty.style.fontStyle = 'italic';
                         empty.textContent = '[]';
                         container.appendChild(empty);
                    } else {
                         renderNode(container, 'Value', data, 0, false);
                    }
                }

                function toggleView() {
                    if (isTreeView) {
                        // Switching from Tree -> Text. User wants "Beautifier" explicitly.
                        // Force isCompact = false.
                        isCompact = false;
                        renderTextContainer(); // Re-render text with new state
                    }
                    isTreeView = !isTreeView;
                    updateView();
                }

                function updateView() {
                     if (isTreeView) {
                        treeContainer.style.display = 'block';
                        textContainer.style.display = 'none';

                        const depthControl = document.querySelector('.depth-control');

                        // Toolbar State: Tree View
                        // Order: Expand, Collapse, Beautifier, Go to Definition
                        if (depthControl) depthControl.style.display = 'inline-flex';

                        btnCompact.style.display = 'none';

                        btnToggleView.textContent = 'Beautifier';
                        btnToggleView.style.display = 'inline-flex';

                        btnReveal.textContent = 'Go to Definition';
                        btnReveal.style.display = 'inline-flex';
                        updateRecallButton(); // Will hide if no source

                        document.querySelector('.bottom-toolbar').style.display = 'flex';
                    } else {
                        const depthControl = document.querySelector('.depth-control');

                        // Toolbar State: Text View
                         // If switching to Text View, ensure label is correct.
                         // isCompact state is preserved.
                         btnCompact.textContent = isCompact ? 'Beautifier' : 'Compact';
                         btnCompact.style.display = 'inline-flex';

                        treeContainer.style.display = 'none';
                        textContainer.style.display = 'block';

                        // Order: Compact (above), Preview, Go to Definition
                        btnToggleView.textContent = 'Preview';

                        if (depthControl) depthControl.style.display = 'none';

                        // Show Reveal (Go to Definition) in Text View as well
                        if (sourceUri && sourceLine >= 0) {
                             btnReveal.textContent = 'Go to Definition';
                             btnReveal.style.display = 'inline-flex';
                        } else {
                             btnReveal.style.display = 'none';
                        }

                        document.querySelector('.bottom-toolbar').style.display = 'none';
                    }
                }

                function toggleCompact() {
                    isCompact = !isCompact;
                    renderTextContainer();

                    if (isCompact) {
                        btnCompact.textContent = 'Beautifier';
                    } else {
                        btnCompact.textContent = 'Compact';
                    }
                }

                btnToggleView.addEventListener('click', toggleView);
                btnCompact.addEventListener('click', toggleCompact);

                function renderMultiRootItem(parent, data, status, index) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'tree-node';
                    // Root expanded only if depth >= 1
                    if (currentDepth >= 1) {
                         wrapper.classList.add('expanded');
                    }
                    wrapper.style.marginBottom = '30px'; // Increased spacing
                    wrapper.style.borderLeft = 'none'; // Remove border

                    const header = document.createElement('div');
                    header.style.padding = '4px 0'; // Minimal padding
                    header.style.marginBottom = '4px';

                    // Status Badge for this item (No index, no arrow)
                    const badge = document.createElement('span');
                    badge.className = 'status-badge ' + (status === 'valid' ? 'status-valid' : 'status-invalid');
                    badge.textContent = status === 'valid' ? 'Valid JSON' : (status === 'no-json' ? 'No JSON' : 'Invalid JSON');
                    badge.style.marginRight = '0'; // Reset margin
                    header.appendChild(badge);

                    wrapper.appendChild(header);

                    if (status !== 'no-json') {
                        const content = document.createElement('div');
                        content.className = 'children';
                        content.style.display = 'block';

                        // Root content is effectively at depth 0 relative to itself, but children start at 1
                        renderRootContent(content, data);
                        wrapper.appendChild(content);
                    }

                    parent.appendChild(wrapper);
                }


                function renderNode(parent, key, nodeData, depth, isRoot, isKeyError) {
                    const type = nodeData.type;
                    const value = nodeData.value;
                    const isObject = type === 'object';
                    const isArray = type === 'array';
                    const hasChildren = isObject || isArray;
                    const isError = nodeData.isError;

                    const node = document.createElement('div');
                    node.className = 'tree-node';

                    // Expand node if its depth is less than the current visible depth
                    if (depth < currentDepth) {
                        node.classList.add('expanded');
                    }

                    const row = document.createElement('div');
                    row.className = 'tree-row';
                    row.tabIndex = -1;
                    row.dataset.key = key;
                    row.style.paddingLeft = (depth * 20) + 'px';

                    if (hasChildren) {
                        const arrow = document.createElement('span');
                        arrow.className = 'arrow';
                        row.appendChild(arrow);
                        row.onclick = (e) => {
                            e.stopPropagation();
                            toggleExpand(node);
                        };
                    } else {
                        const spacer = document.createElement('span');
                        spacer.className = 'leaf-spacer';
                        row.appendChild(spacer);
                        row.onclick = (e) => {
                             e.stopPropagation();
                             focusRow(row);
                        }
                    }

                    const keySpan = document.createElement('span');
                    keySpan.className = 'key';
                    if (isKeyError) keySpan.classList.add('error');

                    // Add brackets if array index
                    if (/^\\d+$/.test(key)) {
                            keySpan.textContent = '[' + key + ']';
                    } else {
                            keySpan.textContent = key;
                    }

                    row.appendChild(keySpan);

                    // Separator removed visually (display:none in CSS)
                    const sep = document.createElement('span');
                    sep.className = 'separator';
                    sep.textContent = ':';
                    row.appendChild(sep);

                    if (!hasChildren) {
                        const valSpan = document.createElement('span');

                        valSpan.className = 'value ' + type;
                        if (isError) valSpan.classList.add('error');

                        if (type === 'string') {
                            valSpan.textContent = '"' + value + '"';
                        } else {
                            valSpan.textContent = String(value);
                        }

                        row.appendChild(valSpan);
                    } else {
                        if (isArray) {
                            const meta = document.createElement('span');
                            meta.className = 'meta';
                            if (nodeData.items) {
                                meta.textContent = \`Array(\${nodeData.items.length})\`;
                            } else {
                                meta.textContent = 'Array(0)';
                            }
                            row.appendChild(meta);
                        } else if (isObject) {
                             // Object meta? Usually just {}
                        }

                        if (isError) {
                             const errSpan = document.createElement('span');
                             errSpan.className = 'meta error';
                             errSpan.textContent = '(Incomplete)';
                             row.appendChild(errSpan);
                        }
                    }

                    node.appendChild(row);

                    if (hasChildren) {
                        const childrenContainer = document.createElement('div');
                        childrenContainer.className = 'children';

                        if (isObject && nodeData.children) {
                            for (const child of nodeData.children) {
                                renderNode(childrenContainer, child.key, child.value, depth + 1, false, child.isKeyError);
                            }
                        } else if (isArray && nodeData.items) {
                            nodeData.items.forEach((item, idx) => {
                                renderNode(childrenContainer, String(idx), item, depth + 1, false, false);
                            });
                        }

                        node.appendChild(childrenContainer);
                    }

                    parent.appendChild(node);
                }

                function toggleExpand(node) {
                    node.classList.toggle('expanded');
                    focusRow(node.querySelector('.tree-row'));
                }

                function expand() {
                    currentDepth++;
                    updateExpansion();
                    saveState();
                }

                function collapse() {
                    if (currentDepth > 0) {
                        currentDepth--;
                        updateExpansion();
                        saveState();
                    }
                }

                function saveState() {
                    vscode.postMessage({ command: 'saveState', expansionDepth: currentDepth });
                }

                function updateExpansion() {
                    // Re-render to apply new depth
                    render();
                    if (depthDisplay) {
                        depthDisplay.textContent = 'Depth ' + currentDepth;
                    }
                }

                function focusRow(row) {
                    if (focusedRowDetails) focusedRowDetails.classList.remove('focused');
                    focusedRowDetails = row;
                    row.classList.add('focused');
                    row.scrollIntoView({ block: 'nearest' });
                }

                // --- Search Logic ---
                function performSearch() {
                    const query = searchInput.value.toLowerCase();
                    clearHighlights();
                    searchMatches = [];
                    currentMatchIndex = -1;

                    if (!query) {
                        updateSearchUI();
                        return;
                    }

                    const nodes = document.querySelectorAll('.key, .value');
                    nodes.forEach(node => {
                        const text = node.textContent;
                        if (text.toLowerCase().includes(query)) {
                            highlightNode(node, query);
                        }
                    });

                    updateSearchUI();
                    if (searchMatches.length > 0) {
                        // User requested NOT to auto-expand just on type.
                    }
                }

                function clearHighlights() {
                    const highlights = document.querySelectorAll('.highlight, .current-match');
                    highlights.forEach(span => {
                        const parent = span.parentNode;
                        if (parent) {
                            parent.textContent = parent.textContent; // Crude plain text restore
                        }
                    });
                }

                function highlightNode(domNode, query) {
                    const text = domNode.textContent;
                    const lowerText = text.toLowerCase();
                    let lastIndex = 0;

                    // Allow multiple matches in same string
                    const fragments = [];
                    let matchIndex = lowerText.indexOf(query, lastIndex);

                    if (matchIndex === -1) return;

                    // We need to rebuild innerHTML
                    domNode.innerHTML = '';

                    while (matchIndex !== -1) {
                         const before = text.substring(lastIndex, matchIndex);
                         const match = text.substring(matchIndex, matchIndex + query.length);

                         domNode.appendChild(document.createTextNode(before));

                         const span = document.createElement('span');
                         span.className = 'highlight';
                         span.textContent = match;
                         domNode.appendChild(span);
                         searchMatches.push(span);

                         lastIndex = matchIndex + query.length;
                         matchIndex = lowerText.indexOf(query, lastIndex);
                    }

                    const after = text.substring(lastIndex);
                    domNode.appendChild(document.createTextNode(after));
                }

                function jumpToMatch(index) {
                    if (index < 0 || index >= searchMatches.length) return;

                    if (currentMatchIndex >= 0 && searchMatches[currentMatchIndex]) {
                        searchMatches[currentMatchIndex].classList.remove('current-match');
                    }

                    currentMatchIndex = index;
                    const match = searchMatches[currentMatchIndex];
                    match.classList.add('current-match');

                    // Ensure visibility only when navigating
                    ensureVisible(match);

                    // Delay scroll to allow layout update (expansion)
                    setTimeout(() => {
                        match.scrollIntoView({ block: 'center', behavior: 'auto' });
                    }, 50);

                    const row = match.closest('.tree-row');
                    if (row) focusRow(row);

                    updateSearchUI();
                }

                function ensureVisible(element) {
                    let parent = element.closest('.tree-node');
                    while (parent) {
                        parent.classList.add('expanded');
                        parent = parent.parentNode.closest('.tree-node');
                    }
                }

                function updateSearchUI() {
                    if (searchMatches.length === 0) {
                         countLabel.textContent = '(0)';
                         btnPrev.disabled = true;
                         btnNext.disabled = true;
                    } else {
                         // "Display matched count" in parentheses
                         if (currentMatchIndex === -1) {
                             countLabel.textContent = \`(?/\${searchMatches.length})\`;
                         } else {
                             countLabel.textContent = \`(\${currentMatchIndex + 1}/\${searchMatches.length})\`;
                         }
                         btnPrev.disabled = false;
                         btnNext.disabled = false;
                    }
                    if (searchInput.value === '') {
                        countLabel.textContent = '';
                        btnPrev.disabled = true;
                        btnNext.disabled = true;
                    }
                }

                searchInput.addEventListener('input', () => performSearch());
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        if (searchMatches.length === 0) return;
                        // Jump to next match (or first if none selected)
                        let nextIndex = currentMatchIndex + 1;
                        if (e.shiftKey) nextIndex = currentMatchIndex - 1;

                        // Wrap
                        if (nextIndex >= searchMatches.length) nextIndex = 0;
                        if (nextIndex < 0) nextIndex = searchMatches.length - 1;

                        jumpToMatch(nextIndex);
                    }
                });

                btnPrev.addEventListener('click', () => {
                    let nextIndex = currentMatchIndex - 1;
                    if (nextIndex < 0) nextIndex = searchMatches.length - 1;
                    jumpToMatch(nextIndex);
                });

                btnNext.addEventListener('click', () => {
                     let nextIndex = currentMatchIndex + 1;
                     if (nextIndex >= searchMatches.length) nextIndex = 0;
                     jumpToMatch(nextIndex);
                });

                document.addEventListener('keydown', (e) => {
                    if (document.activeElement === searchInput) return;

                    if (!focusedRowDetails) {
                        const first = document.querySelector('.tree-row');
                        if (first) focusRow(first);
                        return;
                    }

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = getNextVisibleRow(focusedRowDetails);
                        if (next) focusRow(next);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = getPrevVisibleRow(focusedRowDetails);
                        if (prev) focusRow(prev);
                    } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        const node = focusedRowDetails.parentNode;
                         if (node.classList.contains('tree-node') && node.querySelector('.children')) {
                            if (!node.classList.contains('expanded')) {
                                node.classList.add('expanded');
                            } else {
                                const next = getNextVisibleRow(focusedRowDetails);
                                if (next) focusRow(next);
                            }
                        }
                    } else if (e.key === 'ArrowLeft') {
                         e.preventDefault();
                        const node = focusedRowDetails.parentNode;
                        if (node.classList.contains('tree-node') && node.querySelector('.children')) {
                            if (node.classList.contains('expanded')) {
                                node.classList.remove('expanded');
                            } else {
                                const parentNode = node.parentNode.closest('.tree-node');
                                if (parentNode) focusRow(parentNode.querySelector('.tree-row'));
                            }
                        }
                    } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                        e.preventDefault();
                        searchInput.focus();
                    }
                });

                function getNextVisibleRow(currentRow) {
                     const allRows = Array.from(document.querySelectorAll('.tree-row'));
                     let idx = allRows.indexOf(currentRow);
                     for (let i = idx + 1; i < allRows.length; i++) {
                         if (isVisible(allRows[i])) return allRows[i];
                     }
                     return null;
                }

                function getPrevVisibleRow(currentRow) {
                     const allRows = Array.from(document.querySelectorAll('.tree-row'));
                     let idx = allRows.indexOf(currentRow);
                     for (let i = idx - 1; i >= 0; i--) {
                         if (isVisible(allRows[i])) return allRows[i];
                     }
                     return null;
                }

                function isVisible(el) {
                    return el.offsetParent !== null;
                }

                const btnCollapseEl = document.getElementById('btn-collapse');
                if (btnCollapseEl) btnCollapseEl.addEventListener('click', collapse);

                const btnExpandEl = document.getElementById('btn-expand');
                if (btnExpandEl) btnExpandEl.addEventListener('click', expand);

                function updateRecallButton() {
                    // Only applicable if in Tree View
                    if (!isTreeView) return;

                    if (sourceUri && sourceLine >= 0) {
                        btnReveal.style.display = 'inline-flex';
                    } else {
                        btnReveal.style.display = 'none';
                    }
                }

                btnReveal.addEventListener('click', () => {
                   if (sourceUri && sourceLine >= 0) {
                       vscode.postMessage({ command: 'reveal', uri: sourceUri, line: sourceLine });
                   }
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'update') {
                        rootData = message.data;
                        if (message.status) currentStatus = message.status;
                        if (message.tabSize) tabSize = message.tabSize;
                        if (message.sourceUri) sourceUri = message.sourceUri;
                        if (typeof message.sourceLine === 'number') sourceLine = message.sourceLine;
                        if (typeof message.expansionDepth === 'number') {
                             currentDepth = message.expansionDepth;
                             if (depthDisplay) depthDisplay.textContent = 'Depth ' + currentDepth;
                        }

                        // Reset search on update
                        if (searchInput) {
                            searchInput.value = '';
                            performSearch();
                        }

                        // Always switch to Tree View on new content
                        isTreeView = true;
                        updateView();

                        render();
                        updateRecallButton();
                    }
                });

                render();
                updateRecallButton();
                // Initial View State
                updateView();
            </script>
        </body>
        </html>`;
    }
}

