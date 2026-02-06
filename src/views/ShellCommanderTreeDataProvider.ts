import * as vscode from 'vscode';
import { ShellCommanderService } from '../services/ShellCommanderService';
import { ShellItem, ShellGroup, ShellFolder, ShellCommand } from '../models/ShellCommander';
import { Constants } from '../constants';

export class ShellCommanderTreeDataProvider implements vscode.TreeDataProvider<ShellItem>, vscode.TreeDragAndDropController<ShellItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ShellItem | undefined | null | void> = new vscode.EventEmitter<ShellItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShellItem | undefined | null | void> = this._onDidChangeTreeData.event;

    dropMimeTypes = ['application/vnd.code.tree.shellcommander'];
    dragMimeTypes = ['application/vnd.code.tree.shellcommander'];

    constructor(private shellService: ShellCommanderService) {
        this.shellService.onDidChangeTreeData(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ShellItem): vscode.TreeItem {
        switch (element.kind) {
            case 'group':
                return this.getGroupTreeItem(element);
            case 'folder':
                return this.getFolderTreeItem(element);
            case 'command':
                return this.getCommandTreeItem(element);

        }
        return new vscode.TreeItem("Unknown");
    }

    getChildren(element?: ShellItem): vscode.ProviderResult<ShellItem[]> {
        if (!element) {
            return this.shellService.groups;
        }

        if (element.kind === 'group') {
            return element.children;
        }

        if (element.kind === 'folder') {
            return element.children;
        }

        return [];
    }

    private getGroupTreeItem(group: ShellGroup): vscode.TreeItem {
        const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'shellGroup';
        item.iconPath = new vscode.ThemeIcon('folder-library');
        item.tooltip = group.description || group.label;
        // Debug logging
        // console.log(`Created group item: ${group.label}, context: ${item.contextValue}`);
        return item;
    }

    private getFolderTreeItem(folder: ShellFolder): vscode.TreeItem {
        const item = new vscode.TreeItem(folder.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'shellFolder';
        item.iconPath = vscode.ThemeIcon.Folder;
        item.tooltip = folder.description;
        return item;
    }

    private getCommandTreeItem(command: ShellCommand): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(command.label, vscode.TreeItemCollapsibleState.None);

        treeItem.iconPath = new vscode.ThemeIcon('terminal');
        treeItem.contextValue = 'shellCommand';

        const tooltipScript = command.command;
        treeItem.tooltip = new vscode.MarkdownString(`**${command.label}**\n\n\`\`\`sh\n${tooltipScript}\n\`\`\``);

        treeItem.command = {
            command: Constants.Commands.ExecuteShellCommand,
            title: 'Execute Command',
            arguments: [command]
        };

        return treeItem;
    }

    // Drag/Drop implementation stub - can be expanded later
    handleDrag(_source: readonly ShellItem[], _dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        // Implementation for drag
    }

    handleDrop(_target: ShellItem | undefined, _dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        // Implementation for drop
    }
    getParent(element: ShellItem): vscode.ProviderResult<ShellItem> {
        return element.parent as ShellItem;
    }
}
