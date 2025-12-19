import * as vscode from 'vscode';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup, FilterItem } from '../models/Filter';

type TreeItem = FilterGroup | FilterItem;

export class FilterTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private filterManager: FilterManager) {
        this.filterManager.onDidChangeFilters(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        if (this.isGroup(element)) {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
            // Context value allows package.json "when" clauses to match enabled/disabled state
            item.contextValue = element.isEnabled ? 'filterGroupEnabled' : 'filterGroupDisabled';
            item.id = element.id;

            // Icon to show state visually in the tree
            item.iconPath = element.isEnabled ? new vscode.ThemeIcon('pass-filled') : new vscode.ThemeIcon('circle-large-outline');

            // No command here, so clicking the row just selects it. 
            // Toggling is done via inline buttons.

            // Visual cue for enabled state
            item.description = element.isEnabled ? '(Active)' : '(Inactive)';
            return item;
        } else {
            const item = new vscode.TreeItem(`${element.type === 'include' ? '[IN]' : '[OUT]'} ${element.keyword}`, vscode.TreeItemCollapsibleState.None);
            item.contextValue = element.isEnabled ? 'filterItemEnabled' : 'filterItemDisabled';
            item.id = element.id;
            item.description = element.isEnabled ? '' : '(Disabled)';
            // Removed toggle command from item click

            // Colorize or Icon based on type
            item.iconPath = element.isEnabled ?
                (element.type === 'include' ? new vscode.ThemeIcon('eye') : new vscode.ThemeIcon('eye-closed')) :
                new vscode.ThemeIcon('circle-slash');
            return item;
        }
    }

    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        if (!element) {
            return this.filterManager.getGroups();
        } else if (this.isGroup(element)) {
            return element.filters;
        }
        return [];
    }

    // Type Guard
    private isGroup(item: any): item is FilterGroup {
        return (item as FilterGroup).filters !== undefined;
    }
}
