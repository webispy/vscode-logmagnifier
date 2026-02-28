import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShellItem, ShellMarkdown, ShellGroup } from '../models/ShellCommander';
import { Logger } from './Logger';

export class ShellCommanderService {
    private _items: ShellItem[] = [];
    private _onDidChangeTreeData: vscode.EventEmitter<ShellItem | undefined | null | void> = new vscode.EventEmitter<ShellItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShellItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            this.createDefaultConfig();
        }
        this.loadConfig();
    }

    private get storagePath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'shell-commands');
    }

    get items(): ShellItem[] {
        return this._items;
    }

    public async refresh(): Promise<void> {
        await this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    private createDefaultConfig() {
        const defaultPath = path.join(this.storagePath, 'adb.md');
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
            Logger.getInstance().error(`Failed to create default shell markdown: ${e}`);
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
            Logger.getInstance().error(`Error loading shell configurations: ${e}`);
        }
    }

    private scanDir(dirPath: string): ShellItem[] {
        const items: ShellItem[] = [];
        const files = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);

            if (file.isDirectory()) {
                const group: ShellGroup = {
                    id: fullPath,
                    type: 'group',
                    kind: 'group',
                    label: file.name,
                    dirPath: fullPath,
                    children: this.scanDir(fullPath)
                };
                items.push(group);
            } else if (file.isFile() && file.name.endsWith('.md')) {
                const item: ShellMarkdown = {
                    id: fullPath,
                    type: 'markdown',
                    kind: 'markdown',
                    label: path.basename(file.name, '.md'),
                    filePath: fullPath
                };
                items.push(item);
            }
        }

        return items.sort((a, b) => {
            if (a.kind === 'group' && b.kind === 'markdown') { return -1; }
            if (a.kind === 'markdown' && b.kind === 'group') { return 1; }
            return a.label.localeCompare(b.label);
        });
    }

    public async createGroup(parentPath: string | undefined, groupName: string): Promise<void> {
        const targetPath = parentPath ? path.join(parentPath, groupName) : path.join(this.storagePath, groupName);
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
            await this.refresh();
        }
    }

    public async createItem(parentPath: string | undefined, fileName: string): Promise<void> {
        if (!fileName.endsWith('.md')) { fileName += '.md'; }
        const targetPath = parentPath ? path.join(parentPath, fileName) : path.join(this.storagePath, fileName);
        if (!fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, '# New Shell Command\n\n```sh\necho "Hello World"\n```\n', 'utf-8');
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
}
