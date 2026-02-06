import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShellConfig, ShellGroup, ShellFolder, ShellCommand, ShellItem, ShellFolderConfig, ShellCommandConfig } from '../models/ShellCommander';
import { Constants } from '../constants';
import { Logger } from './Logger';

export class ShellCommanderService {
    private _groups: ShellGroup[] = [];
    private _onDidChangeTreeData: vscode.EventEmitter<ShellItem | undefined | null | void> = new vscode.EventEmitter<ShellItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShellItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {
        if (this.configPaths.length === 0) {
            this.createDefaultConfig();
        }
        this.loadConfig();
    }

    private get configPaths(): string[] {
        return this.context.globalState.get<string[]>(Constants.GlobalState.ShellConfigPaths, []);
    }

    private set configPaths(paths: string[]) {
        this.context.globalState.update(Constants.GlobalState.ShellConfigPaths, paths);
    }

    get groups(): ShellGroup[] {
        return this._groups;
    }

    public isConfigRegistered(filePath: string): boolean {
        return this.configPaths.includes(filePath);
    }

    public async refresh(): Promise<void> {
        await this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    private getDefaultConfig(): ShellConfig {
        return {
            groupName: 'Any Group',
            descript: "hello world. This is Shell Commander. You can freely use it for executing any scripts.",
            folders: [
                {
                    name: 'Simple',
                    commands: [
                        { label: 'single cmd', command: 'echo hiyo' },
                        { label: 'multi cmds', command: "clear\njava -version\nls -l\n# comments\mecho 'what are you doing" }
                    ]
                }
            ]
        };
    }

    private createDefaultConfig() {
        // Ensure storage directory exists
        if (!fs.existsSync(this.context.globalStorageUri.fsPath)) {
            fs.mkdirSync(this.context.globalStorageUri.fsPath, { recursive: true });
        }

        const defaultPath = path.join(this.context.globalStorageUri.fsPath, 'logmagnifier_shell_cmds.json');
        const config = this.getDefaultConfig();

        this.saveConfigToFile(defaultPath, config);
        this.addConfigPath(defaultPath);
    }

    public async createGroup(name: string, filePath: string): Promise<void> {
        if (this._groups.find(g => g.label === name)) {
            throw new Error(`Group '${name}' already exists.`);
        }

        const newConfig: ShellConfig = {
            groupName: name,
            descript: "hello world. It is Shell Commander.",
            folders: []
        };

        let configs: ShellConfig[] = [];

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const json = JSON.parse(content);
                if (Array.isArray(json)) {
                    configs = json;
                } else if (json && typeof json === 'object') {
                    configs = [json];
                }
            } catch (_e) {
                // If file is corrupt or empty, start fresh
                configs = [];
            }
        }

        // Check for duplicate in file (though global check above should cover loaded ones)
        if (configs.find(c => c.groupName === name)) {
            throw new Error(`Group '${name}' already exists in file.`);
        }

        configs.push(newConfig);

        try {
            this.saveConfigToFile(filePath, configs);
            this.addConfigPath(filePath);
            await this.loadGroup(filePath);
            this._onDidChangeTreeData.fire();
        } catch (e) {
            throw new Error(`Failed to save group to file: ${e}`);
        }
    }

    public async importGroup(filePath: string): Promise<void> {
        if (this.configPaths.includes(filePath)) {
            throw new Error('This configuration file is already imported.');
        }

        try {
            await this.loadGroup(filePath); // Validate and load
            this.addConfigPath(filePath);
            this._onDidChangeTreeData.fire();
        } catch (error) {
            Logger.getInstance().error(`Failed to import group from ${filePath}: ${error}`);
            throw error;
        }
    }

    public async deleteGroup(group: ShellGroup): Promise<void> {
        const filePath = group.configPath;
        if (!fs.existsSync(filePath)) {
            this.removeGroup(group);
            return;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const json = JSON.parse(content);
            let configs: ShellConfig[] = [];

            if (Array.isArray(json)) {
                configs = json;
            } else if (json && typeof json === 'object') {
                configs = [json];
            }

            const updatedConfigs = configs.filter(c => c.groupName !== group.label);

            if (updatedConfigs.length === 0) {
                // If it's the last group in the file, write empty array and stop tracking file
                fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf-8');
                this.removeConfigPath(filePath);
            } else {
                fs.writeFileSync(filePath, JSON.stringify(updatedConfigs, null, 2), 'utf-8');
            }

            const index = this._groups.indexOf(group);
            if (index !== -1) {
                this._groups.splice(index, 1);
            }
            this._onDidChangeTreeData.fire();
        } catch (e) {
            Logger.getInstance().error(`Failed to delete group '${group.label}': ${e}`);
            throw e;
        }
    }

    public removeGroup(group: ShellGroup): void {
        const index = this._groups.indexOf(group);
        if (index !== -1) {
            this._groups.splice(index, 1);
            this.removeConfigPath(group.configPath);
            this._onDidChangeTreeData.fire();
        }
    }

    public async resetToDefault(): Promise<void> {
        this._groups = [];
        const defaultPath = path.join(this.context.globalStorageUri.fsPath, 'logmagnifier_shell_cmds.json');
        this.configPaths = [defaultPath];

        const config = this.getDefaultConfig();
        this.saveConfigToFile(defaultPath, config);

        await this.refresh();
    }

    public async reloadGroup(filePath: string): Promise<void> {
        await this.loadGroup(filePath);
        this._onDidChangeTreeData.fire();
    }

    public async addFolder(parent: ShellGroup | ShellFolder, name: string): Promise<void> {
        // 1. Resolve Root and Path
        const root = this.getRootGroup(parent);
        const pathFromRoot = this.getPathFromRoot(parent);

        // 2. Find Live Root
        const liveRoot = this._groups.find(g => g.id === root.id || g.label === root.label);
        if (!liveRoot) {
            throw new Error("Target group not found in active configuration.");
        }

        // 3. Resolve Target Parent in Live Root
        let targetParent: ShellGroup | ShellFolder = liveRoot;

        // Skip the root matching segment
        if (pathFromRoot.length > 0 && pathFromRoot[0] === liveRoot.label) {
            pathFromRoot.shift();
        }

        for (const segmentName of pathFromRoot) {
            const found = targetParent.children.find(c => c.kind === 'folder' && c.label === segmentName) as ShellFolder;
            if (!found) {
                throw new Error(`Target parent '${segmentName}' not found in group '${liveRoot.label}'.`);
            }
            targetParent = found;
        }

        const newFolder: ShellFolder = {
            id: this.generateId([...pathFromRoot, name]),
            type: 'folder',
            kind: 'folder',
            label: name,
            children: [],
            parent: targetParent
        };

        targetParent.children.push(newFolder);

        Logger.getInstance().info(`[addFolder] Successfully added folder '${name}' to '${targetParent.label}'`);

        const configPath = (liveRoot as ShellGroup).configPath;
        this.saveGroup(liveRoot);
        await this.loadGroup(configPath);
        this._onDidChangeTreeData.fire();
    }
    public async addCommand(parent: ShellGroup | ShellFolder, label: string, command: string): Promise<void> {
        const root = this.getRootGroup(parent);
        if (!root) {
            throw new Error("Could not find root group for parent");
        }

        if (this.hasChildWithLabel(parent, label)) {
            vscode.window.showErrorMessage(`Item with label '${label}' already exists in this folder.`);
            return;
        }

        const targetFolder = parent as ShellFolder;

        // Command is now strictly string.
        const pathFromRoot = this.getPathFromRoot(parent);
        const newCommand: ShellCommand = {
            id: this.generateId([...pathFromRoot, label]),
            type: 'command',
            kind: 'command',
            label: label,
            command: command,
            parent: targetFolder
        };

        targetFolder.children.push(newCommand);
        targetFolder.children.sort((a, b) => {
            if (a.kind === b.kind) {
                return a.label.localeCompare(b.label);
            }
            return a.kind === 'folder' ? -1 : 1;
        });

        this.saveGroup(root);
        await this.loadGroup(root.configPath);
        this._onDidChangeTreeData.fire();
    }

    private getPathFromRoot(item: ShellItem): string[] {
        const pathSegments: string[] = [];
        let current: ShellItem | undefined = item;
        while (current) {
            pathSegments.unshift(current.label);
            current = current.parent as ShellItem | undefined;
        }
        return pathSegments;
    }

    public async updateItem(item: ShellCommand | ShellFolder, changes: { label?: string, command?: string }): Promise<void> {
        if (changes.label) {
            item.label = changes.label;
        }
        if (item.kind === 'command' && changes.command !== undefined) {
            item.command = changes.command;
        }

        const root = this.getRootGroup(item);
        this.saveGroup(root);
        await this.loadGroup(root.configPath);
        this._onDidChangeTreeData.fire();
    }

    public async deleteItem(item: ShellCommand | ShellFolder): Promise<void> {
        const parent = item.parent;
        if (!parent) {
            return;
        }

        const p = parent as ShellFolder;

        if (p.children && Array.isArray(p.children)) {
            const idx = p.children.findIndex((c: ShellItem) => c.id === item.id);
            if (idx !== -1) {
                p.children.splice(idx, 1);
            }
        }

        const root = this.getRootGroup(parent as ShellItem);
        this.saveGroup(root);
        await this.loadGroup(root.configPath);
        this._onDidChangeTreeData.fire();
    }

    private getRootGroup(item: ShellItem): ShellGroup {
        let current = item;
        while (current.parent) {
            current = current.parent as ShellItem;
        }
        if (current.kind !== 'group') {
            throw new Error("Item does not belong to a valid group");
        }
        return current as ShellGroup;
    }

    private generateId(path: string[]): string {
        return path.join('/');
    }

    private hasChildWithLabel(parent: ShellGroup | ShellFolder, label: string): boolean {
        return parent.children.some(c => c.label === label);
    }

    private addConfigPath(filePath: string) {
        const paths = this.configPaths;
        if (!paths.includes(filePath)) {
            paths.push(filePath);
            this.configPaths = paths;
        }
    }

    private removeConfigPath(filePath: string) {
        const paths = this.configPaths.filter(p => p !== filePath);
        this.configPaths = paths;
    }

    public async loadConfig(): Promise<void> {
        this._groups = [];
        const paths = this.configPaths;
        for (const p of paths) {
            try {
                await this.loadGroup(p);
            } catch (err) {
                Logger.getInstance().error(`Error loading shell config from ${p}: ${err}`);
            }
        }
    }

    private async loadGroup(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            Logger.getInstance().warn(`Shell config file not found: ${filePath}`);
            return;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const json = JSON.parse(content);

            let configs: ShellConfig[] = [];
            if (Array.isArray(json)) {
                configs = json;
            } else {
                configs = [json as ShellConfig];
            }

            for (const config of configs) {
                if (!config.groupName) {
                    continue;
                }

                // Skip if already loaded via another file?
                // Currently we allow same group name if different file, but here unified storage means same file has multiple.
                // We should check if this specific group from this file is already loaded to avoid duplicates if reload happens?
                // actually this._groups check below handles logic.

                const group: ShellGroup = {
                    id: this.generateId([config.groupName]),
                    type: 'group',
                    kind: 'group',
                    label: config.groupName,
                    description: config.descript || "hello world. It is Shell Commander.",
                    configPath: filePath,
                    children: []
                };

                if (config.folders) {
                    group.children = this.mapConfigFoldersToModel(config.folders, group);
                }
                const existingIdx = this._groups.findIndex(g => g.label === group.label);
                if (existingIdx !== -1) {
                    // Update existing group
                    this._groups[existingIdx] = group;
                } else {
                    this._groups.push(group);
                }
            }
        } catch (e) {
            Logger.getInstance().error(`Invalid JSON format in ${filePath}: ${e}`);
        }
    }

    private mapConfigFoldersToModel(folders: ShellFolderConfig[], parent: ShellGroup | ShellFolder): ShellFolder[] {
        return folders.map(f => {
            const folderPath = [...this.getPathFromRoot(parent), f.name];
            const folder: ShellFolder = {
                id: this.generateId(folderPath),
                type: 'folder',
                kind: 'folder',
                label: f.name,
                description: f.descript,
                parent: parent,
                children: []
            };

            const subFolders = f.folders ? this.mapConfigFoldersToModel(f.folders, folder) : [];
            const commands = f.commands ? this.mapConfigCommandsToModel(f.commands, folder) : [];

            folder.children = [...subFolders, ...commands];
            return folder;
        });
    }

    private mapConfigCommandsToModel(commands: ShellCommandConfig[], parent: ShellFolder): ShellCommand[] {
        return commands.map(c => {
            // Handle legacy array if present in JSON by joining?
            // Users might have old config.
            let safeCommand = "";
            if (Array.isArray(c.command)) {
                safeCommand = (c.command as string[]).join('\n');
            } else {
                safeCommand = c.command || "";
            }

            const commandPath = [...this.getPathFromRoot(parent), c.label];

            return {
                id: this.generateId(commandPath),
                type: 'command',
                kind: 'command',
                label: c.label,
                command: safeCommand,
                parent: parent
            };
        });
    }

    private saveGroup(group: ShellGroup) {
        const config: ShellConfig = {
            groupName: group.label,
            descript: group.description || "hello world. It is shell commander.",
            folders: this.mapModelFoldersToConfig(group.children.filter(child => child.kind === 'folder') as ShellFolder[])
        };

        const filePath = group.configPath;

        try {
            let configs: ShellConfig[] = [];

            // Read existing file to preserve other groups
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const json = JSON.parse(content);
                    if (Array.isArray(json)) {
                        configs = json;
                    } else if (json && typeof json === 'object') {
                        // Legacy single object.
                        // If saving the same group name, we overwrite (will become array of 1).
                        // If saving different group name, we keep old as element 0.
                        if (json.groupName !== group.label) {
                            configs = [json];
                        } else {
                            configs = [];
                        }
                    }
                } catch (_readErr) {
                    // Ignore read error, overwrite
                }
            }

            // Update or Add
            const existingIdx = configs.findIndex(c => c.groupName === group.label);
            if (existingIdx !== -1) {
                configs[existingIdx] = config;
            } else {
                configs.push(config);
            }

            this.saveConfigToFile(filePath, configs);
        } catch (e) {
            Logger.getInstance().error(`Failed to save shell config to ${filePath}: ${e}`);
            vscode.window.showErrorMessage(`Failed to save shell configuration: ${e}`);
        }
    }

    private saveConfigToFile(filePath: string, config: ShellConfig | ShellConfig[]) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
        } catch (e) {
            Logger.getInstance().error(`Failed to save shell config to ${filePath}: ${e}`);
            vscode.window.showErrorMessage(`Failed to save shell configuration: ${e}`);
        }
    }

    private mapModelFoldersToConfig(folders: (ShellFolder | ShellCommand)[]): ShellFolderConfig[] {
        return folders
            .filter(item => item.kind === 'folder') // Filter to keep only folders
            .map(item => {
                const f = item as ShellFolder;
                const subFolders = f.children.filter(c => c.kind === 'folder') as ShellFolder[];
                const commands = f.children.filter(c => c.kind === 'command') as ShellCommand[];

                const config: ShellFolderConfig = {
                    name: f.label,
                    descript: f.description
                };

                if (subFolders.length > 0) {
                    // Recursive call needs to match type
                    config.folders = this.mapModelFoldersToConfig(subFolders);
                }
                if (commands.length > 0) {
                    config.commands = commands.map(c => ({
                        label: c.label,
                        command: c.command
                    }));
                }
                return config;
            });
    }

    public async updateGroupDescription(group: ShellGroup, content: string): Promise<void> {
        group.description = content;
        this.saveGroup(group);
        await this.loadGroup(group.configPath);
        this._onDidChangeTreeData.fire();
    }

    // Helper to update folder description too
    public async updateFolderDescription(folder: ShellFolder, content: string): Promise<void> {
        folder.description = content;
        const root = this.getRootGroup(folder);
        this.saveGroup(root);
        await this.loadGroup(root.configPath);
        this._onDidChangeTreeData.fire();
    }

    public getAllGroupsConfigs(): ShellConfig[] {
        return this._groups.map(group => ({
            groupName: group.label,
            descript: group.description || "hello world. It is shell commander.",
            folders: this.mapModelFoldersToConfig(group.children.filter(child => child.kind === 'folder') as ShellFolder[])
        }));
    }
    public async renameGroup(group: ShellGroup, newName: string): Promise<void> {
        const filePath = group.configPath;
        if (!fs.existsSync(filePath)) {
            throw new Error(`Configuration file not found: ${filePath}`);
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const json = JSON.parse(content);
            let configs: ShellConfig[] = [];

            if (Array.isArray(json)) {
                configs = json;
            } else if (json && typeof json === 'object') {
                configs = [json];
            }

            const targetConfigIndex = configs.findIndex(c => c.groupName === group.label);
            if (targetConfigIndex === -1) {
                // It might be a legacy single file where filename was the key, but we loaded it.
                // If single object and groupName matches, it's index 0.
                if (configs.length === 1 && configs[0].groupName === group.label) {
                    // match found
                } else {
                    throw new Error(`Group '${group.label}' not found in configuration file.`);
                }
            }

            // Check if new name exists in file (except self)
            if (configs.some((c, idx) => c.groupName === newName && idx !== targetConfigIndex)) {
                throw new Error(`Group '${newName}' already exists in this file.`);
            }

            // Update Name
            if (targetConfigIndex !== -1) {
                configs[targetConfigIndex].groupName = newName;
            }

            this.saveConfigToFile(filePath, configs);

            // Remove old group instance to prevent duplication or stale state
            const index = this._groups.indexOf(group);
            if (index !== -1) {
                this._groups.splice(index, 1);
            }

            // Reload to reflect changes
            await this.loadGroup(filePath);
            this._onDidChangeTreeData.fire();
        } catch (e) {
            throw new Error(`Failed to rename group: ${e}`);
        }
    }
}
