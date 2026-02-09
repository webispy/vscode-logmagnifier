import * as vscode from 'vscode';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup, FilterItem } from '../models/Filter';

import { IconUtils } from '../utils/IconUtils';

type TreeItem = FilterGroup | FilterItem;

export class FilterTreeDataProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private filterManager: FilterManager,
        private mode: 'word' | 'regex'
    ) {
        this.disposables.push(this.filterManager.onDidChangeFilters(() => this.refresh()));
        this.disposables.push(this.filterManager.onDidChangeResultCounts(() => this.refresh()));
    }

    refresh(element?: TreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        if (this.isGroup(element)) {
            const state = element.isExpanded !== false ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
            const item = new vscode.TreeItem(element.name, state);
            item.contextValue = element.isEnabled ? 'filterGroupEnabled' : 'filterGroupDisabled';
            item.id = element.id;

            // UX Improvement: Distinct Group Icons
            const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
            const strokeColor = isDark ? '#cccccc' : '#333333';
            const dimmedColor = isDark ? '#555555' : '#cccccc';

            const isEnabled = element.isEnabled;
            const folderColor = isEnabled ? strokeColor : dimmedColor;
            const overlayColor = isEnabled ? undefined : strokeColor;

            const svg = IconUtils.generateGroupSvg(folderColor, overlayColor);
            item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

            item.description = `${element.filters.length} items`;
            return item;
        } else {
            let label = element.keyword;

            if (element.isRegex) {
                label = element.nickname || element.keyword;
            } else {
                // Apply tilde prefix for exclude items (both enabled and disabled)
                if (element.type === 'exclude') {
                    label = `^${element.keyword}`;
                } else {
                    label = element.keyword;
                }
            }

            if (element.resultCount !== undefined && element.resultCount > 0) {
                label += ` (${element.resultCount})`;
            }

            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = `${element.isEnabled ? 'filterItemEnabled' : 'filterItemDisabled'}_cl${element.contextLine ?? 0}_hm${element.highlightMode ?? 0}_cs${element.caseSensitive ? 1 : 0}_col${element.color ?? 'none'}_type${element.type}_es${element.excludeStyle || 'line-through'}${element.resultCount && element.resultCount > 0 ? '_hasMatches' : ''}`;
            item.id = element.id;

            if (element.isRegex && element.nickname) {
                item.description = element.keyword;
            } else {
                item.description = '';
            }

            if (element.isEnabled) {
                if (element.type === 'exclude') {
                    // Resolve color: check if it's a preset ID, otherwise use as is
                    // Always use default gray for exclude, even if color property exists from previous include state
                    const fillColor = '#808080';

                    // Determine stroke color for the strike-through line based on theme
                    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
                    const strokeColor = isDark ? '#cccccc' : '#333333';
                    const style = element.excludeStyle || 'line-through';

                    const svg = IconUtils.generateExcludeSvg(fillColor, strokeColor, style);
                    item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
                } else if (element.color) {
                    // Resolve color: check if it's a preset ID, otherwise use as is
                    const preset = this.filterManager.getPresetById(element.color);
                    let fillColor = element.color;

                    if (preset) {
                        const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
                        fillColor = isDark ? preset.dark : preset.light;
                    }

                    // Create a colored dot icon using SVG data URI
                    const mode = element.highlightMode ?? 0;
                    const svg = IconUtils.generateIncludeSvg(fillColor, mode, element.id);
                    item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
                } else {
                    // Fallback for enabled items without specific color
                    if (this.mode === 'regex') {
                        item.iconPath = new vscode.ThemeIcon('eye');
                    } else {
                        item.iconPath = new vscode.ThemeIcon('filter');
                    }
                }
            } else {
                // Distinct "Disabled/Hidden" icon - "OFF" text
                const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
                const textColor = isDark ? '#808080' : '#808080';
                const svg = IconUtils.generateOffSvg(textColor);
                item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
            }

            return item;
        }
    }

    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        if (!element) {
            // Filter groups based on the data provider's mode
            return this.filterManager.getGroups().filter(g => this.mode === 'regex' ? g.isRegex : !g.isRegex);
        } else if (this.isGroup(element)) {
            // Filter items based on the data provider's mode
            return element.filters.filter(f => this.mode === 'regex' ? f.isRegex : !f.isRegex);
        }
        return [];
    }

    getParent(element: TreeItem): vscode.ProviderResult<TreeItem> {
        if (this.isGroup(element)) {
            return null;
        }
        // It's a filter item, find its group
        const groups = this.filterManager.getGroups();
        return groups.find(g => g.filters.some(f => f.id === element.id));
    }

    dropMimeTypes = ['application/vnd.code.tree.logmagnifier-filters'];
    dragMimeTypes = ['application/vnd.code.tree.logmagnifier-filters'];

    public handleDrag(source: readonly TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const item = source[0];
        dataTransfer.set('application/vnd.code.tree.logmagnifier-filters', new vscode.DataTransferItem(item));
    }

    public handleDrop(target: TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.logmagnifier-filters');
        if (!transferItem) {
            return;
        }

        const activeItem = transferItem.value as TreeItem;
        const targetItem = target;

        // Group Reordering
        if (this.isGroup(activeItem)) {
            if (!targetItem) {
                // Dropped on root -> Append to end
                this.filterManager.moveGroup(activeItem.id, undefined, 'append');
                return;
            }

            if (this.isGroup(targetItem)) {
                // Dropped on another group -> Move active group after target group
                if (activeItem.id !== targetItem.id) {
                    this.filterManager.moveGroup(activeItem.id, targetItem.id, 'after');
                }
                return;
            }

            // Dropped on an item -> Ignore (Groups cannot be inside items)
            return;
        }

        // Item Reordering/Moving (activeItem is FilterItem)
        // When we get here, activeItem is definitely NOT a group because of the check above.
        const activeFilterItem = activeItem as FilterItem;

        const groups = this.filterManager.getGroups();
        const activeGroup = groups.find(g => g.filters.some(f => f.id === activeFilterItem.id));

        if (!activeGroup) {
            return;
        }

        if (!targetItem) {
            return;
        }

        // Case 1: Dropping on a Group
        if (this.isGroup(targetItem)) {
            // Move to end of list
            this.filterManager.moveFilter(activeGroup.id, targetItem.id, activeFilterItem.id, undefined, 'append');
            return;
        }

        // Case 2: Dropping on an Item
        const targetGroup = groups.find(g => g.filters.some(f => f.id === targetItem.id));

        if (!targetGroup) {
            return;
        }

        if (activeFilterItem.id === targetItem.id) {
            return;
        }

        this.filterManager.moveFilter(activeGroup.id, targetGroup.id, activeFilterItem.id, targetItem.id, 'after');
    }

    private isGroup(item: TreeItem): item is FilterGroup {
        return (item as FilterGroup).filters !== undefined;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
