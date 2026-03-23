import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { RunbookMarkdown } from '../models/Runbook';

import { Logger } from '../services/Logger';
import { RunbookHtmlGenerator } from './RunbookHtmlGenerator';

export class RunbookWebviewPanel {
    private static readonly allowedShells = new Set(['/bin/sh', '/bin/bash', '/bin/zsh', 'cmd.exe', 'powershell.exe']);

    public static currentPanels: Map<string, RunbookWebviewPanel> = new Map();
    private readonly webviewPanel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private currentItem: RunbookMarkdown;
    private readonly htmlGenerator: RunbookHtmlGenerator;
    private logger: Logger;
    private runningProcesses: Map<string, cp.ChildProcess> = new Map();
    private scriptExecutionAllowed: boolean = false;
    private allowedContentHash: string | undefined;

    /** Creates a new runbook panel or reveals an existing one for the given markdown file. */
    public static async createOrShow(context: vscode.ExtensionContext, item: RunbookMarkdown, logger: Logger) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const existingPanel = RunbookWebviewPanel.currentPanels.get(item.filePath);
        if (existingPanel) {
            existingPanel.webviewPanel.reveal(column);
            await existingPanel.update(item);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'runbookWebview',
            `Runbook: ${item.label}`,
            column ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'resources')),
                    vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        RunbookWebviewPanel.currentPanels.set(item.filePath, new RunbookWebviewPanel(panel, context, item, logger));
    }

    private constructor(webviewPanel: vscode.WebviewPanel, context: vscode.ExtensionContext, item: RunbookMarkdown, logger: Logger) {
        this.webviewPanel = webviewPanel;
        this.currentItem = item;
        this.logger = logger;
        this.htmlGenerator = new RunbookHtmlGenerator(context, logger);

        this.update(item);

        this.webviewPanel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.webviewPanel.webview.onDidReceiveMessage(
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
            this.disposables
        );
    }

    /** Updates the panel content with a new or modified runbook item, resetting script permissions if the file changed. */
    public async update(item: RunbookMarkdown) {
        if (item.filePath !== this.currentItem.filePath) {
            this.scriptExecutionAllowed = false;
            this.allowedContentHash = undefined;
        } else if (this.scriptExecutionAllowed) {
            // Reset permission if file content changed since "Allow All" was granted
            const currentHash = await this.computeFileHash(item.filePath);
            if (currentHash !== this.allowedContentHash) {
                this.scriptExecutionAllowed = false;
                this.allowedContentHash = undefined;
            }
        }
        this.currentItem = item;
        this.webviewPanel.title = `Runbook: ${item.label}`;
        this.webviewPanel.webview.html = await this.htmlGenerator.generate(this.webviewPanel.webview, item);
    }

    private stopScript(blockId: string) {
        const proc = this.runningProcesses.get(blockId);
        if (proc) {
            proc.kill();
            this.runningProcesses.delete(blockId);
        }
    }

    private async executeScript(script: string, blockId: string) {
        if (!vscode.workspace.isTrusted) {
            vscode.window.showWarningMessage('Cannot execute scripts in untrusted workspaces.');
            return;
        }

        if (!this.scriptExecutionAllowed) {
            const detail = script.length > 500
                ? script.substring(0, 500) + `\n\n... (${script.length - 500} more characters — full script will be executed)`
                : script;
            const confirmed = await vscode.window.showWarningMessage(
                'Execute shell command?',
                { modal: true, detail },
                'Execute',
                'Allow All for this Runbook'
            );
            if (confirmed === 'Allow All for this Runbook') {
                this.scriptExecutionAllowed = true;
                this.allowedContentHash = await this.computeFileHash(this.currentItem.filePath);
            } else if (confirmed !== 'Execute') {
                return;
            }
        }

        // Kill any existing process for this block before starting a new one
        const existing = this.runningProcesses.get(blockId);
        if (existing) {
            existing.kill();
            this.runningProcesses.delete(blockId);
        }

        this.logger.info(`[RunbookWebview] Executing script from ${path.basename(this.currentItem.filePath)} (${blockId}, ${script.length} chars)`);
        this.webviewPanel.webview.postMessage({ command: 'command-running', blockId });

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        if (!RunbookWebviewPanel.allowedShells.has(shell)) {
            this.logger.error(`[RunbookWebview] Blocked unrecognized shell: ${shell}`);
            return;
        }
        const shellArgs = os.platform() === 'win32' ? ['/c', script] : ['-c', script];

        const child = cp.execFile(shell, shellArgs, {
            cwd,
            timeout: 60_000,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env, PATH: process.env.PATH }
        });
        this.runningProcesses.set(blockId, child);

        child.stdout?.on('data', (data) => {
            this.webviewPanel.webview.postMessage({
                command: 'command-output',
                blockId,
                stdout: data.toString()
            });
        });

        child.stderr?.on('data', (data) => {
            this.webviewPanel.webview.postMessage({
                command: 'command-output',
                blockId,
                stderr: data.toString()
            });
        });

        child.on('error', (error) => {
            this.webviewPanel.webview.postMessage({
                command: 'command-output',
                blockId,
                error: error.message
            });
        });

        child.on('close', (code) => {
            this.runningProcesses.delete(blockId);
            this.webviewPanel.webview.postMessage({
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
            const content = await fsp.readFile(this.currentItem.filePath, 'utf-8');
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
                    await fsp.writeFile(this.currentItem.filePath, newContent, 'utf-8');
                    return;
                }
                currentIndex++;
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to update script: ${msg}`);
        }
    }

    private async computeFileHash(filePath: string): Promise<string | undefined> {
        try {
            const content = await fsp.readFile(filePath, 'utf-8');
            return crypto.createHash('sha256').update(content).digest('hex');
        } catch (e: unknown) {
            this.logger.warn(`[RunbookWebview] Could not hash file: ${e instanceof Error ? e.message : String(e)}`);
            return undefined;
        }
    }

    /** Kills running processes, removes the panel from the registry, and disposes all resources. */
    public dispose() {
        RunbookWebviewPanel.currentPanels.delete(this.currentItem.filePath);

        // Kill all running child processes to prevent orphaned processes
        this.runningProcesses.forEach(p => p.kill());
        this.runningProcesses.clear();

        this.webviewPanel.dispose();

        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
