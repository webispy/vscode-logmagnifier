import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RunbookItem, RunbookMarkdown, RunbookGroup } from '../models/Runbook';
import { Logger } from './Logger';

interface ExportedRunbookItem {
    type: 'group' | 'markdown';
    name: string;
    content?: string;
    children?: ExportedRunbookItem[];
}

export class RunbookService {
    private _items: RunbookItem[] = [];
    private _onDidChangeTreeData: vscode.EventEmitter<RunbookItem | undefined | null | void> = new vscode.EventEmitter<RunbookItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RunbookItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            this.createDefaultConfig();
        }
        this.loadConfig();
    }

    private get storagePath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'runbooks');
    }

    get items(): RunbookItem[] {
        return this._items;
    }

    public async refresh(): Promise<void> {
        await this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    private createDefaultConfig() {
        const defaultGroupPath = path.join(this.storagePath, 'ADB');
        if (!fs.existsSync(defaultGroupPath)) {
            fs.mkdirSync(defaultGroupPath, { recursive: true });
        }
        const defaultPath = path.join(defaultGroupPath, 'adb.md');
        const defaultContent = `# Android device control

## remount 하기

아래 명령을 통해 remount

\`\`\`sh
adb root on
sleep 2
adb remount
\`\`\`

## 스크린샷 가져오기

\`\`\`sh
adb exec-out screencap -p > screen.png
\`\`\`
`;
        try {
            fs.writeFileSync(defaultPath, defaultContent, 'utf-8');
        } catch (e) {
            Logger.getInstance().error(`Failed to create default runbook markdown: ${e}`);
        }
    }

    public async loadConfig(): Promise<void> {
        this._items = [];
        try {
            if (!fs.existsSync(this.storagePath)) {
                return;
            }
            this._items = this.scanDir(this.storagePath);
        } catch (e) {
            Logger.getInstance().error(`Error loading runbook configurations: ${e}`);
        }
    }

    private scanDir(dirPath: string, isRoot: boolean = true): RunbookItem[] {
        const items: RunbookItem[] = [];
        const files = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);

            if (isRoot && file.isDirectory()) {
                const group: RunbookGroup = {
                    id: fullPath,
                    type: 'group',
                    kind: 'group',
                    label: file.name,
                    dirPath: fullPath,
                    children: this.scanDir(fullPath, false)
                };
                items.push(group);
            } else if (!isRoot && file.isFile() && file.name.endsWith('.md')) {
                const item: RunbookMarkdown = {
                    id: fullPath,
                    type: 'markdown',
                    kind: 'markdown',
                    label: path.basename(file.name, '.md'),
                    filePath: fullPath
                };
                items.push(item);
            }
        }

        return items;
    }

    public async createGroup(groupName: string): Promise<void> {
        const targetPath = path.join(this.storagePath, groupName);
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
            await this.refresh();
        }
    }

    public async createItem(parentPath: string, fileName: string): Promise<void> {
        if (!fileName.endsWith('.md')) { fileName += '.md'; }
        const targetPath = path.join(parentPath, fileName);
        if (!fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, '# New Runbook\n\n```sh\necho "Hello World"\n```\n', 'utf-8');
            await this.refresh();
        }
    }

    public async renamePath(oldPath: string, newLabel: string, isGroup: boolean): Promise<void> {
        const parentDir = path.dirname(oldPath);
        const newName = isGroup ? newLabel : (newLabel.endsWith('.md') ? newLabel : newLabel + '.md');
        const newPath = path.join(parentDir, newName);

        if (oldPath !== newPath) {
            fs.renameSync(oldPath, newPath);
            await this.refresh();
        }
    }

    public async deletePath(targetPath: string): Promise<void> {
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
            await this.refresh();
        }
    }

    public async exportRunbook(targetUri: vscode.Uri): Promise<void> {
        try {
            const exportedItems = this.serializeItems(this._items);
            const exportData = {
                version: this.context.extension.packageJSON.version,
                runbooks: exportedItems
            };
            const jsonString = JSON.stringify(exportData, null, 2);
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(jsonString, 'utf-8'));
            vscode.window.showInformationMessage('Runbook exported successfully!');
        } catch (e) {
            Logger.getInstance().error(`Failed to export runbook: ${e}`);
            vscode.window.showErrorMessage(`Failed to export runbook: ${e}`);
        }
    }

    private serializeItems(items: RunbookItem[]): ExportedRunbookItem[] {
        return items.map(item => {
            if (item.kind === 'group') {
                return {
                    type: 'group',
                    name: item.label,
                    children: this.serializeItems((item as RunbookGroup).children)
                };
            } else {
                return {
                    type: 'markdown',
                    name: item.label,
                    content: fs.readFileSync((item as RunbookMarkdown).filePath, 'utf-8')
                };
            }
        });
    }

    public async importRunbook(sourceUri: vscode.Uri): Promise<void> {
        try {
            const fileData = await vscode.workspace.fs.readFile(sourceUri);
            const jsonString = Buffer.from(fileData).toString('utf-8');
            const parsedData = JSON.parse(jsonString);

            let importedItems: ExportedRunbookItem[] = [];

            if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.runbooks)) {
                // New format with version wrapper
                importedItems = parsedData.runbooks;
                Logger.getInstance().info(`Importing runbook from JSON (File Version: ${parsedData.version || 'unknown'}).`);
            } else {
                throw new Error("Invalid runbook file format.");
            }

            await this.deserializeItems(importedItems, this.storagePath);
            await this.refresh();
            vscode.window.showInformationMessage('Runbook imported successfully!');
        } catch (e) {
            Logger.getInstance().error(`Failed to import runbook: ${e}`);
            vscode.window.showErrorMessage(`Failed to import runbook: ${e}`);
        }
    }

    private async deserializeItems(items: ExportedRunbookItem[], currentPath: string): Promise<void> {
        if (!Array.isArray(items)) { return; }

        for (const item of items) {
            if (!item || !item.type || !item.name) { continue; }

            if (item.type === 'group') {
                const groupPath = path.join(currentPath, item.name);
                if (!fs.existsSync(groupPath)) {
                    fs.mkdirSync(groupPath, { recursive: true });
                }
                if (item.children) {
                    await this.deserializeItems(item.children, groupPath);
                }
            } else if (item.type === 'markdown') {
                const fileName = item.name.endsWith('.md') ? item.name : item.name + '.md';
                const filePath = path.join(currentPath, fileName);
                const content = item.content || '';
                fs.writeFileSync(filePath, content, 'utf-8');
            }
        }
    }
}
