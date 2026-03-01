import * as vscode from 'vscode';
import { RunbookMarkdown } from '../models/Runbook';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { RunbookHtmlGenerator } from './RunbookHtmlGenerator';

export class RunbookWebviewPanel {
    public static currentPanel: RunbookWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentItem: RunbookMarkdown;
    private readonly _htmlGenerator: RunbookHtmlGenerator;

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
        this._htmlGenerator = new RunbookHtmlGenerator(context);

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
        this._panel.webview.html = await this._htmlGenerator.generate(this._panel.webview, item);
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
}
