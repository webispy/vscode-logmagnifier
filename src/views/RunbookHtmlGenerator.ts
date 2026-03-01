import * as vscode from 'vscode';
import { RunbookMarkdown } from '../models/Runbook';
import { Logger } from '../services/Logger';
import * as marked from 'marked';
import * as fs from 'fs';
import * as path from 'path';
import { getNonce } from '../utils/WebviewUtils';

export class RunbookHtmlGenerator {
    constructor(private readonly context: vscode.ExtensionContext) { }

    public async generate(webview: vscode.Webview, item: RunbookMarkdown): Promise<string> {
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

        const templatePath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'resources', 'webview', 'runbook-template.html')
        );

        let html = '';
        try {
            const templateBytes = await vscode.workspace.fs.readFile(templatePath);
            html = new TextDecoder('utf-8').decode(templateBytes);
        } catch (err) {
            Logger.getInstance().error(`Failed to read Runbook template: ${err}`);
            return `<html><body><div style="padding: 10px;">Error loading runbook view template</div></body></html>`;
        }

        const nonce = getNonce();
        const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')).toString();

        html = html.replace(/{{ TITLE }}/g, item.label);
        html = html.replace(/{{ CSP_SOURCE }}/g, webview.cspSource);
        html = html.replace(/{{ NONCE }}/g, nonce);
        html = html.replace(/{{ CODICON_CSS_URI }}/g, codiconCssUri);
        html = html.replace(/{{ HTML_CONTENT }}/g, htmlContent);

        return html;
    }
}
