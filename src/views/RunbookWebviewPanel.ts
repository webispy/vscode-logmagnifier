import * as vscode from 'vscode';
import { RunbookMarkdown } from '../models/Runbook';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { RunbookHtmlGenerator } from './RunbookHtmlGenerator';

export class RunbookWebviewPanel {
    public static currentPanels: Map<string, RunbookWebviewPanel> = new Map();
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentItem: RunbookMarkdown;
    private readonly _htmlGenerator: RunbookHtmlGenerator;
    private _runningProcesses: Map<string, cp.ChildProcess> = new Map();
    private _scriptExecutionAllowed: boolean = false;

    public static async createOrShow(context: vscode.ExtensionContext, item: RunbookMarkdown) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const existingPanel = RunbookWebviewPanel.currentPanels.get(item.filePath);
        if (existingPanel) {
            existingPanel._panel.reveal(column);
            await existingPanel.update(item);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'runbookWebview',
            `Runbook: ${item.label}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'resources')),
                    vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        RunbookWebviewPanel.currentPanels.set(item.filePath, new RunbookWebviewPanel(panel, context, item));
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
                    case 'stop':
                        this.stopScript(message.blockId);
                        return;
                    case 'update-script':
                        this.updateScriptInFile(message.blockId, message.script);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public async update(item: RunbookMarkdown) {
        if (item.filePath !== this._currentItem.filePath) {
            this._scriptExecutionAllowed = false;
        }
        this._currentItem = item;
        this._panel.title = `Runbook: ${item.label}`;
        this._panel.webview.html = await this._htmlGenerator.generate(this._panel.webview, item);
    }

    public dispose() {
        RunbookWebviewPanel.currentPanels.delete(this._currentItem.filePath);

        // Kill all running child processes to prevent orphaned processes
        this._runningProcesses.forEach(p => p.kill());
        this._runningProcesses.clear();

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private stopScript(blockId: string) {
        const proc = this._runningProcesses.get(blockId);
        if (proc) {
            proc.kill();
            this._runningProcesses.delete(blockId);
        }
    }

    private async executeScript(script: string, blockId: string) {
        if (!vscode.workspace.isTrusted) {
            vscode.window.showWarningMessage('Cannot execute scripts in untrusted workspaces.');
            return;
        }

        if (!this._scriptExecutionAllowed) {
            const confirmed = await vscode.window.showWarningMessage(
                'Execute shell command?',
                { modal: true, detail: script.substring(0, 500) },
                'Execute',
                'Allow All for this Runbook'
            );
            if (confirmed === 'Allow All for this Runbook') {
                this._scriptExecutionAllowed = true;
            } else if (confirmed !== 'Execute') {
                return;
            }
        }

        // Kill any existing process for this block before starting a new one
        const existing = this._runningProcesses.get(blockId);
        if (existing) {
            existing.kill();
            this._runningProcesses.delete(blockId);
        }

        this._panel.webview.postMessage({ command: 'command-running', blockId });

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = os.platform() === 'win32' ? ['/c', script] : ['-c', script];

        const child = cp.execFile(shell, shellArgs, {
            cwd,
            timeout: 60_000,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, PATH: process.env.PATH }
        });
        this._runningProcesses.set(blockId, child);

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
            this._runningProcesses.delete(blockId);
            this._panel.webview.postMessage({
                command: 'command-finished',
                blockId,
                code
            });
        });
    }

    private async updateScriptInFile(blockId: string, newScript: string): Promise<void> {
        const indexMatch = blockId.match(/^block_(\d+)$/);
        if (!indexMatch) { return; }
        const targetIndex = parseInt(indexMatch[1], 10);

        try {
            const content = await fsp.readFile(this._currentItem.filePath, 'utf-8');
            const codeBlockRegex = /```(sh|bash|shell)\s*\n([\s\S]*?)```/g;

            let match;
            let currentIndex = 0;

            while ((match = codeBlockRegex.exec(content)) !== null) {
                if (currentIndex === targetIndex) {
                    const lang = match[1];
                    const before = content.substring(0, match.index);
                    const after = content.substring(match.index + match[0].length);
                    const normalizedScript = newScript.endsWith('\n') ? newScript : newScript + '\n';
                    const newContent = before + '```' + lang + '\n' + normalizedScript + '```' + after;
                    await fsp.writeFile(this._currentItem.filePath, newContent, 'utf-8');
                    return;
                }
                currentIndex++;
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to update script: ${e}`);
        }
    }
}
