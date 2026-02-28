import * as vscode from 'vscode';
import { ShellCommanderService } from '../services/ShellCommanderService';
import { ShellItem, ShellMarkdown, ShellGroup } from '../models/ShellCommander';
import { Constants } from '../Constants';

export class ShellCommanderTreeDataProvider implements vscode.TreeDataProvider<ShellItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<ShellItem | undefined | null | void> = new vscode.EventEmitter<ShellItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShellItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private disposables: vscode.Disposable[] = [];

    constructor(private shellService: ShellCommanderService) {
        this.disposables.push(this.shellService.onDidChangeTreeData(() => this.refresh()));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ShellItem): vscode.TreeItem {
        if (element.kind === 'markdown') {
            return this.getMarkdownTreeItem(element as ShellMarkdown);
        } else if (element.kind === 'group') {
            return this.getGroupTreeItem(element as ShellGroup);
        }
        return new vscode.TreeItem("Unknown");
    }

    getChildren(element?: ShellItem): vscode.ProviderResult<ShellItem[]> {
        if (!element) {
            return this.shellService.items;
        }

        if (element.kind === 'group') {
            return (element as ShellGroup).children;
        }

        return [];
    }

    private getMarkdownTreeItem(markdown: ShellMarkdown): vscode.TreeItem {
        const item = new vscode.TreeItem(markdown.label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'shellMarkdown';
        item.iconPath = new vscode.ThemeIcon('markdown');
        item.tooltip = markdown.filePath;

        item.command = {
            command: Constants.Commands.ShellCommanderOpenWebview,
            title: 'Open Shell Commander',
            arguments: [markdown]
        };

        return item;
    }

    private getGroupTreeItem(group: ShellGroup): vscode.TreeItem {
        const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'shellGroup';
        item.iconPath = vscode.ThemeIcon.Folder;
        item.tooltip = group.dirPath;
        return item;
    }

    getParent(_element: ShellItem): vscode.ProviderResult<ShellItem> {
        return undefined; // Flat list for now
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this._onDidChangeTreeData.dispose();
    }
}
