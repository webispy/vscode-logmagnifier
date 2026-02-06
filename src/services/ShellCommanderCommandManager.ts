import * as vscode from 'vscode';
import { ShellCommanderService } from './ShellCommanderService';
import { Constants } from '../constants';
import { ShellGroup, ShellFolder, ShellCommand, ShellItem, ShellConfig } from '../models/ShellCommander';
import { Logger } from './Logger';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export class ShellCommanderCommandManager {
    private activeEditors = new Map<string, string>(); // path -> commandId
    private commandTerminals = new Map<string, vscode.Terminal>(); // commandId -> Terminal

    constructor(
        private context: vscode.ExtensionContext,
        private shellService: ShellCommanderService,
        private treeView?: vscode.TreeView<ShellItem>
    ) {
        this.registerCommands();
        this.context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(this.handleSavedCommand, this)
        );
    }

    // Exposed for testing
    protected _ui = {
        showInputBox: vscode.window.showInputBox,
        showInformationMessage: vscode.window.showInformationMessage,
        showErrorMessage: vscode.window.showErrorMessage,
        showWarningMessage: vscode.window.showWarningMessage,
        showOpenDialog: vscode.window.showOpenDialog,
        showSaveDialog: vscode.window.showSaveDialog,
        createTerminal: vscode.window.createTerminal,
        showTextDocument: vscode.window.showTextDocument,
        get terminals() { return vscode.window.terminals; }
    };


    protected registerCommands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand(Constants.Commands.OpenGlobalShellConfig, this.openGlobalShellConfig, this),
            vscode.commands.registerCommand(Constants.Commands.AddShellGroup, this.addShellGroup, this),
            vscode.commands.registerCommand(Constants.Commands.ImportShellGroup, this.importShellGroup, this),
            vscode.commands.registerCommand(Constants.Commands.ExportShellGroup, this.exportShellGroup, this),
            vscode.commands.registerCommand(Constants.Commands.AddShellFolder, this.addShellFolder, this),
            vscode.commands.registerCommand(Constants.Commands.AddShellCommand, this.addShellCommand, this),
            vscode.commands.registerCommand(Constants.Commands.ExecuteShellCommand, this.executeShellCommand, this),
            vscode.commands.registerCommand(Constants.Commands.EditShellItem, this.editShellItem, this),
            vscode.commands.registerCommand(Constants.Commands.DeleteShellItem, this.deleteShellItem, this),
            vscode.commands.registerCommand(Constants.Commands.RefreshShellView, this.refreshShellView, this),
            vscode.commands.registerCommand(Constants.Commands.ExpandAllShellGroups, this.expandAllShellGroups, this),
            vscode.commands.registerCommand(Constants.Commands.CollapseAllShellGroups, this.collapseAllShellGroups, this),
            vscode.commands.registerCommand(Constants.Commands.OpenShellGroupConfig, this.openShellGroupConfig, this),

            vscode.commands.registerCommand(Constants.Commands.EditShellDescription, this.editShellDescription, this),
            vscode.commands.registerCommand(Constants.Commands.RenameShellGroup, this.renameShellGroup, this),
            vscode.commands.registerCommand(Constants.Commands.ReloadShellCommander, this.reloadShellCommander, this),
            vscode.commands.registerCommand(Constants.Commands.ClearAllShellConfigs, this.clearAllShellConfigs, this)
        );
    }

    private async addShellGroup() {
        const name = await this._ui.showInputBox({
            placeHolder: "Enter Group Name (e.g. 'Android', 'Frontend', 'Backend')",
            prompt: "Creates a new Group in the default storage."
        });

        if (!name) {
            return;
        }

        // Unified Storage: Always use default file in Global Storage
        const storagePath = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }

        const defaultPath = path.join(storagePath, 'logmagnifier_shell_cmds.json');

        try {
            await this.shellService.createGroup(name, defaultPath);
            this._ui.showInformationMessage(`Created group '${name}' in default storage.`);
        } catch (e) {
            this._ui.showErrorMessage(`Failed to create group: ${e}`);
        }
    }

    private async importShellGroup() {
        const uris = await this._ui.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: true,
            defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads')),
            filters: { 'JSON': ['json'] }
        });

        if (uris) {
            const storagePath = this.context.globalStorageUri.fsPath;
            const defaultConfigPath = path.join(storagePath, 'logmagnifier_shell_cmds.json');

            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
            }

            let globalConfigs: ShellConfig[] = [];
            if (fs.existsSync(defaultConfigPath)) {
                try {
                    const content = fs.readFileSync(defaultConfigPath, 'utf-8');
                    const parsed = JSON.parse(content);
                    globalConfigs = Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                    Logger.getInstance().error(`Failed to parse global config: ${e}`);
                }
            }

            let importedTotal = 0;

            for (const uri of uris) {
                try {
                    const content = fs.readFileSync(uri.fsPath, 'utf-8');
                    const importedJson = JSON.parse(content);
                    const toImport = Array.isArray(importedJson) ? importedJson : [importedJson];

                    for (const config of toImport) {
                        const groupName = config.groupName;
                        if (!groupName) {
                            continue;
                        }

                        const existingIdx = globalConfigs.findIndex(c => c.groupName === groupName);
                        if (existingIdx !== -1) {
                            globalConfigs[existingIdx] = config;
                        } else {
                            globalConfigs.push(config);
                        }
                        importedTotal++;
                    }
                } catch (e) {
                    this._ui.showErrorMessage(`Failed to import ${uri.fsPath}: ${e}`);
                }
            }

            if (importedTotal > 0) {
                fs.writeFileSync(defaultConfigPath, JSON.stringify(globalConfigs, null, 2), 'utf-8');

                // Ensure default config is loaded/registered
                if (!this.shellService.isConfigRegistered(defaultConfigPath)) {
                    await this.shellService.importGroup(defaultConfigPath);
                } else {
                    await this.shellService.refresh();
                }
                this._ui.showInformationMessage(`Imported ${importedTotal} groups to global storage.`);
            }
        }
    }

    private async exportShellGroup(_group?: ShellGroup) {
        // NOTE: Parameter `group` ignored as we now do bulk export of ALL groups.
        const currentConfigs = this.shellService.getAllGroupsConfigs();
        if (currentConfigs.length === 0) {
            this._ui.showInformationMessage("No Shell Groups to export.");
            return;
        }

        const uri = await this._ui.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', 'logmagnifier_shell_cmds.json')),
            filters: { 'JSON': ['json'] },
            saveLabel: 'Export All Shell Groups'
        });

        if (uri) {
            try {
                let finalConfigs = currentConfigs;

                // Unified Save: Merge with existing file if exists
                if (fs.existsSync(uri.fsPath)) {
                    try {
                        const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
                        const existingConfigs = JSON.parse(fileContent);

                        if (Array.isArray(existingConfigs)) {
                            // Merge logic:
                            // 1. Start with existing configs (Map by groupName)
                            const mergedMap = new Map<string, ShellConfig>();
                            existingConfigs.forEach((c: ShellConfig) => {
                                if (c && c.groupName) {
                                    mergedMap.set(c.groupName, c);
                                }
                            });

                            // 2. Overwrite/Add current configs
                            currentConfigs.forEach(c => {
                                mergedMap.set(c.groupName, c);
                            });

                            finalConfigs = Array.from(mergedMap.values());
                        }
                    } catch (readErr) {
                        Logger.getInstance().warn(`Failed to parse existing export file, overwriting: ${readErr}`);
                        // Fallback to overwriting if existing is corrupt/invalid
                    }
                }

                fs.writeFileSync(uri.fsPath, JSON.stringify(finalConfigs, null, 2), 'utf-8');
                this._ui.showInformationMessage(`Successfully exported ${finalConfigs.length} groups to ${uri.fsPath}`);
            } catch (e) {
                this._ui.showErrorMessage(`Failed to export: ${e}`);
            }
        }
    }

    private async expandAllShellGroups() {
        // Manually reveal all groups recursively
        if (this.treeView) {
            const groups = this.shellService.groups;
            for (const group of groups) {
                try {
                    // expand: 3 covers (Group -> Folder -> Command) levels
                    await this.treeView.reveal(group, { expand: 3, select: false, focus: false });
                } catch (e) {
                    Logger.getInstance().error(`Failed to expand group ${group.label}: ${e}`);
                }
            }
        }
    }

    private async collapseAllShellGroups() {
        await vscode.commands.executeCommand('workbench.actions.treeView.logmagnifier-shell-commander.collapseAll');
    }

    private async addShellFolder(parent: ShellGroup | ShellFolder) {
        if (!parent) {
            return;
        }

        const name = await this._ui.showInputBox({ placeHolder: 'Folder Name' });
        if (name) {
            await this.shellService.addFolder(parent, name);
        }
    }

    private async addShellCommand(parent: ShellGroup | ShellFolder) {
        if (!parent) {
            return;
        }
        if (parent.kind === 'group') {
            this._ui.showWarningMessage("Please add commands inside a folder.");
            return;
        }

        const label = await this._ui.showInputBox({ placeHolder: 'Command Label' });
        if (!label) {
            return;
        }

        // 1. Add empty command (string type)
        await this.shellService.addCommand(parent, label, "");

        // 2. Find it to edit
        const groups = this.shellService.groups;
        const newItem = this.findItemInGroups(groups, label, 'command') as ShellCommand;

        if (newItem) {
            await this.editShellItem(newItem);
            this._ui.showInformationMessage(`Created '${label}'. Edit the script file and save to update.`);
        }
    }

    private findItemInGroups(groups: ShellGroup[], label: string, kind: string): ShellItem | undefined {
        for (const group of groups) {
            const found = this.findItemRecursive(group, label, kind);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    private findItemRecursive(parent: ShellGroup | ShellFolder, label: string, kind: string): ShellItem | undefined {
        for (const child of parent.children) {
            if (child.kind === kind && child.label === label) {
                return child;
            }
            if (child.kind === 'folder') {
                const found = this.findItemRecursive(child as ShellFolder, label, kind);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    private async executeShellCommand(item: ShellCommand) {
        if (!item || item.kind !== 'command') {
            return;
        }

        // 1. Try to find if an editor is already open for this command
        let commandText = item.command || "";
        const openDoc = vscode.workspace.textDocuments.find(doc =>
            this.activeEditors.get(doc.uri.fsPath) === item.id
        );

        if (openDoc) {
            // Priority: Use the current editor's content (after saving)
            await openDoc.save();
            commandText = openDoc.getText();
        }

        // 2. Open the command in an editor so the user can see/edit it
        await this.openCommandEditor(item);

        // 3. Execute immediately
        if (commandText.trim().length > 0) {
            const commandId = item.id;
            const root = this.getRootGroup(item);
            const groupName = root.label;
            await this.sendToTerminal(commandText, commandId, item.label, groupName);
        }
    }

    private getRootGroup(item: ShellItem): ShellGroup {
        let current = item;
        while (current.parent) {
            current = current.parent as ShellItem;
        }
        return current as ShellGroup;
    }

    private async sendToTerminal(text: string, commandId: string, label: string, groupName: string) {
        const config = vscode.workspace.getConfiguration('logmagnifier');
        const strategy = config.get<string>('shellCommander.terminalReuseStrategy', 'perFolder'); // Default updated

        let terminalKey = commandId;
        let terminalName = "";

        if (strategy === 'global') {
            terminalKey = '__GLOBAL_SHELL_COMMANDER__';
            terminalName = 'Shell: Commander';
        } else if (strategy === 'perGroup') {
            terminalKey = groupName || '__DEFAULT_GROUP__';
            terminalName = `Shell: [${groupName || 'General'}]`;
        } else if (strategy === 'perFolder') {
            // Find parent folder name
            // ID structure is usually 'Group/Folder/SubFolder/Command'
            // But we can just use the parent ID or extract from item if we have it.
            // However, sendToTerminal is generic. Let's rely on extracting from commandId if possible,
            // but we need the item for accurate folder name?
            // Actually, we can pass folderName? Or extract from ID.
            // Let's deduce folder path from ID by removing the last segment (command name).
            // Example ID: "Android / Common / ADB / adb devices" -> Path: "Android/Common/ADB"
            const lastSlash = commandId.lastIndexOf('/');
            const folderPath = lastSlash !== -1 ? commandId.substring(0, lastSlash) : groupName;

            // For display name, maybe just the last folder name? or "Group/Folder"
            // Let's use "Group/.../Folder" or just "Folder" if unique?
            // "Shell: [ADB]" is clean. "Shell: [Common/ADB]" is safer.
            // Let's use the full folder path (minus command) as key, and last folder name for display?
            // Or "Group - Folder".

            terminalKey = folderPath;

            // Extract just the folder name for display
            const segments = folderPath.split('/');
            const displayFolder = segments.length > 0 ? segments[segments.length - 1] : groupName;

            // To be distinguishable if multiple groups have "Common": use Group/Folder format if depth > 1
            let displayName = displayFolder;
            if (segments.length > 1) {
                // e.g. Android/Common/ADB -> Android/.../ADB ? or just ADB?
                // User asked for "Folder specific".
                // Let's stick to full path for uniqueness in Key, and [Group/.../Folder] for name?
                // Actually user said "Same Folder command reuse", implying if I have Group1/Common and Group2/Common, they might want distinct or same?
                // Usually distinct. Key = folderPath handles distinctness.
                // Name: `Shell: [Group/Folder]`
                if (segments.length >= 2) {
                    displayName = `${segments[0]}/${segments[segments.length - 1]}`;
                }
            }

            terminalName = `Shell: [${displayName}]`;

        } else {
            // perCommand (Legacy)
            terminalKey = commandId;
            const namePrefix = groupName ? `[${groupName}] ` : "";
            terminalName = `Shell: ${namePrefix}${label}`;
        }

        let terminal = this.commandTerminals.get(terminalKey);
        let isReused = false;

        // Check if terminal exists and is healthy
        if (terminal) {
            const isTerminalOpen = this._ui.terminals.some(t => t === terminal);
            const isDead = terminal.exitStatus !== undefined;

            if (!isTerminalOpen || isDead) {
                terminal = undefined;
                this.commandTerminals.delete(terminalKey);
            } else {
                isReused = true;
            }
        }

        // Fallback: search by name in active terminals if map lookup failed (e.g. after reload)
        if (!terminal && (strategy === 'global' || strategy === 'perGroup' || strategy === 'perFolder')) {
            terminal = this._ui.terminals.find(t => t.name === terminalName && t.exitStatus === undefined);
            if (terminal) {
                this.commandTerminals.set(terminalKey, terminal);
                isReused = true;
            }
        }

        if (!terminal) {
            terminal = this._ui.createTerminal({ name: terminalName });
            this.commandTerminals.set(terminalKey, terminal);
            isReused = false; // New terminal doesn't need interruption
        }

        terminal.show(true);

        if (isReused) {
            // Interrupt any running process (Ctrl+C)
            terminal.sendText('\u0003');
            // Small delay to allow shell to return to prompt
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        terminal.sendText(text);
    }

    private async editShellItem(item: ShellCommand | ShellFolder | ShellGroup) {
        if (item.kind === 'group') {
            return;
        }

        const label = await this._ui.showInputBox({ value: item.label, placeHolder: 'Name' });
        if (!label) {
            return;
        }

        if (label !== item.label) {
            await this.shellService.updateItem(item, { label });
            const groups = this.shellService.groups;
            const newItem = this.findItemInGroups(groups, label, item.kind);
            if (newItem && newItem.kind === 'command') {
                await this.openCommandEditor(newItem as ShellCommand);
            }
        } else {
            if (item.kind === 'command') {
                await this.openCommandEditor(item as ShellCommand);
            }
        }
    }

    private async handleSavedCommand(doc: vscode.TextDocument) {
        const filePath = doc.uri.fsPath;
        const itemId = this.activeEditors.get(filePath);

        if (!itemId) {
            return;
        }

        const groups = this.shellService.groups;
        const liveItem = this.findItemById(groups, itemId);

        if (liveItem) {
            const text = doc.getText();

            if (liveItem.kind === 'command') {
                await this.shellService.updateItem(liveItem as ShellCommand, { command: text });
            } else if (liveItem.kind === 'group') {
                await this.shellService.updateGroupDescription(liveItem as ShellGroup, text);
            } else if (liveItem.kind === 'folder') {
                await this.shellService.updateFolderDescription(liveItem as ShellFolder, text);
            }
        }
    }

    private async openCommandEditor(item: ShellCommand) {
        const tempDir = os.tmpdir();
        const safeId = item.id.replace(/\//g, '_');
        // Use a simplified unique filename for all command executions
        const tempPath = path.join(tempDir, `_exec_${safeId}.sh`);

        // command is now string, use directly
        const content = item.command || "";
        fs.writeFileSync(tempPath, content, 'utf8');

        this.activeEditors.set(tempPath, item.id);

        const doc = await vscode.workspace.openTextDocument(tempPath);
        await this._ui.showTextDocument(doc, { preserveFocus: true });
    }

    private findItemById(groups: ShellGroup[], id: string): ShellItem | undefined {
        for (const group of groups) {
            const found = this.findItemRecursiveById(group, id);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    private findItemRecursiveById(parent: ShellGroup | ShellFolder, id: string): ShellItem | undefined {
        if (parent.id === id) {
            return parent;
        }
        for (const child of parent.children) {
            if (child.id === id) {
                return child;
            }
            if (child.kind === 'folder') {
                const found = this.findItemRecursiveById(child as ShellFolder, id);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    private async deleteShellItem(item: ShellCommand | ShellFolder | ShellGroup) {
        const confirm = await this._ui.showWarningMessage(`Delete '${item.label}'?`, { modal: true }, 'Yes');
        if (confirm !== 'Yes') {
            return;
        }

        if (item.kind === 'group') {
            await this.shellService.deleteGroup(item as ShellGroup);
        } else {
            await this.shellService.deleteItem(item as ShellCommand | ShellFolder);
        }
    }

    private async refreshShellView() {
        await this.shellService.refresh();
    }

    private async openShellGroupConfig(group: ShellGroup) {
        if (!group || !group.configPath) {
            return;
        }
        try {
            const document = await vscode.workspace.openTextDocument(group.configPath);
            await this._ui.showTextDocument(document);
        } catch (e) {
            this._ui.showErrorMessage(`Failed to open config file: ${e}`);
        }
    }

    private async editShellDescription(item: ShellGroup | ShellFolder) {
        if (!item || (item.kind !== 'group' && item.kind !== 'folder')) {
            return;
        }

        try {
            const description = item.description || "";

            // Simple heuristic to detect Markdown
            const isMarkdown = (text: string): boolean => {
                if (!text) { return false; }
                const mdIndicators = [
                    /^#+\s/m,           // Headers
                    /^\s*[-*+]\s/m,     // Lists
                    /^\s*>\s/m,         // Blockquotes
                    /```/,              // Code blocks
                    /\[.+\]\(.+\)/,     // Links
                    /\*\*.+\*\*/,       // Bold
                    /__.+__/            // Bold
                ];
                return mdIndicators.some(regex => regex.test(text));
            };

            const ext = isMarkdown(description) ? 'md' : 'txt';
            const tempDir = os.tmpdir();
            // Prefix to avoid collisions
            const safeName = item.label.replace(/[^a-zA-Z0-9-_]/g, '_');
            const tempPath = path.join(tempDir, `_description_${safeName}_${item.id.replace(/\//g, '-')}.${ext}`);

            fs.writeFileSync(tempPath, description, 'utf8');

            const doc = await vscode.workspace.openTextDocument(tempPath);
            await this._ui.showTextDocument(doc);

            // Setup a one-time save listener (or persistent one? one-time bound to this specific file is safer for this session)
            // But activeEditors map approach is better if we want to support multiple open descriptions?
            // For description, let's keep it simple: On save, if it matches temp path, update.
            // But we need to keep track of *which* item this file belongs to.
            // Reuse activeEditors logic? activeEditors maps path -> ID.
            this.activeEditors.set(tempPath, item.id);

            // We need to handle this in `handleSavedCommand` or separate method?
            // handleSavedCommand expects it to be a command.
            // Let's modify handleSavedCommand to check kind or add `handleSavedDescription`.
            // Actually, `handleSavedCommand` logic is: Find item by ID. Update item command.
            // If we use the same map, we can check item kind in the handler.
            // If kind is Group/Folder -> update description.
            // If kind is Command -> update command.

        } catch (e) {
            this._ui.showErrorMessage(`Failed to open editor: ${e}`);
        }
    }

    private async renameShellGroup(group: ShellGroup) {
        if (!group) {
            return;
        }

        const newName = await this._ui.showInputBox({
            placeHolder: "Enter new group name",
            value: group.label
        });

        if (!newName || newName === group.label) {
            return;
        }

        if (this.shellService.groups.some(g => g.label === newName)) {
            this._ui.showErrorMessage(`Group '${newName}' already exists.`);
            return;
        }

        try {
            await this.shellService.renameGroup(group, newName);
        } catch (e) {
            this._ui.showErrorMessage(`Failed to rename group: ${e}`);
        }
    }

    private async openGlobalShellConfig() {
        const storagePath = this.context.globalStorageUri.fsPath;
        const configPath = path.join(storagePath, 'logmagnifier_shell_cmds.json');

        if (!fs.existsSync(configPath)) {
            this._ui.showInformationMessage("Global configuration file does not exist yet.");
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(configPath);
            await this._ui.showTextDocument(document);
        } catch (e) {
            this._ui.showErrorMessage(`Failed to open global config: ${e}`);
        }
    }

    private async reloadShellCommander() {
        try {
            const storagePath = this.context.globalStorageUri.fsPath;
            const defaultConfigPath = path.join(storagePath, 'logmagnifier_shell_cmds.json');

            // Ensure the default global config file is registered if it exists
            if (fs.existsSync(defaultConfigPath) && !this.shellService.isConfigRegistered(defaultConfigPath)) {
                await this.shellService.importGroup(defaultConfigPath);
            }

            await this.shellService.loadConfig();
            await this.refreshShellView();
            this._ui.showInformationMessage("Shell Commander reloaded.");
        } catch (e) {
            this._ui.showErrorMessage(`Failed to reload Shell Commander: ${e}`);
        }
    }

    private async clearAllShellConfigs() {
        const confirm = await vscode.window.showWarningMessage(
            "Are you sure you want to clear all Shell Commander configurations? This will reset the global configuration file to its default template and remove all other registered groups. (Original files will not be deleted)",
            { modal: true },
            "Yes"
        );

        if (confirm === "Yes") {
            await this.shellService.resetToDefault();
            vscode.window.showInformationMessage("Shell Commander configurations reset to default.");
        }
    }
}
