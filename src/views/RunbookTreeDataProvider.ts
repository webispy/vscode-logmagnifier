import * as vscode from 'vscode';
import { RunbookService } from '../services/RunbookService';
import { RunbookItem, RunbookMarkdown, RunbookGroup } from '../models/Runbook';
import { Constants } from '../Constants';
import { ThemeUtils } from '../utils/ThemeUtils';
import { IconUtils } from '../utils/IconUtils';

export class RunbookTreeDataProvider implements vscode.TreeDataProvider<RunbookItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<RunbookItem | undefined | null | void> = new vscode.EventEmitter<RunbookItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RunbookItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private disposables: vscode.Disposable[] = [];

    constructor(private runbookService: RunbookService) {
        this.disposables.push(this.runbookService.onDidChangeTreeData(() => this.refresh()));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RunbookItem): vscode.TreeItem {
        if (element.kind === 'markdown') {
            return this.getMarkdownTreeItem(element as RunbookMarkdown);
        } else if (element.kind === 'group') {
            return this.getGroupTreeItem(element as RunbookGroup);
        }
        return new vscode.TreeItem("Unknown");
    }

    getChildren(element?: RunbookItem): vscode.ProviderResult<RunbookItem[]> {
        if (!element) {
            return this.runbookService.items;
        }

        if (element.kind === 'group') {
            return (element as RunbookGroup).children;
        }

        return [];
    }

    private getMarkdownTreeItem(markdown: RunbookMarkdown): vscode.TreeItem {
        const item = new vscode.TreeItem(markdown.label, vscode.TreeItemCollapsibleState.None);
        item.id = markdown.id;
        item.contextValue = 'runbookMarkdown';
        item.iconPath = new vscode.ThemeIcon('terminal');
        item.tooltip = markdown.filePath;

        item.command = {
            command: Constants.Commands.RunbookOpenWebview,
            title: 'Open Runbook',
            arguments: [markdown]
        };

        return item;
    }

    private getGroupTreeItem(group: RunbookGroup): vscode.TreeItem {
        const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = group.id;
        item.contextValue = 'runbookGroup';

        const svg = IconUtils.generateGroupSvg(ThemeUtils.strokeColor);
        item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

        item.tooltip = group.dirPath;
        item.description = `${group.children.length} items`;
        return item;
    }

    getParent(element: RunbookItem): vscode.ProviderResult<RunbookItem> {
        if (element.kind === 'markdown') {
            return this.runbookService.items.find(
                item => item.kind === 'group' && (item as RunbookGroup).children.some(child => child.id === element.id)
            );
        }
        return undefined;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this._onDidChangeTreeData.dispose();
    }
}
