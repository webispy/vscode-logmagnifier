
import * as vscode from 'vscode';
import { LogcatService } from '../services/LogcatService';
import { AdbDevice, LogcatSession, LogcatTag, LogcatTreeItem, TargetAppItem, SessionGroupItem, ControlAppItem, ControlActionItem } from '../models/LogcatModels';


export class LogcatTreeProvider implements vscode.TreeDataProvider<LogcatTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LogcatTreeItem | undefined | null | void> = new vscode.EventEmitter<LogcatTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LogcatTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private devices: AdbDevice[] = [];

    constructor(private logcatService: LogcatService) {
        this.logcatService.onDidChangeSessions(() => this.refresh());
        // Deferred initialization: devices are fetched via initialize()
    }

    public initialize() {
        this.refreshDevices();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async refreshDevices(): Promise<void> {
        this.devices = await this.logcatService.getDevices();
        this.refresh();
    }

    getTreeItem(element: LogcatTreeItem): vscode.TreeItem {
        if (this.isDevice(element)) {
            const item = new vscode.TreeItem(`${element.model || 'Unknown'} (${element.id})`, vscode.TreeItemCollapsibleState.Expanded);
            item.description = element.type;
            item.iconPath = new vscode.ThemeIcon('device-mobile');
            item.contextValue = 'device';
            return item;
        } else if (this.isTargetApp(element)) {
            const app = element.device.targetApp || 'all';
            const item = new vscode.TreeItem(`Target app: ${app}`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('symbol-method');
            item.command = {
                command: 'logmagnifier.pickTargetApp',
                title: 'Select Target App',
                arguments: [element]
            };
            item.tooltip = 'Click to select target application';
            return item;
        } else if (this.isSessionGroup(element)) {
            const item = new vscode.TreeItem('Logcat Sessions', vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'sessionGroup';
            // Find if there are any sessions to maybe affect icon? No need.
            return item;
        } else if (this.isSession(element)) {
            const stateIcon = element.isRunning ? 'debug-stop' : 'play';
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
            item.description = element.isRunning ? '(Running)' : '';
            item.iconPath = new vscode.ThemeIcon(stateIcon);
            const timeContext = (element.useStartFromCurrentTime !== false) ? 't1' : 'full';
            const runContext = element.isRunning ? 'session_running' : 'session_stopped';
            item.contextValue = `${runContext}_${timeContext}`;

            const timeFilterStatus = (element.useStartFromCurrentTime !== false)
                ? "With history: none (Click icon to change)"
                : "With history: yes (Click icon to change)";
            item.tooltip = `${element.name}\nStatus: ${element.isRunning ? 'Running' : 'Stopped'}\n${timeFilterStatus}`;

            return item;
        } else if (this.isControlApp(element)) {
            const item = new vscode.TreeItem('Control app', vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'controlApp';
            item.iconPath = new vscode.ThemeIcon('tools');
            return item;
        } else if (this.isControlAction(element)) {
            let label = '';
            let icon = '';
            let commandId = '';

            switch (element.actionType) {
                case 'uninstall':
                    label = 'Uninstall';
                    icon = 'trash';
                    commandId = 'logmagnifier.control.uninstall';
                    break;
                case 'clearStorage':
                    label = 'Clear storage';
                    icon = 'database';
                    commandId = 'logmagnifier.control.clearStorage';
                    break;
                case 'clearCache':
                    label = 'Clear cache';
                    icon = 'archive';
                    commandId = 'logmagnifier.control.clearCache';
                    break;
            }

            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon(icon);
            item.contextValue = 'controlAction';
            item.command = {
                command: commandId,
                title: label,
                arguments: [element]
            };
            return item;
        } else if (this.isTag(element)) {
            const item = new vscode.TreeItem(`${element.name}:${element.priority}`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('tag');

            // Find parent session
            const session = this.logcatService.getSessions().find(s => s.tags.includes(element));
            if (session && session.isRunning) {
                item.contextValue = 'tag_readonly';
                item.description = '(Locked)';
            } else {
                item.contextValue = 'tag_editable';
            }
            return item;
        }
        return new vscode.TreeItem('Unknown');
    }

    getChildren(element?: LogcatTreeItem): vscode.ProviderResult<LogcatTreeItem[]> {
        if (!element) {
            return this.devices;
        } else if (this.isDevice(element)) {
            // Return TargetApp, potentially ControlApp, and SessionGroup
            const children: LogcatTreeItem[] = [
                { type: 'targetApp', device: element } as TargetAppItem
            ];

            if (element.targetApp && element.targetApp !== 'all') {
                children.push({ type: 'controlApp', device: element } as ControlAppItem);
            }

            children.push({ type: 'sessionGroup', device: element } as SessionGroupItem);
            return children;
        } else if (this.isControlApp(element)) {
            return [
                { type: 'controlAction', actionType: 'uninstall', device: element.device } as ControlActionItem,
                { type: 'controlAction', actionType: 'clearStorage', device: element.device } as ControlActionItem,
                { type: 'controlAction', actionType: 'clearCache', device: element.device } as ControlActionItem
            ];
        } else if (this.isSessionGroup(element)) {
            return this.logcatService.getSessions().filter(s => s.device.id === element.device.id);
        } else if (this.isSession(element)) {
            return element.tags;
        }
        return [];
    }

    // Type guards
    private isDevice(element: LogcatTreeItem): element is AdbDevice {
        return 'id' in element && 'type' in element && 'model' in element && !('priority' in element) && !('tags' in element);
    }

    private isTargetApp(element: LogcatTreeItem): element is TargetAppItem {
        return 'type' in element && element.type === 'targetApp';
    }

    private isSessionGroup(element: LogcatTreeItem): element is SessionGroupItem {
        return 'type' in element && element.type === 'sessionGroup';
    }

    private isSession(element: LogcatTreeItem): element is LogcatSession {
        return 'tags' in element && 'device' in element && 'isRunning' in element;
    }

    private isTag(element: LogcatTreeItem): element is LogcatTag {
        return 'priority' in element && 'isEnabled' in element && 'name' in element;
    }

    private isControlApp(element: LogcatTreeItem): element is ControlAppItem {
        return 'type' in element && element.type === 'controlApp';
    }

    private isControlAction(element: LogcatTreeItem): element is ControlActionItem {
        return 'type' in element && element.type === 'controlAction';
    }
}
