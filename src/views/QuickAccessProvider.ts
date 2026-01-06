import * as vscode from 'vscode';
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
            this.createToggleItem('Word Wrap', isWordWrapOn, 'logmagnifier.toggleWordWrap', 'word-wrap'),
            this.createToggleItem('Minimap', !!minimapEnabled, 'logmagnifier.toggleMinimap', 'layout-sidebar-right'),
            this.createToggleItem('Sticky Scroll', !!stickyScrollEnabled, 'logmagnifier.toggleStickyScroll', 'pinned')
        ]);
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
}
