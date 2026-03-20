import * as vscode from 'vscode';

import { FilterGroup, FilterItem, HighlightMode } from '../models/Filter';

import { FilterManager } from '../services/FilterManager';
import { Logger } from '../services/Logger';
import { IconUtils } from '../utils/IconUtils';
import { ThemeUtils } from '../utils/ThemeUtils';

type TreeItem = FilterGroup | FilterItem;

export class FilterTreeDataProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem>, vscode.Disposable {
    private static readonly MAX_ICON_CACHE_SIZE = 200;

    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private disposables: vscode.Disposable[] = [];
    private iconCache: Map<string, vscode.Uri> = new Map();

    constructor(
        private readonly filterManager: FilterManager,
        private readonly mode: 'word' | 'regex',
        private readonly logger: Logger
    ) {
        this.disposables.push(this.filterManager.onDidChangeFilters(() => this.refresh()));
        this.disposables.push(this.filterManager.onDidChangeResultCounts(() => this.refresh()));
    }

    private getCachedIcon(key: string, generator: () => string): vscode.Uri {
        if (!this.iconCache.has(key)) {
            if (this.iconCache.size >= FilterTreeDataProvider.MAX_ICON_CACHE_SIZE) {
                const oldestKey = this.iconCache.keys().next().value;
                if (oldestKey) { this.iconCache.delete(oldestKey); }
            }
            const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(generator()).toString('base64')}`);
            this.iconCache.set(key, uri);
            return uri;
        }
        return this.iconCache.get(key) as vscode.Uri;
    }

    /** Fires a tree data change event to refresh the view. */
    refresh(element?: TreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    /** Converts a filter group or item into a VS Code tree item with icon and context. */
    getTreeItem(element: TreeItem): vscode.TreeItem {
        try {
            if (this.isGroup(element)) {
                const state = element.isExpanded !== false ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                const item = new vscode.TreeItem(element.name, state);
                item.contextValue = element.isEnabled ? 'filterGroupEnabled' : 'filterGroupDisabled';
                item.id = element.id;

                // UX Improvement: Distinct Group Icons
                const isEnabled = element.isEnabled;
                const folderColor = isEnabled ? ThemeUtils.strokeColor : ThemeUtils.dimmedColor;
                const overlayColor = isEnabled ? undefined : ThemeUtils.strokeColor;

                item.iconPath = this.getCachedIcon(`group_${folderColor}_${overlayColor}`, () => IconUtils.generateGroupSvg(folderColor, overlayColor));

                item.description = `${element.filters.length} items`;
                return item;
            } else {
                let label = element.keyword;

                if (element.isRegex) {
                    label = element.nickname ?? element.keyword;
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
                        const fillColor = ThemeUtils.neutralColor;
                        const strokeColor = ThemeUtils.strokeColor;
                        const style = element.excludeStyle ?? 'line-through';

                        item.iconPath = this.getCachedIcon(`exclude_${fillColor}_${strokeColor}_${style}`, () => IconUtils.generateExcludeSvg(fillColor, strokeColor, style));
                    } else if (element.color) {
                        const preset = this.filterManager.getPresetById(element.color);
                        let fillColor = element.color;

                        if (preset) {
                            const isDark = ThemeUtils.isDarkTheme();
                            fillColor = isDark ? preset.dark : preset.light;
                        }

                        const mode = element.highlightMode ?? HighlightMode.Word;
                        item.iconPath = this.getCachedIcon(`include_${fillColor}_${mode}`, () => IconUtils.generateIncludeSvg(fillColor, mode, element.id));
                    } else {
                        if (this.mode === 'regex') {
                            item.iconPath = new vscode.ThemeIcon('eye');
                        } else {
                            item.iconPath = new vscode.ThemeIcon('filter');
                        }
                    }
                } else {
                    const offColor = ThemeUtils.neutralColor;
                    item.iconPath = this.getCachedIcon(`off_${offColor}`, () => IconUtils.generateOffSvg(offColor));
                }

                return item;
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterTreeView] getTreeItem failed: ${msg}`);
            const errorItem = new vscode.TreeItem('Error loading item', vscode.TreeItemCollapsibleState.None);
            errorItem.tooltip = msg;
            return errorItem;
        }
    }

    /** Returns top-level groups or the filters within a group, filtered by mode. */
    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        try {
            if (!element) {
                // Filter groups based on the data provider's mode
                return this.filterManager.getGroups().filter(g => this.mode === 'regex' ? g.isRegex : !g.isRegex);
            } else if (this.isGroup(element)) {
                // Filter items based on the data provider's mode
                return element.filters.filter(f => this.mode === 'regex' ? f.isRegex : !f.isRegex);
            }
            return [];
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterTreeView] getChildren failed: ${msg}`);
            return [];
        }
    }

    /** Returns the parent group for a filter item, or null for top-level groups. */
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

    /** Serializes the dragged tree item into the data transfer for reordering. */
    public handleDrag(source: readonly TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const item = source[0];
        dataTransfer.set('application/vnd.code.tree.logmagnifier-filters', new vscode.DataTransferItem(item));
    }

    /** Handles dropping a group or filter item onto a new position in the tree. */
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

    /** Clears the icon cache and disposes all subscriptions. */
    public dispose() {
        this.iconCache.clear();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
