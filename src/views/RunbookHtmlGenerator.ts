import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import * as marked from 'marked';
import sanitizeHtmlLib from 'sanitize-html';

import * as vscode from 'vscode';

import { RunbookMarkdown } from '../models/Runbook';

import { Logger } from '../services/Logger';
import { applyWebviewTemplate, escapeHtml } from '../utils/WebviewUtils';

export class RunbookHtmlGenerator {
    constructor(private readonly context: vscode.ExtensionContext, private readonly logger: Logger) { }

    /**
     * Sanitize HTML output from marked to prevent XSS.
     * Uses the well-tested `sanitize-html` library to strip <script> tags,
     * on* event handler attributes, and other unsafe constructs that could be
     * injected via malicious markdown content.
     */
    private sanitizeHtml(html: string): string {
        // Rely on sanitize-html defaults, but whitelist elements and attributes
        // needed by our custom rendering (like 'button', 'class', 'id', 'data-block-id', 'style')
        // and standard markdown features like 'img'.
        return sanitizeHtmlLib(html, {
            allowedTags: sanitizeHtmlLib.defaults.allowedTags.concat(['button', 'img']),
            allowedAttributes: {
                ...sanitizeHtmlLib.defaults.allowedAttributes,
                '*': ['class', 'id', 'data-*', 'style']
            }
        });
    }

    /** Generates the runbook webview HTML by parsing the markdown file and injecting play buttons for shell blocks. */
    public async generate(webview: vscode.Webview, item: RunbookMarkdown): Promise<string> {
        let content = '';
        try {
            content = await fsp.readFile(item.filePath, 'utf-8');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookHtmlGenerator] Failed to read markdown file: ${msg}`);
            content = `# Error\nCould not read file: ${item.filePath}`;
        }

        // Collect scripts for injection via nonce'd script block (not inline handlers)
        const scriptMap: Map<string, string> = new Map();

        const shellLabel = os.platform() === 'win32' ? 'powershell' : 'sh';

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
                        <span class="lang-label">${shellLabel}</span>
                        <div class="header-buttons">
                            <button class="play-btn" id="btn_${currentBlockId}" data-block-id="${currentBlockId}">
                                <span class="codicon codicon-play"></span> Play
                            </button>
                            <button class="edit-btn" id="edit_btn_${currentBlockId}" data-block-id="${currentBlockId}">
                                <span class="codicon codicon-edit"></span> Edit
                            </button>
                        </div>
                    </div>
                    <pre class="code-display"><code class="language-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>
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
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookHtmlGenerator] Failed to read template: ${msg}`);
            return `<html><body><div style="padding: 10px;">Error loading runbook view template</div></body></html>`;
        }

        const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')).toString();

        html = applyWebviewTemplate(html, webview);
        html = html.replace(/{{ TITLE }}/g, escapeHtml(item.label));
        html = html.replace(/{{ CODICON_CSS_URI }}/g, codiconCssUri);
        html = html.replace(/{{ HTML_CONTENT }}/g, htmlContent);
        const safeScriptMapJson = scriptMapJson.replace(/<\//g, '<\\/');
        html = html.replace(/{{ SCRIPT_MAP }}/g, safeScriptMapJson);

        return html;
    }
}
