import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { JsonTreeHtmlGenerator } from './JsonTreeHtmlGenerator';

export class JsonTreeWebview {
    private panel: vscode.WebviewPanel | undefined;
    private readonly htmlGenerator: JsonTreeHtmlGenerator;

    private readonly _onDidRevealLine = new vscode.EventEmitter<{ uri: string, line: number }>();
    public readonly onDidRevealLine = this._onDidRevealLine.event;

    constructor(private readonly context: vscode.ExtensionContext, logger: Logger) {
        this.htmlGenerator = new JsonTreeHtmlGenerator(this.context, logger);
    }

    /**
     * Opens or updates the JSON tree preview panel.
     * @param data The JSON data to display.
     * @param title Panel title shown in the tab.
     * @param status Validation status of the JSON content.
     * @param tabSize Indentation width for formatting.
     * @param sourceUri URI of the source document for back-navigation.
     * @param sourceLine Line number in the source document.
     * @param preserveFocus Whether to keep focus on the current editor.
     */
    public async show(data: unknown, title: string = 'JSON Preview', status: 'valid' | 'invalid' | 'no-json' = 'valid', tabSize: number = 2, sourceUri?: string, sourceLine?: number, preserveFocus: boolean = false) {
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
            this.panel.webview.html = await this.htmlGenerator.generate(
                this.panel.webview,
                data,
                status,
                tabSize,
                sourceUri,
                sourceLine,
                expansionDepth
            );
        }
    }

    /** Disposes the webview panel and the reveal-line event emitter. */
    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
        this._onDidRevealLine.dispose();
    }

    public get isVisible(): boolean {
        return !!this.panel;
    }
}

