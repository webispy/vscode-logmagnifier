import * as vscode from 'vscode';
import { JsonTreeHtmlGenerator } from './JsonTreeHtmlGenerator';

export class JsonTreeWebview {
    private panel: vscode.WebviewPanel | undefined;
    private readonly htmlGenerator: JsonTreeHtmlGenerator;

    private readonly _onDidRevealLine = new vscode.EventEmitter<{ uri: string, line: number }>();
    public readonly onDidRevealLine = this._onDidRevealLine.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.htmlGenerator = new JsonTreeHtmlGenerator(this.context);
    }

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

