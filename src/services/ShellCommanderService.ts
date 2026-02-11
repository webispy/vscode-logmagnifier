import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShellConfig, ShellGroup, ShellFolder, ShellCommand, ShellItem, ShellFolderConfig, ShellCommandConfig, ShellShortCutKeymap, ShellSystemConfig } from '../models/ShellCommander';
import { Constants } from '../constants';
import { Logger } from './Logger';

export class ShellCommanderService {
    private _groups: ShellGroup[] = [];
    private _globalKeymap: ShellShortCutKeymap | undefined;
    private _onDidChangeTreeData: vscode.EventEmitter<ShellItem | undefined | null | void> = new vscode.EventEmitter<ShellItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShellItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private readonly DEFAULT_KEYMAP: ShellShortCutKeymap = {
        kbCreateGroup: 'g',
        kbCreateFolder: 'f',
        kbCreateCommand: 'c',
        kbDelete: 'd',
        kbEdit: 'e',
        kbView: 'i'
    };

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

    public getKeymap(): ShellShortCutKeymap | undefined {
        // Return global keymap if loaded, otherwise default
        return this._globalKeymap || this.DEFAULT_KEYMAP;
    }

    public isConfigRegistered(filePath: string): boolean {
        return this.configPaths.includes(filePath);
    }

    public async refresh(): Promise<void> {
        await this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    private getDefaultConfig(): ShellSystemConfig {
        return {
            version: 1,
            shortCutKeymap: this.DEFAULT_KEYMAP,
            groups: [
                {
                    groupName: "android",
                    descript: "# Group: android\n\n## Folders\n- **adb - common**\n- **adb - adot auto app**\n- **OEM Guide Collection - RK project**\n",
                    folders: [
                        {
                            name: "adb - common",
                            descript: "# adb",
                            commands: [
                                {
                                    label: "Check Memory Leak (HPROF Dump)",
                                    command: "# Create a heap dump of the current app and pull it to the PC.\npackage=\"com.example.myapp\"\n\n# 1. Create Heap Dump\nadb shell am dumpheap $package /data/local/tmp/android.hprof\n\n# 2. Pull File\nadb pull /data/local/tmp/android.hprof .\n\n# 3. Delete Temp File\nadb shell rm /data/local/tmp/android.hprof\n\n# 4. Convert for Android Studio (Optional)\n# hprof-conv android.hprof converted.hprof"
                                },
                                {
                                    label: "Wireless Debugging Connection (TCPIP)",
                                    command: "# Execute while connected via USB, then remove cable and connect wirelessly.\nport=5555\n\n# 1. Switch to TCPIP Mode\nadb tcpip $port\n\n# 2. Check IP (wlan0)\nip_address=$(adb shell ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1)\n\necho \"Disconnect the cable and run the following command:\"\necho \"adb connect $ip_address:$port\""
                                },
                                {
                                    label: "Extract Installed App APK",
                                    command: "# Find the path of the installed app APK and pull it to the PC.\npackage=\"com.example.myapp\"\n\n# Find Path\npath=$(adb shell pm path $package | awk -F':' '{print $2}' | tr -d '\\r')\n\nif [ -z \"$path\" ]; then\n  echo \"App not found.\"\nelse\n  echo \"Pulling APK from $path...\"\n  adb pull \"$path\" ./extracted_app.apk\nfi"
                                },
                                {
                                    label: "Auto-Type Input Text",
                                    command: "# Type long text directly into the input field when typing is tedious.\n# (Spaces must be replaced with %s)\ntext=\"This%sis%stest%sinput\"\nadb shell input text \"$text\""
                                },
                                {
                                    label: "Check Process Memory Info",
                                    command: "# View detailed memory usage of the app (Java Heap, Native Heap, etc.).\npackage=\"com.example.myapp\"\n\nadb shell dumpsys meminfo $package"
                                },
                                {
                                    label: "Temp Change Resolution & DPI (UI Test)",
                                    command: "# Change resolution and density to test various screen sizes.\n\n# Change to 1080x1920\n#adb shell wm size 1080x1920\n# Change to DPI 480\n#adb shell wm density 480\n\n# Reset\nadb shell wm size reset\nadb shell wm density reset"
                                },
                                {
                                    label: "Check Current Activity",
                                    command: "# Check the package name and activity class name of the app currently on top.\n# (Recommended for Android 11+)\n# adb shell dumpsys activity list | grep -E 'mResumedActivity|topResumedActivity'\n\n# For older versions\nadb shell dumpsys window displays | grep -E 'mCurrentFocus|mFocusedApp'"
                                },
                                {
                                    label: "Deep Link (URI Scheme) Test",
                                    command: "# Launch the app via Deep Link URL.\nurl=\"myapp://scheme/path?query=value\"\npackage=\"com.example.myapp\"\n\nadb shell am start -a android.intent.action.VIEW -d \"$url\" $package"
                                },
                                {
                                    label: "Force Doze Mode Test",
                                    command: "# Force change state to test Battery Saver (Doze) mode.\n# 1. Simulate unplugging power cable\n# adb shell dumpsys battery unplug\n\n# 2. Turn off screen (Optional)\n# adb shell input keyevent 26\n\n# 3. Force enter Doze mode\n# adb shell dumpsys deviceidle force-idle\n\n# 4. Check state\n# adb shell dumpsys deviceidle get deep\n\n# Reset after test\n# adb shell dumpsys battery reset"
                                }
                            ]
                        }
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

        // We need to load the full system config to add a group
        try {
            const systemConfig = await this.readSystemConfig(filePath);

            // Check for duplicate in file
            if (systemConfig.groups.find(c => c.groupName === name)) {
                throw new Error(`Group '${name}' already exists in file.`);
            }

            systemConfig.groups.push(newConfig);
            this.saveConfigToFile(filePath, systemConfig);

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
            const systemConfig = await this.readSystemConfig(filePath);

            const updatedConfigs = systemConfig.groups.filter(c => c.groupName !== group.label);
            systemConfig.groups = updatedConfigs;

            if (updatedConfigs.length === 0) {
                // Should we keep the file with empty groups but valid keymap?
                this.saveConfigToFile(filePath, systemConfig);
            } else {
                this.saveConfigToFile(filePath, systemConfig);
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
        await this.saveGroup(liveRoot);
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
        this.sortItems(targetFolder.children);

        await this.saveGroup(root);
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
        await this.saveGroup(root);
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
        await this.saveGroup(root);
        await this.loadGroup(root.configPath);
        this._onDidChangeTreeData.fire();
    }

    public getRootGroup(item: ShellItem): ShellGroup {
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
        this._groups.sort((a, b) => a.label.localeCompare(b.label));
    }

    private async readSystemConfig(filePath: string): Promise<ShellSystemConfig> {
        if (!fs.existsSync(filePath)) {
            return {
                version: 1,
                shortCutKeymap: this.DEFAULT_KEYMAP,
                groups: []
            };
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let json: any;
        try {
            json = JSON.parse(content);
        } catch {
            return {
                version: 1,
                shortCutKeymap: this.DEFAULT_KEYMAP,
                groups: []
            };
        }

        // Detect format
        if (json.version === 1 && json.groups) {
            return json as ShellSystemConfig;
        }

        // Migration logic
        let configs: ShellConfig[] = [];
        let keymap = this.DEFAULT_KEYMAP;

        if (json && json.groups && Array.isArray(json.groups)) {
            // Old V1-ish format (had groups array but maybe not version 1 explicit or keymap handling)
            configs = json.groups;
            if (json.shortCutKeymap) {
                // Migrate keymap
                keymap = this.migrateKeymap(json.shortCutKeymap);
            }
        } else if (Array.isArray(json)) {
            configs = json;
        } else if (json && typeof json === 'object') {
            configs = [json];
        }

        return {
            version: 1,
            shortCutKeymap: keymap,
            groups: configs
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private migrateKeymap(km: any): ShellShortCutKeymap {
        if (km.createGroup || km.createFolder || km.delete || km.createCommand) {
            return {
                kbCreateGroup: km.kbCreateGroup || km.createGroup,
                kbCreateFolder: km.kbCreateFolder || km.createFolder,
                kbCreateCommand: km.kbCreateCommand || km.createCommand,
                kbDelete: km.kbDelete || km.delete,
                kbEdit: km.kbEdit || km.edit,
                kbView: km.kbView || km.view
            };
        }
        return km as ShellShortCutKeymap;
    }

    private async loadGroup(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            Logger.getInstance().warn(`Shell config file not found: ${filePath}`);
            return;
        }

        try {
            const systemConfig = await this.readSystemConfig(filePath);

            // Set global keymap if this is the first one or prioritised?
            // User request implies one global keymap. For now, last loaded wins or first?
            // Let's just set it.
            this._globalKeymap = systemConfig.shortCutKeymap;

            for (const config of systemConfig.groups) {
                if (!config.groupName) {
                    continue;
                }

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
                    this._groups[existingIdx] = group;
                } else {
                    this._groups.push(group);
                }
            }
            this._groups.sort((a, b) => a.label.localeCompare(b.label));
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
            this.sortItems(folder.children);
            return folder;
        });
    }

    private mapConfigCommandsToModel(commands: ShellCommandConfig[], parent: ShellFolder): ShellCommand[] {
        return commands.map(c => {
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

    private async saveGroup(group: ShellGroup) {
        const config: ShellConfig = {
            groupName: group.label,
            descript: group.description || "hello world. It is shell commander.",
            folders: this.mapModelFoldersToConfig(group.children.filter(child => child.kind === 'folder') as ShellFolder[])
        };

        const filePath = group.configPath;

        try {
            const systemConfig = await this.readSystemConfig(filePath);

            // Update or Add group in system config
            const existingIdx = systemConfig.groups.findIndex(c => c.groupName === group.label);
            if (existingIdx !== -1) {
                systemConfig.groups[existingIdx] = config;
            } else {
                systemConfig.groups.push(config);
            }

            this.saveConfigToFile(filePath, systemConfig);
        } catch (e) {
            Logger.getInstance().error(`Failed to save shell config to ${filePath}: ${e}`);
            vscode.window.showErrorMessage(`Failed to save shell configuration: ${e}`);
        }
    }

    private saveConfigToFile(filePath: string, config: ShellSystemConfig) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
        } catch (e) {
            Logger.getInstance().error(`Failed to save shell config to ${filePath}: ${e}`);
            vscode.window.showErrorMessage(`Failed to save shell configuration: ${e}`);
        }
    }

    private mapModelFoldersToConfig(folders: (ShellFolder | ShellCommand)[]): ShellFolderConfig[] {
        return folders
            .filter(item => item.kind === 'folder')
            .map(item => {
                const f = item as ShellFolder;
                const subFolders = f.children.filter(c => c.kind === 'folder') as ShellFolder[];
                const commands = f.children.filter(c => c.kind === 'command') as ShellCommand[];

                const config: ShellFolderConfig = {
                    name: f.label,
                    descript: f.description
                };

                if (subFolders.length > 0) {
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
        await this.saveGroup(group);
        await this.loadGroup(group.configPath);
        this._onDidChangeTreeData.fire();
    }

    // Helper to update folder description too
    public async updateFolderDescription(folder: ShellFolder, content: string): Promise<void> {
        folder.description = content;
        const root = this.getRootGroup(folder);
        await this.saveGroup(root);
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
            const systemConfig = await this.readSystemConfig(filePath);

            const targetConfigIndex = systemConfig.groups.findIndex(c => c.groupName === group.label);
            if (targetConfigIndex === -1) {
                // If not found by name, it might be an issue, but readSystemConfig handles parsing.
                // Assuming it must exist if group model exists.
                throw new Error(`Group '${group.label}' not found in configuration file.`);
            }

            // Check if new name exists in file (except self)
            if (systemConfig.groups.some((c, idx) => c.groupName === newName && idx !== targetConfigIndex)) {
                throw new Error(`Group '${newName}' already exists in this file.`);
            }

            // Update Name
            systemConfig.groups[targetConfigIndex].groupName = newName;

            this.saveConfigToFile(filePath, systemConfig);

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

    private sortItems(items: ShellItem[]): void {
        items.sort((a, b) => {
            if (a.kind === b.kind) {
                return a.label.localeCompare(b.label);
            }
            // folders above commands
            return a.kind === 'folder' ? -1 : 1;
        });
    }
}
