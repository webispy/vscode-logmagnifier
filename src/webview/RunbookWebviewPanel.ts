import * as vscode from 'vscode';
import { RunbookMarkdown } from '../models/Runbook';
import { Logger } from '../services/Logger';
import * as marked from 'marked';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';

export class RunbookWebviewPanel {
    public static currentPanel: RunbookWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentItem: RunbookMarkdown;

    public static async createOrShow(context: vscode.ExtensionContext, item: RunbookMarkdown) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (RunbookWebviewPanel.currentPanel) {
            RunbookWebviewPanel.currentPanel._panel.reveal(column);
            await RunbookWebviewPanel.currentPanel.update(item);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'runbookWebview',
            `Shell: ${item.label}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources'))]
            }
        );

        RunbookWebviewPanel.currentPanel = new RunbookWebviewPanel(panel, context, item);
    }

    private constructor(panel: vscode.WebviewPanel, private context: vscode.ExtensionContext, item: RunbookMarkdown) {
        this._panel = panel;
        this._currentItem = item;

        this.update(item);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'execute':
                        this.executeScript(message.script, message.blockId);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public async update(item: RunbookMarkdown) {
        this._currentItem = item;
        this._panel.title = `Shell: ${item.label}`;
        this._panel.webview.html = await this._getHtmlForWebview(item);
    }

    public dispose() {
        RunbookWebviewPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private executeScript(script: string, blockId: string) {
        this._panel.webview.postMessage({ command: 'command-running', blockId });

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

        const child = cp.exec(script, { cwd });

        child.stdout?.on('data', (data) => {
            this._panel.webview.postMessage({
                command: 'command-output',
                blockId,
                stdout: data.toString()
            });
        });

        child.stderr?.on('data', (data) => {
            this._panel.webview.postMessage({
                command: 'command-output',
                blockId,
                stderr: data.toString()
            });
        });

        child.on('error', (error) => {
            this._panel.webview.postMessage({
                command: 'command-output',
                blockId,
                error: error.message
            });
        });

        child.on('close', (code) => {
            this._panel.webview.postMessage({
                command: 'command-finished',
                blockId,
                code
            });
        });
    }

    private async _getHtmlForWebview(item: RunbookMarkdown): Promise<string> {
        let content = '';
        try {
            content = fs.readFileSync(item.filePath, 'utf-8');
        } catch (e) {
            Logger.getInstance().error(`Failed to read markdown file: ${e}`);
            content = `# Error\nCould not read file: ${item.filePath}`;
        }

        // Custom Renderer to inject Play buttons into `sh` blocks
        const renderer = new marked.Renderer();
        let blockIndex = 0;

        renderer.code = (code: string | { text: string, lang?: string }, language: string | undefined, _isEscaped: boolean) => {
            const text = typeof code === 'string' ? code : code.text;
            const lang = typeof code === 'string' ? language : code.lang;
            if (lang === 'sh' || lang === 'bash' || lang === 'shell') {
                const currentBlockId = `block_${blockIndex++}`;
                // Keep the script intact for execution
                const escapedScript = text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

                return `
                <div class="code-block-container" id="${currentBlockId}">
                    <div class="code-block-header">
                        <span class="lang-label">sh</span>
                        <vscode-button appearance="secondary" class="play-btn" id="btn_${currentBlockId}" onclick="executeBlock('${currentBlockId}', \`${escapedScript}\`)">
                            <span class="codicon codicon-play"></span> Play
                        </vscode-button>
                    </div>
                    <pre><code class="language-${lang}">${text}</code></pre>
                    <div class="output-container" id="output_${currentBlockId}" style="display: none;">
                        <pre><code></code></pre>
                    </div>
                </div>
                `;
            }
            return `<pre><code>${text}</code></pre>`;
        };

        const markedOptions = {
            renderer: renderer
        };

        const htmlContent = await marked.parse(content, markedOptions);

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${item.label}</title>
                <link href="${this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'))}" rel="stylesheet" />
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .code-block-container {
                        background-color: var(--vscode-textCodeBlock-background);
                        border-radius: 6px;
                        margin: 16px 0;
                        overflow: hidden;
                        border: 1px solid var(--vscode-editorGroup-border);
                    }
                    .code-block-header {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 12px;
                        background-color: var(--vscode-editorGroupHeader-tabsBackground);
                        border-bottom: 1px solid var(--vscode-editorGroup-border);
                    }
                    .play-btn {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        padding: 4px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-family: inherit;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 12px;
                    }
                    .play-btn:hover:not(:disabled) {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    .play-btn:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                    }
                    .spin {
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        100% { transform: rotate(360deg); }
                    }
                    pre {
                        margin: 0;
                        padding: 16px;
                        overflow-x: auto;
                    }
                    code {
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                    }
                    pre code {
                        background-color: transparent !important;
                        padding: 0 !important;
                        color: inherit !important;
                    }
                    .output-container {
                        background-color: var(--vscode-editor-background);
                        border-top: 1px solid var(--vscode-editorGroup-border);
                        padding: 16px;
                        color: var(--vscode-editor-foreground);
                    }
                    .output-container pre {
                        padding: 0;
                        margin: 0;
                        white-space: pre-wrap;
                        word-break: break-all;
                    }
                </style>
            </head>
            <body>
                ${htmlContent}
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function executeBlock(blockId, script) {
                        vscode.postMessage({
                            command: 'execute',
                            blockId: blockId,
                            script: script
                        });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        const outputDiv = document.getElementById('output_' + message.blockId);
                        if (!outputDiv) return;
                        const codeEl = outputDiv.querySelector('code');

                        if (message.command === 'command-running') {
                            outputDiv.style.display = 'block';
                            codeEl.innerHTML = '<i style="color:var(--vscode-descriptionForeground)">Running...\\n</i>';
                            
                            const btn = document.getElementById('btn_' + message.blockId);
                            if (btn) {
                                btn.disabled = true;
                                btn.innerHTML = '<span class="codicon codicon-sync spin"></span> Running...';
                            }
                        } else if (message.command === 'command-output') {
                            let text = '';
                            if (message.stdout) {
                                text += escapeHtml(message.stdout);
                            }
                            if (message.stderr && message.stderr.trim().length > 0) {
                                text += '<span style="color:var(--vscode-errorForeground)">' + escapeHtml(message.stderr) + '</span>';
                            }
                            if (message.error) {
                                text += '<span style="color:var(--vscode-errorForeground)">' + escapeHtml(message.error) + '</span>\\n';
                            }
                            // remove Running indicator if present
                            if (codeEl.innerHTML.includes('Running...\\n</i>')) {
                                codeEl.innerHTML = '';
                            }
                            codeEl.innerHTML += text;
                        } else if (message.command === 'command-finished') {
                            if (message.code !== 0 && message.code !== null) {
                                codeEl.innerHTML += '\\n<i style="color:var(--vscode-errorForeground)">Exited with code ' + message.code + '</i>';
                            }
                            if (!codeEl.innerHTML.trim() || codeEl.innerHTML.includes('Running...\\n</i>')) {
                                codeEl.innerHTML = '<i>(No output)</i>';
                            }

                            const btn = document.getElementById('btn_' + message.blockId);
                            if (btn) {
                                btn.disabled = false;
                                btn.innerHTML = '<span class="codicon codicon-play"></span> Play';
                            }
                        }
                    });

                    function escapeHtml(unsafe) {
                        return unsafe
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;");
                    }
                </script>
            </body>
            </html>`;
    }
}
