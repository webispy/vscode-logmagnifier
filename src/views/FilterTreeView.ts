import * as vscode from 'vscode';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup, FilterItem } from '../models/Filter';

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

            const svg = this.generateGroupSvg(folderColor, overlayColor);
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

                    const svg = this.generateExcludeSvg(fillColor, strokeColor, style);
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
                    const svg = this.generateIncludeSvg(fillColor, mode, element.id);
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
                const svg = this.generateOffSvg(textColor);
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
        let targetItem = target;

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

    private generateGroupSvg(folderColor: string, overlayColor?: string): string {
        const folderPath = `<path d="M7.5 2.5 L9.5 4.5 H14.5 V13.5 H1.5 V2.5 H7.5 Z" fill="none" stroke="${folderColor}" stroke-width="1" stroke-linejoin="round" />`;

        if (!overlayColor) {
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderPath}</svg>`;
        }

        // Mask (Cutout) to hide folder lines behind the overlay
        // Overlay center is at (12, 12) (8 offset + 8 center * 0.5 scale = 12)
        // Radius 4.5 ensures a small gap around the 16*0.5=8px icon
        const mask = `
            <defs>
                <mask id="cutout-mask">
                    <rect width="100%" height="100%" fill="white"/>
                    <circle cx="12" cy="12" r="5" fill="black"/>
                </mask>
            </defs>
        `;

        // Apply mask to folder path
        const maskedFolderPath = `<g mask="url(#cutout-mask)">${folderPath}</g>`;

        // Overlay: Circle-slash (Ban) icon, scaled 0.5 and positioned at bottom-right
        const banPath = `<path d="M11.8746 3.41833C9.51718 1.42026 5.98144 1.53327 3.75736 3.75736C1.53327 5.98144 1.42026 9.51719 3.41833 11.8746L11.8746 3.41833ZM12.5817 4.12543L4.12543 12.5817C6.48282 14.5797 10.0186 14.4667 12.2426 12.2426C14.4667 10.0186 14.5797 6.48282 12.5817 4.12543ZM3.05025 3.05025C5.78392 0.316582 10.2161 0.316582 12.9497 3.05025C15.6834 5.78392 15.6834 10.2161 12.9497 12.9497C10.2161 15.6834 5.78392 15.6834 3.05025 12.9497C0.316583 10.2161 0.316582 5.78392 3.05025 3.05025Z" fill="${overlayColor}" transform="translate(8, 8) scale(0.5)"/>`;

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            ${mask}
            ${maskedFolderPath}
            ${banPath}
        </svg>`;
    }

    private generateOffSvg(textColor: string): string {
        // Text "OFF" centered, no border
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text x="50%" y="11.5" font-family="Arial, sans-serif" font-size="7" font-weight="bold" fill="${textColor}" text-anchor="middle">OFF</text>
        </svg>`;
    }

    private generateExcludeSvg(fillColor: string, strokeColor: string, style: string): string {
        if (style === 'hidden') {
            // Dotted box to represent hidden text (ghost text)
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                <rect x="1" y="4" width="14" height="8" rx="2" fill="none" stroke="${strokeColor}" stroke-width="1.0" stroke-dasharray="3,2"/>
            </svg>`;
        }
        // Create a strike-through icon with gap
        // Text 'abc' represents the word, Line represents the strike
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text x="50%" y="11" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="${fillColor}" text-anchor="middle">abc</text>
            <line x1="0" y1="8" x2="16" y2="8" stroke="${strokeColor}" stroke-width="1.5" />
        </svg>`;
    }

    private generateIncludeSvg(fillColor: string, mode: number, elementId: string): string {
        const isTransparent = fillColor === 'rgba(0,0,0,0)' || fillColor === 'rgba(0, 0, 0, 0)' || fillColor === 'transparent';
        const strokeColor = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? '#cccccc' : '#333333';
        const strokeAttr = `stroke="${strokeColor}" stroke-width="1.0" fill="none"`;
        const fillAttr = `fill="${fillColor}"`;

        if (mode === 1) {
            // Rounded box (pill shape) - represents line text only
            const attr = isTransparent ? strokeAttr : fillAttr;
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="5" width="14" height="6" rx="3" ry="3" ${attr}/></svg>`;
        } else if (mode === 2) {
            // Wide rectangle with gradient to represent full line width
            // For transparent, we just use a box outline
            if (isTransparent) {
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="0.5" y="5" width="15" height="6" ${strokeAttr}/></svg>`;
            }
            const gradId = `grad_${elementId.replace(/[^a-zA-Z0-9]/g, '')}`;
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="70%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="100%" style="stop-color:${fillColor};stop-opacity:0.3" /></linearGradient></defs><rect x="0" y="5" width="16" height="6" fill="url(#${gradId})"/></svg>`;
        }
        // Circle - represents word
        const attr = isTransparent ? strokeAttr : fillAttr;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" ${attr}/></svg>`;
    }

    private isGroup(item: TreeItem): item is FilterGroup {
        return (item as FilterGroup).filters !== undefined;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
