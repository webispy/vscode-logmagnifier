import * as vscode from 'vscode';
import { ShellCommanderService } from '../services/ShellCommanderService';
import { Constants } from '../Constants';
import { ShellItem, ShellMarkdown, ShellGroup } from '../models/ShellCommander';
import { Logger } from '../services/Logger';
import { ShellCommanderWebviewPanel } from '../webview/ShellCommanderWebviewPanel';

export class ShellCommanderCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private shellService: ShellCommanderService
    ) {
        this.registerCommands();
    }

    protected registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderOpenWebview, this.openWebview, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderEditMarkdown, this.editMarkdown, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderAddGroup, this.addGroup, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderAddItem, this.addItem, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderDeleteGroup, this.deleteItem, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderDeleteItem, this.deleteItem, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderRenameGroup, this.renameItem, this),
            vscode.commands.registerCommand(Constants.Commands.ShellCommanderRenameItem, this.renameItem, this),
            vscode.commands.registerCommand(Constants.Commands.RefreshShellView, this.refreshShellView, this)
        );
    }

    private async openWebview(item: ShellMarkdown) {
        if (!item || item.kind !== 'markdown') {
            return;
        }

        try {
            await ShellCommanderWebviewPanel.createOrShow(this.context, item);
        } catch (e) {
            Logger.getInstance().error(`Failed to open Shell Commander Webview: ${e}`);
            vscode.window.showErrorMessage(`Failed to open interactive view: ${e}`);
        }
    }

    private async editMarkdown(item: ShellMarkdown) {
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

    private async addGroup(item?: ShellGroup) {
        const parentPath = item ? item.dirPath : undefined;
        const name = await vscode.window.showInputBox({ prompt: 'Enter new group name' });
        if (name) {
            await this.shellService.createGroup(parentPath, name);
        }
    }

    private async addItem(item?: ShellGroup) {
        const parentPath = item ? item.dirPath : undefined;
        const name = await vscode.window.showInputBox({ prompt: 'Enter new markdown file name' });
        if (name) {
            await this.shellService.createItem(parentPath, name);
        }
    }

    private async deleteItem(item: ShellItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as ShellGroup).dirPath : (item as ShellMarkdown).filePath;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete '${item.label}'?`, { modal: true }, 'Delete');
        if (confirm === 'Delete') {
            await this.shellService.deletePath(targetPath);
        }
    }

    private async renameItem(item: ShellItem) {
        if (!item) { return; }
        const targetPath = item.kind === 'group' ? (item as ShellGroup).dirPath : (item as ShellMarkdown).filePath;
        const newName = await vscode.window.showInputBox({ prompt: 'Enter new name', value: item.label });
        if (newName && newName !== item.label) {
            await this.shellService.renamePath(targetPath, newName, item.kind === 'group');
        }
    }

    private async refreshShellView() {
        await this.shellService.refresh();
    }
}
