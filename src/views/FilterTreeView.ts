import * as vscode from 'vscode';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup, FilterItem } from '../models/Filter';

type TreeItem = FilterGroup | FilterItem;

export class FilterTreeDataProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(
        private filterManager: FilterManager,
        private mode: 'word' | 'regex'
    ) {
        this.filterManager.onDidChangeFilters(() => this.refresh());
        this.filterManager.onDidChangeResultCounts(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        if (this.isGroup(element)) {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = element.isEnabled ? 'filterGroupEnabled' : 'filterGroupDisabled';
            item.id = element.id;
            item.iconPath = element.isEnabled ? new vscode.ThemeIcon('pass-filled') : new vscode.ThemeIcon('circle-large-outline');
            item.description = element.isEnabled ? '(Active)' : '(Inactive)';
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
            item.contextValue = `${element.isEnabled ? 'filterItemEnabled' : 'filterItemDisabled'}_cl${element.contextLine ?? 0}_hm${element.highlightMode ?? 0}_cs${element.caseSensitive ? 1 : 0}_col${element.color ?? 'none'}_type${element.type}`;
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

                    // Create a strike-through icon with gap
                    // Text 'abc' represents the word, Line represents the strike
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                        <text x="50%" y="11" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="${fillColor}" text-anchor="middle">abc</text>
                        <line x1="0" y1="8" x2="16" y2="8" stroke="${strokeColor}" stroke-width="1.5" />
                    </svg>`;
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
                    let svg: string;
                    const mode = element.highlightMode ?? 0;
                    if (mode === 1) {
                        // Rounded box (pill shape) - represents line text only
                        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="5" width="14" height="6" rx="3" ry="3" fill="${fillColor}"/></svg>`;
                    } else if (mode === 2) {
                        // Wide rectangle with gradient to represent full line width
                        const gradId = `grad_${element.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="70%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="100%" style="stop-color:${fillColor};stop-opacity:0.3" /></linearGradient></defs><rect x="0" y="5" width="16" height="6" fill="url(#${gradId})"/></svg>`;
                    } else {
                        // Circle - represents word
                        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="${fillColor}"/></svg>`;
                    }
                    item.iconPath = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
                } else {
                    item.iconPath = new vscode.ThemeIcon('pass-filled');
                }
            } else {
                item.iconPath = new vscode.ThemeIcon('circle-large-outline');
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

    dropMimeTypes = ['application/vnd.code.tree.logmagnifier-filters'];
    dragMimeTypes = ['application/vnd.code.tree.logmagnifier-filters'];

    public handleDrag(source: readonly TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const item = source[0];
        if (!this.isGroup(item)) {
            dataTransfer.set('application/vnd.code.tree.logmagnifier-filters', new vscode.DataTransferItem(item));
        }
    }

    public handleDrop(target: TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        if (token.isCancellationRequested || !target) {
            return;
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.logmagnifier-filters');
        if (!transferItem) {
            return;
        }

        const activeItem = transferItem.value as FilterItem;
        let targetItem = target;

        // Cannot drop a group
        if (this.isGroup(activeItem)) {
            return;
        }

        const groups = this.filterManager.getGroups();
        const activeGroup = groups.find(g => g.filters.some(f => f.id === activeItem.id));

        if (!activeGroup) {
            return;
        }

        // Case 1: Dropping on a Group
        if (this.isGroup(targetItem)) {
            // Must be the same group (or we could allow moving to different group here easily)
            if (activeGroup.id !== targetItem.id) {
                // For now, restrict to same group or allow move?
                // The requirements didn't specify, but reordering within group is priority.
                // If dropping on valid group, let's allow moving to it (reparenting)!
                // But I haven't implemented cross-group move in Manager yet. 
                // Wait, moveFilter assumes same group logic in my previous implementation:
                // "const group = this.groups.find(g => g.id === groupId);"
                // So I can't support cross-group move with current `moveFilter`.
                // So I must ensure target group is the same.
                if (targetItem.id !== activeGroup.id) {
                    return;
                }
            }
            // Move to end of list
            this.filterManager.moveFilter(activeGroup.id, activeItem.id, activeGroup.filters[activeGroup.filters.length - 1].id, 'after');
            return;
        }

        // Case 2: Dropping on an Item
        const targetGroup = groups.find(g => g.filters.some(f => f.id === targetItem.id));

        if (!targetGroup || activeGroup.id !== targetGroup.id) {
            return;
        }

        if (activeItem.id === targetItem.id) {
            return;
        }

        this.filterManager.moveFilter(activeGroup.id, activeItem.id, targetItem.id, 'after');
    }

    private isGroup(item: any): item is FilterGroup {
        return (item as FilterGroup).filters !== undefined;
    }
}
