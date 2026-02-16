import * as vscode from 'vscode';
import * as path from 'path';
import { WorkflowViewModel } from '../services/WorkflowManager';
import { escapeHtml, getNonce } from '../utils/WebviewUtils';

export class WorkflowHtmlGenerator {
    constructor(private readonly context: vscode.ExtensionContext) { }

    public async generate(
        webview: vscode.Webview,
        workflows: WorkflowViewModel[],
        activeId: string | undefined,
        activeStepId: string | undefined
    ): Promise<string> {
        const templatePath = vscode.Uri.file(
            path.join(this.context.extensionPath, 'resources', 'webview', 'workflow-tree-template.html')
        );

        let html = '';
        try {
            const templateBytes = await vscode.workspace.fs.readFile(templatePath);
            html = new TextDecoder('utf-8').decode(templateBytes);
        } catch (err) {
            console.error('Failed to read Workflow Tree template:', err);
            return `<html><body><div style="padding: 10px;">Error loading workflow view template: ${escapeHtml(String(err))}</div></body></html>`;
        }

        // Colors for the graph lines (Git Graph style)
        const graphColors = [
            'var(--vscode-charts-blue)',
            'var(--vscode-charts-red)',
            'var(--vscode-charts-green)',
            'var(--vscode-charts-yellow)',
            'var(--vscode-charts-orange)',
            'var(--vscode-charts-purple)'
        ];

        const nonce = getNonce();
        const safeJson = (val: unknown) => {
            try {
                return JSON.stringify(val).replace(/</g, '\\u003c');
            } catch (e) {
                console.error('JSON Stringify Error:', e);
                return 'null'; // Fallback
            }
        };

        const viewData = {
            workflows: workflows || [],
            activeId: activeId || '',
            activeStepId: activeStepId || '',
            graphColors: graphColors
        };

        // Replace placeholders
        html = html.replace(/{{\s*VIEW_DATA\s*}}/g, safeJson(viewData));
        html = html.replace(/{{\s*CSP_SOURCE\s*}}/g, webview.cspSource);
        html = html.replace(/{{\s*NONCE\s*}}/g, nonce);

        return html;
    }
}
