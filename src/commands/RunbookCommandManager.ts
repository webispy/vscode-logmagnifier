import * as vscode from 'vscode';
import { RunbookService } from '../services/RunbookService';
import { Constants } from '../Constants';
import { RunbookItem, RunbookMarkdown, RunbookGroup } from '../models/Runbook';
import { Logger } from '../services/Logger';
import { RunbookWebviewPanel } from '../views/RunbookWebviewPanel';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export class RunbookCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private runbookService: RunbookService
    ) {
        this.registerCommands();
    }

    protected registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand(Constants.Commands.RunbookOpenWebview, this.openWebview, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookEditMarkdown, this.editMarkdown, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookAddGroup, this.addGroup, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookAddItem, this.addItem, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookDeleteGroup, this.deleteItem, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookDeleteItem, this.deleteItem, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookRenameGroup, this.renameItem, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookRenameItem, this.renameItem, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookExport, this.exportRunbook, this),
            vscode.commands.registerCommand(Constants.Commands.RunbookImport, this.importRunbook, this),
            vscode.commands.registerCommand(Constants.Commands.RefreshRunbookView, this.refreshRunbookView, this)
        );
    }

    private async openWebview(item: RunbookMarkdown) {
        if (!item || item.kind !== 'markdown') {
            return;
        }

        try {
            await RunbookWebviewPanel.createOrShow(this.context, item);
        } catch (e) {
            Logger.getInstance().error(`Failed to open Runbook Webview: ${e}`);
            vscode.window.showErrorMessage(`Failed to open interactive view: ${e}`);
        }
    }

    private async editMarkdown(item: RunbookMarkdown) {
        if (!item || item.kind !== 'markdown') {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(item.filePath);
            await vscode.window.showTextDocument(document);
        } catch (e) {
            Logger.getInstance().error(`Failed to open Markdown editor: ${e}`);
            vscode.window.showErrorMessage(`Failed to open editor: ${e}`);
        }
    }

    private async addGroup(item?: RunbookGroup) {
        const parentPath = item ? item.dirPath : undefined;
        const name = await vscode.window.showInputBox({ prompt: 'Enter new group name' });
        if (name) {
            await this.runbookService.createGroup(parentPath, name);
        }
    }

    private async addItem(item?: RunbookGroup) {
        const parentPath = item ? item.dirPath : undefined;
        const name = await vscode.window.showInputBox({ prompt: 'Enter new markdown file name' });
        if (name) {
            await this.runbookService.createItem(parentPath, name);
        }
    }

    private async deleteItem(item: RunbookItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as RunbookGroup).dirPath : (item as RunbookMarkdown).filePath;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete '${item.label}'?`, { modal: true }, 'Delete');
        if (confirm === 'Delete') {
            await this.runbookService.deletePath(targetPath);
        }
    }

    private async renameItem(item: RunbookItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as RunbookGroup).dirPath : (item as RunbookMarkdown).filePath;
        const newName = await vscode.window.showInputBox({ prompt: 'Enter new name', value: item.label });
        if (newName && newName !== item.label) {
            await this.runbookService.renamePath(targetPath, newName, item.kind === 'group');
        }
    }

    private async refreshRunbookView() {
        await this.runbookService.refresh();
    }

    private async exportRunbook() {
        const fileName = 'logmagnifier_runbook.json';
        const downloadsPath = path.join(os.homedir(), 'Downloads');
        let defaultUri = vscode.Uri.file(path.join(downloadsPath, fileName));

        // Fallback to homedir if Downloads doesn't exist
        if (!fs.existsSync(downloadsPath)) {
            defaultUri = vscode.Uri.file(path.join(os.homedir(), fileName));
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            filters: {
                'JSON Files': ['json']
            },
            title: 'Export Runbook'
        });

        if (uri) {
            await this.runbookService.exportRunbook(uri);
        }
    }

    private async importRunbook() {
        const downloadsPath = path.join(os.homedir(), 'Downloads');
        let defaultUri = vscode.Uri.file(downloadsPath);

        if (!fs.existsSync(downloadsPath)) {
            defaultUri = vscode.Uri.file(os.homedir());
        }

        const uris = await vscode.window.showOpenDialog({
            defaultUri: defaultUri,
            canSelectMany: false,
            filters: {
                'JSON Files': ['json']
            },
            title: 'Import Runbook'
        });

        if (uris && uris.length > 0) {
            await this.runbookService.importRunbook(uris[0]);
        }
    }
}
