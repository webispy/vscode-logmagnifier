import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { RunbookItem, RunbookMarkdown, RunbookGroup } from '../models/Runbook';

import { RunbookService } from '../services/RunbookService';
import { IconUtils } from '../utils/IconUtils';
import { ThemeUtils } from '../utils/ThemeUtils';

export class RunbookTreeDataProvider implements vscode.TreeDataProvider<RunbookItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<RunbookItem | undefined | null | void> = new vscode.EventEmitter<RunbookItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RunbookItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private disposables: vscode.Disposable[] = [];

    constructor(private runbookService: RunbookService) {
        this.disposables.push(this.runbookService.onDidChangeTreeData(() => this.refresh()));
    }

    /** Fires a tree data change event to refresh the view. */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Converts a runbook item into a VS Code tree item based on its kind. */
    getTreeItem(element: RunbookItem): vscode.TreeItem {
        if (element.kind === 'markdown') {
            return this.getMarkdownTreeItem(element as RunbookMarkdown);
        } else if (element.kind === 'group') {
            return this.getGroupTreeItem(element as RunbookGroup);
        }
        return new vscode.TreeItem("Unknown");
    }

    /** Returns top-level runbook items, or children of a group element. */
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

    /** Returns the parent group for a markdown item, or undefined for top-level items. */
    getParent(element: RunbookItem): vscode.ProviderResult<RunbookItem> {
        if (element.kind === 'markdown') {
            return this.runbookService.items.find(
                item => item.kind === 'group' && (item as RunbookGroup).children.some(child => child.id === element.id)
            );
        }
        return undefined;
    }

    /** Disposes all subscriptions and the change event emitter. */
    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this._onDidChangeTreeData.dispose();
    }
}
