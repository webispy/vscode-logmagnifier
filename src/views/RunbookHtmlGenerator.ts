import * as vscode from 'vscode';
import { RunbookMarkdown } from '../models/Runbook';
import { Logger } from '../services/Logger';
import * as marked from 'marked';
import * as fs from 'fs';
import * as path from 'path';
import { getNonce, escapeHtml } from '../utils/WebviewUtils';
import sanitizeHtmlLib from 'sanitize-html';

export class RunbookHtmlGenerator {
    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * Sanitize HTML output from marked to prevent XSS.
     * Uses the well-tested `sanitize-html` library to strip <script> tags,
     * on* event handler attributes, and other unsafe constructs that could be
     * injected via malicious markdown content.
     */
    private sanitizeHtml(html: string): string {
        // Rely on sanitize-html defaults, which already remove script tags,
        // event handler attributes (on*), and other potentially dangerous markup.
        return sanitizeHtmlLib(html);
    }

    public async generate(webview: vscode.Webview, item: RunbookMarkdown): Promise<string> {
        let content = '';
        try {
            content = fs.readFileSync(item.filePath, 'utf-8');
        } catch (e) {
            Logger.getInstance().error(`Failed to read markdown file: ${e}`);
            content = `# Error\nCould not read file: ${item.filePath}`;
        }

        // Collect scripts for injection via nonce'd script block (not inline handlers)
        const scriptMap: Map<string, string> = new Map();

        // Custom Renderer to inject Play buttons into `sh` blocks
        const renderer = new marked.Renderer();
        let blockIndex = 0;

        renderer.code = (code: string | { text: string, lang?: string }, language: string | undefined, _isEscaped: boolean) => {
            const text = typeof code === 'string' ? code : code.text;
            const lang = typeof code === 'string' ? language : code.lang;
            if (lang === 'sh' || lang === 'bash' || lang === 'shell') {
                const currentBlockId = `block_${blockIndex++}`;
                // Store script for event delegation (avoids inline onclick)
                scriptMap.set(currentBlockId, text);

                return `
                <div class="code-block-container" id="${currentBlockId}">
                    <div class="code-block-header">
                        <span class="lang-label">sh</span>
                        <button class="play-btn" id="btn_${currentBlockId}" data-block-id="${currentBlockId}">
                            <span class="codicon codicon-play"></span> Play
                        </button>
                    </div>
                    <pre><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>
                    <div class="output-container" id="output_${currentBlockId}" style="display: none;">
                        <pre><code></code></pre>
                    </div>
                </div>
                `;
            }
            return `<pre><code>${escapeHtml(text)}</code></pre>`;
        };

        const markedOptions = {
            renderer: renderer
        };

        const rawHtmlContent = await marked.parse(content, markedOptions);
        const htmlContent = this.sanitizeHtml(rawHtmlContent);

        // Build JSON script map for the template
        const scriptMapJson = JSON.stringify(Object.fromEntries(scriptMap));

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
        html = html.replace(/{{ SCRIPT_MAP }}/g, scriptMapJson);

        return html;
    }
}
