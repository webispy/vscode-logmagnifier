import * as vscode from 'vscode';
import * as fs from 'fs';
import { Constants } from '../constants';
import { Logger } from '../services/Logger';

export class QuickAccessProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        Logger.getInstance().info('QuickAccessProvider.refresh() called');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        // Use active text editor config scope if available, otherwise global
        const scope = vscode.window.activeTextEditor?.document.uri;
        const config = vscode.workspace.getConfiguration('editor', scope);

        const wordWrap = config.get<string>('wordWrap');
        Logger.getInstance().info(`Word Wrap state: ${wordWrap}`);
        const isWordWrapOn = wordWrap !== 'off';

        const minimapEnabled = config.get<boolean>('minimap.enabled');
        Logger.getInstance().info(`Minimap state: ${minimapEnabled}`);

        const stickyScrollEnabled = config.get<boolean>('stickyScroll.enabled');
        Logger.getInstance().info(`Sticky Scroll state: ${stickyScrollEnabled}`);

        return Promise.resolve([
            this.createToggleItem(Constants.Labels.WordWrap, isWordWrapOn, Constants.Commands.ToggleWordWrap, 'word-wrap'),
            this.createToggleItem(Constants.Labels.Minimap, !!minimapEnabled, Constants.Commands.ToggleMinimap, 'layout-sidebar-right'),
            this.createToggleItem(Constants.Labels.StickyScroll, !!stickyScrollEnabled, Constants.Commands.ToggleStickyScroll, 'pinned'),
            this.createFileSizeItem()
        ]);
    }

    private _fileSizeUnit: 'bytes' | 'kb' | 'mb' = 'bytes';

    public toggleFileSizeUnit(): void {
        const size = this.getFileSize();
        // If undefined (error/no file), just toggle blindly or do nothing? 
        // If we can't determine size, we can't check for 0. Let's assume size is 0 if undefined.
        const safeSize = size ?? 0;

        const order: ('bytes' | 'kb' | 'mb')[] = ['bytes', 'kb', 'mb'];
        const currentIndex = order.indexOf(this._fileSizeUnit);

        // Find next valid unit
        for (let i = 1; i <= order.length; i++) {
            const nextIndex = (currentIndex + i) % order.length;
            const nextUnit = order[nextIndex];

            if (nextUnit === 'bytes') {
                this._fileSizeUnit = 'bytes';
                break;
            }

            let value = 0;
            if (nextUnit === 'kb') {
                value = safeSize / 1024;
            } else if (nextUnit === 'mb') {
                value = safeSize / (1024 * 1024);
            }

            // Check if it is at least 1 unit (preventing 0.8 MB -> 1 MB switch)
            if (value >= 1) {
                this._fileSizeUnit = nextUnit;
                break;
            }
            // If 0, continue to next unit in loop
        }

        this.refresh();
    }

    private getFileSize(): number | undefined {
        const editor = vscode.window.activeTextEditor;

        // 1. Try active text editor
        if (editor) {
            if (editor.document.uri.scheme === 'file') {
                try {
                    const stats = fs.statSync(editor.document.uri.fsPath);
                    return stats.size;
                } catch (e) {
                    Logger.getInstance().error(`Error getting file size: ${e}`);
                }
            } else if (editor.document.uri.scheme === 'untitled') {
                return editor.document.getText().length;
            }
        }

        // 2. Fallback: Check active tab
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab && activeTab.input instanceof vscode.TabInputText) {
            const uri = activeTab.input.uri;
            if (uri.scheme === 'file') {
                try {
                    const stats = fs.statSync(uri.fsPath);
                    return stats.size;
                } catch (e) {
                    Logger.getInstance().error(`Error getting file size from tab: ${e}`);
                }
            }
        }

        return undefined;
    }

    private createToggleItem(label: string, isEnabled: boolean, commandId: string, iconId: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        // item.description = isEnabled ? 'On' : 'Off'; // Moved to label for clarity
        item.iconPath = new vscode.ThemeIcon(iconId);
        // Add a visual indicator for state beyond just text
        // We could use checkmark icon overlay, but for now Description + ContextValue is good.
        // Or we could change the icon color via ThemeColor if VS Code API supported it easily on TreeItems.
        // Let's stick to standard icons but maybe change the icon itself if off? 
        // User requested "buttons", so keeping the semantic icon is better.

        item.command = {
            command: commandId,
            title: `Toggle ${label}`,
            arguments: []
        };

        const stateLabel = isEnabled ? 'On' : 'Off';
        item.label = `${label}: ${stateLabel}`;

        return item;
    }

    private createFileSizeItem(): vscode.TreeItem {
        const size = this.getFileSize();
        const hasFile = size !== undefined;
        // Default to 0 if undefined for safety in calculations, though logic handles hasFile check
        const safeSize = size ?? 0;

        let label = `${Constants.Labels.FileSize}: ${Constants.Labels.NA}`;
        if (hasFile) {
            let value = '';
            let unit = '';

            switch (this._fileSizeUnit) {
                case 'bytes':
                    value = safeSize.toLocaleString();
                    unit = Constants.Labels.Bytes;
                    break;
                case 'kb':
                    value = (safeSize / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 });
                    unit = Constants.Labels.KB;
                    break;
                case 'mb':
                    value = (safeSize / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 0 });
                    unit = Constants.Labels.MB;
                    break;
            }
            label = `${Constants.Labels.FileSize}: ${value} ${unit}`;
        }

        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('database');
        item.command = {
            command: Constants.Commands.ToggleFileSizeUnit,
            title: 'Toggle Unit',
            arguments: []
        };

        // Disable if no file
        if (!hasFile) {
            item.command = undefined;
            item.tooltip = 'No active file';
        } else {
            item.tooltip = 'Click to switch unit (Bytes / KB / MB)';
        }

        return item;
    }
}
