import * as vscode from 'vscode';

export class JsonTreeWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private readonly extensionUri: vscode.Uri) { }

    public show(data: any, title: string = 'JSON Preview', status: 'valid' | 'invalid' = 'valid') {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.panel.webview.postMessage({ command: 'update', data, status });
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'logmagnifier-json-tree',
                title,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Initial data
            this.panel.webview.html = this.getHtmlForWebview(data, status);
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

    private getHtmlForWebview(data: any, status: 'valid' | 'invalid'): string {
        const initialData = JSON.stringify(data);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
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
                body {
                    font-family: var(--vscode-editor-font-family); /* Use editor font for everything */
                    font-size: 14px; /* Larger text */
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 10px;
                    margin: 0;
                    overflow-x: hidden;
                }
                .toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
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
                }
                input[type="text"] {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 6px;
                    border-radius: 2px;
                    font-size: 13px;
                    width: 200px;
                }
                input[type="text"]:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                .count-label {
                    font-size: 0.9em;
                    margin-left: 4px;
                    min-width: 60px;
                }
                button {
                    background: none;
                    border: 1px solid transparent;
                    color: var(--vscode-button-foreground);
                    background-color: var(--vscode-button-background);
                    padding: 5px 10px;
                    cursor: pointer;
                    border-radius: 2px;
                    font-size: 13px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .tree-root {
                    user-select: text; /* Allow selection */
                    padding-top: 4px;
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

            </style>
        </head>
        <body>
            <div class="toolbar">
                <div class="search-box">
                    <input type="text" id="search-input" placeholder="Search...">
                    <button id="btn-prev" title="Previous Match" disabled>↑</button>
                    <button id="btn-next" title="Next Match" disabled>↓</button>
                    <span id="search-count" class="count-label"></span>
                </div>
                <button id="btn-collapse-all">Collapse All</button>
            </div>
            <div id="tree-container" class="tree-root" tabindex="0"></div>

            <script>
                const vscode = acquireVsCodeApi();
                const container = document.getElementById('tree-container');
                const searchInput = document.getElementById('search-input');
                const btnPrev = document.getElementById('btn-prev');
                const btnNext = document.getElementById('btn-next');
                const countLabel = document.getElementById('search-count');

                let rootData = ${initialData};
                let currentStatus = '${status}';
                let focusedRowDetails = null;
                
                // Search State
                let searchMatches = [];
                let currentMatchIndex = -1;

                function render() {
                    container.innerHTML = '';
                    
                    // Normalize data to array
                    let items = [];
                    if (Array.isArray(rootData) && (rootData.length === 0 || rootData[0].data)) {
                        items = rootData;
                    } else if (rootData) {
                        items = [{ data: rootData, status: currentStatus }];
                    }

                    if (items.length === 0) {
                         // No data
                         return;
                    }

                    // Unified Rendering: Always use stacked layout
                    items.forEach((item, index) => {
                        renderMultiRootItem(container, item.data, item.status, index + 1);
                    });
                }

                function renderRootContent(container, data) {
                    if (data.type === 'object' && Array.isArray(data.children)) {
                        // Render top-level properties directly
                        for (const child of data.children) {
                            renderNode(container, child.key, child.value, 0, false, child.isKeyError);
                        }
                    } else {
                         renderNode(container, 'Value', data, 0, false);
                    }
                }

                function renderMultiRootItem(parent, data, status, index) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'tree-node expanded'; // Default expanded
                    wrapper.style.marginBottom = '30px'; // Increased spacing
                    wrapper.style.borderLeft = 'none'; // Remove border
                    
                    const header = document.createElement('div');
                    header.style.padding = '4px 0'; // Minimal padding
                    header.style.marginBottom = '4px';
                    
                    // Status Badge for this item (No index, no arrow)
                    const badge = document.createElement('span');
                    badge.className = 'status-badge ' + (status === 'valid' ? 'status-valid' : 'status-invalid');
                    badge.textContent = status === 'valid' ? 'Valid JSON' : 'Invalid JSON';
                    badge.style.marginRight = '0'; // Reset margin
                    header.appendChild(badge);
                    
                    wrapper.appendChild(header);
                    
                    const content = document.createElement('div');
                    content.className = 'children';
                    content.style.display = 'block'; 
                    
                    renderRootContent(content, data);
                    wrapper.appendChild(content);
                    
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
                    if (isRoot) node.classList.add('expanded');

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
                
                function collapseAll() {
                    const expanded = document.querySelectorAll('.tree-node.expanded');
                    // Collapse everything
                    expanded.forEach(node => {
                        node.classList.remove('expanded');
                    });
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

                    match.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    
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
                         countLabel.textContent = '0';
                         btnPrev.disabled = true;
                         btnNext.disabled = true;
                    } else {
                         // "Display matched count"
                         if (currentMatchIndex === -1) {
                             countLabel.textContent = \`\${searchMatches.length} matches\`;
                         } else {
                             countLabel.textContent = \`\${currentMatchIndex + 1} / \${searchMatches.length}\`;
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

                document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'update') {
                        rootData = message.data;
                        if (message.status) currentStatus = message.status;
                        render();
                    }
                });

                render();
            </script>
        </body>
        </html>`;
    }
}
