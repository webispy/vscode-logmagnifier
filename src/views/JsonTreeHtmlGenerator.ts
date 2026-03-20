import * as path from 'path';

import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { applyWebviewTemplate, escapeHtml, safeJson } from '../utils/WebviewUtils';

export class JsonTreeHtmlGenerator {
    constructor(private readonly context: vscode.ExtensionContext) { }

    public async generate(
        webview: vscode.Webview,
        data: unknown,
        status: 'valid' | 'invalid' | 'no-json',
        tabSize: number = 2,
        sourceUri?: string,
        sourceLine?: number,
        expansionDepth: number = 1
    ): Promise<string> {
        const templatePath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'resources', 'webview', 'json-tree-template.html')
        );

        let html = '';
        try {
            const templateBytes = await vscode.workspace.fs.readFile(templatePath);
            html = new TextDecoder('utf-8').decode(templateBytes);
        } catch (err) {
            Logger.getInstance().error(`[JsonTreeHtmlGenerator] Failed to read template: ${err}`);
            return `<html><body>Failed to load template. Error: ${escapeHtml(String(err))}</body></html>`;
        }

        html = applyWebviewTemplate(html, webview);
        html = html.replace(/{{\s*INITIAL_DATA\s*}}/g, safeJson(data));
        html = html.replace(/{{\s*STATUS\s*}}/g, safeJson(status));
        html = html.replace(/{{\s*TAB_SIZE\s*}}/g, String(tabSize));
        html = html.replace(/{{\s*SOURCE_URI\s*}}/g, safeJson(sourceUri ?? ''));
        html = html.replace(/{{\s*SOURCE_LINE\s*}}/g, String(sourceLine ?? -1));
        html = html.replace(/{{\s*EXPANSION_DEPTH\s*}}/g, String(expansionDepth));

        return html;
    }
}
