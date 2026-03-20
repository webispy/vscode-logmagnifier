import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { RunbookGroup, RunbookItem, RunbookMarkdown } from '../models/Runbook';

import { Logger } from '../services/Logger';
import { RunbookService } from '../services/RunbookService';
import { RunbookWebviewPanel } from '../views/RunbookWebviewPanel';

export class RunbookCommandManager {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly runbookService: RunbookService,
        private readonly logger: Logger
    ) {
        this.registerCommands();
    }

    /** Registers all runbook-related VS Code commands. */
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

    /** Opens the interactive webview panel for a runbook markdown item. */
    private async openWebview(item: RunbookMarkdown) {
        if (!item || item.kind !== 'markdown') {
            return;
        }

        try {
            await RunbookWebviewPanel.createOrShow(this.context, item, this.logger);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookCommandManager] Failed to open Runbook Webview: ${msg}`);
            vscode.window.showErrorMessage(`Failed to open interactive view: ${msg}`);
        }
    }

    /** Opens the raw markdown file in a text editor. */
    private async editMarkdown(item: RunbookMarkdown) {
        if (!item || item.kind !== 'markdown') {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(item.filePath);
            await vscode.window.showTextDocument(document);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookCommandManager] Failed to open Markdown editor: ${msg}`);
            vscode.window.showErrorMessage(`Failed to open editor: ${msg}`);
        }
    }

    /** Prompts the user for a name and creates a new runbook group. */
    private async addGroup() {
        const name = await vscode.window.showInputBox({ prompt: 'Enter new group name' });
        if (name) {
            await this.runbookService.createGroup(name);
        }
    }

    /** Prompts the user for a name and creates a new markdown file within the given group. */
    private async addItem(item: RunbookGroup) {
        if (!item || item.kind !== 'group') { return; }
        const name = await vscode.window.showInputBox({ prompt: 'Enter new markdown file name' });
        if (name) {
            await this.runbookService.createItem(item.dirPath, name);
        }
    }

    /** Deletes a runbook group or markdown item after user confirmation. */
    private async deleteItem(item: RunbookItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as RunbookGroup).dirPath : (item as RunbookMarkdown).filePath;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete '${item.label}'?`, { modal: true }, 'Delete');
        if (confirm === 'Delete') {
            await this.runbookService.deletePath(targetPath);
        }
    }

    /** Prompts for a new name and renames a runbook group or markdown item. */
    private async renameItem(item: RunbookItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as RunbookGroup).dirPath : (item as RunbookMarkdown).filePath;
        const newName = await vscode.window.showInputBox({ prompt: 'Enter new name', value: item.label });
        if (newName && newName !== item.label) {
            await this.runbookService.renamePath(targetPath, newName, item.kind === 'group');
        }
    }

    /** Refreshes the runbook tree view by reloading data from disk. */
    private async refreshRunbookView() {
        await this.runbookService.refresh();
    }

    /** Prompts for a save location and exports the runbook as a JSON file. */
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

    /** Prompts the user to select a JSON file and imports it as a runbook. */
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
