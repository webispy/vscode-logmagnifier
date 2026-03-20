import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { RunbookItem, RunbookMarkdown, RunbookGroup } from '../models/Runbook';

import { Logger } from './Logger';

interface ExportedRunbookItem {
    type: 'group' | 'markdown';
    name: string;
    content?: string;
    children?: ExportedRunbookItem[];
}

export class RunbookService {
    private static readonly MAX_IMPORT_DEPTH = 10;

    private _onDidChangeTreeData: vscode.EventEmitter<RunbookItem | undefined | null | void> = new vscode.EventEmitter<RunbookItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RunbookItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private runbookItems: RunbookItem[] = [];
    readonly ready: Promise<void>;

    constructor(private context: vscode.ExtensionContext, private logger: Logger) {
        this.ready = this.initialize();
    }

    private async initialize(): Promise<void> {
        if (!fs.existsSync(this.storagePath)) {
            await fsp.mkdir(this.storagePath, { recursive: true });
            await this.createDefaultConfig();
        }
        await this.loadConfig();
    }

    private get storagePath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'runbooks');
    }

    get items(): RunbookItem[] {
        return this.runbookItems;
    }

    public async refresh(): Promise<void> {
        await this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    private async createDefaultConfig(): Promise<void> {
        const defaultGroupPath = path.join(this.storagePath, 'System Check');
        if (!fs.existsSync(defaultGroupPath)) {
            await fsp.mkdir(defaultGroupPath, { recursive: true });
        }
        const defaultPath = path.join(defaultGroupPath, 'health-check.md');
        const defaultContent = `# System Health Check

## Disk Usage

Check disk space usage for all mounted filesystems.

\`\`\`sh
df -h
\`\`\`

## Memory Usage

Display current memory and swap usage.

\`\`\`sh
free -h 2>/dev/null || vm_stat
\`\`\`

## Network Connectivity

Verify internet connectivity with a simple ping test.

\`\`\`sh
ping -c 3 8.8.8.8
\`\`\`

## Running Processes (Top 10 by CPU)

List the top 10 processes sorted by CPU usage.

\`\`\`sh
if [ "$(uname)" = "Darwin" ]; then ps -eo pid,%cpu,%mem,command -r | head -11; else ps aux --sort=-%cpu | head -11; fi
\`\`\`

## System Uptime

Check how long the system has been running.

\`\`\`sh
uptime
\`\`\`
`;
        try {
            await fsp.writeFile(defaultPath, defaultContent, 'utf-8');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookService] Failed to create default runbook markdown: ${msg}`);
        }
    }

    public async loadConfig(): Promise<void> {
        this.runbookItems = [];
        try {
            if (!fs.existsSync(this.storagePath)) {
                return;
            }
            this.runbookItems = this.scanDir(this.storagePath);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookService] Error loading runbook configurations: ${msg}`);
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
        const safeName = path.basename(groupName);
        const targetPath = path.join(this.storagePath, safeName);
        if (!this.isWithinBase(this.storagePath, targetPath)) { return; }
        if (!fs.existsSync(targetPath)) {
            await fsp.mkdir(targetPath, { recursive: true });
            await this.refresh();
        }
    }

    public async createItem(parentPath: string, fileName: string): Promise<void> {
        const safeName = path.basename(fileName);
        if (!safeName.endsWith('.md')) { fileName = safeName + '.md'; } else { fileName = safeName; }
        const targetPath = path.join(parentPath, fileName);
        if (!this.isWithinBase(this.storagePath, targetPath)) { return; }
        if (!fs.existsSync(targetPath)) {
            await fsp.writeFile(targetPath, '# New Runbook\n\n```sh\necho "Hello World"\n```\n', 'utf-8');
            await this.refresh();
        }
    }

    public async renamePath(oldPath: string, newLabel: string, isGroup: boolean): Promise<void> {
        const parentDir = path.dirname(oldPath);
        const safeName = path.basename(isGroup ? newLabel : (newLabel.endsWith('.md') ? newLabel : newLabel + '.md'));
        const newPath = path.join(parentDir, safeName);
        if (!this.isWithinBase(this.storagePath, newPath)) { return; }

        if (oldPath !== newPath) {
            await fsp.rename(oldPath, newPath);
            await this.refresh();
        }
    }

    public async deletePath(targetPath: string): Promise<void> {
        if (fs.existsSync(targetPath)) {
            await fsp.rm(targetPath, { recursive: true, force: true });
            await this.refresh();
        }
    }

    public async exportRunbook(targetUri: vscode.Uri): Promise<void> {
        try {
            const exportedItems = await this.serializeItems(this.runbookItems);
            const exportData = {
                version: this.context.extension.packageJSON.version,
                runbooks: exportedItems
            };
            const jsonString = JSON.stringify(exportData, null, 2);
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(jsonString, 'utf-8'));
            vscode.window.showInformationMessage('Runbook exported successfully!');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookService] Failed to export runbook: ${msg}`);
            vscode.window.showErrorMessage(`Failed to export runbook: ${msg}`);
        }
    }

    private async serializeItems(items: RunbookItem[]): Promise<ExportedRunbookItem[]> {
        const result: ExportedRunbookItem[] = [];
        for (const item of items) {
            if (item.kind === 'group') {
                result.push({
                    type: 'group',
                    name: item.label,
                    children: await this.serializeItems((item as RunbookGroup).children)
                });
            } else {
                result.push({
                    type: 'markdown',
                    name: item.label,
                    content: await fsp.readFile((item as RunbookMarkdown).filePath, 'utf-8')
                });
            }
        }
        return result;
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
                this.logger.info(`Importing runbook from JSON (File Version: ${parsedData.version || 'unknown'}).`);
            } else {
                throw new Error("Invalid runbook file format.");
            }

            await this.deserializeItems(importedItems, this.storagePath);
            await this.refresh();
            vscode.window.showInformationMessage('Runbook imported successfully!');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[RunbookService] Failed to import runbook: ${msg}`);
            vscode.window.showErrorMessage(`Failed to import runbook: ${msg}`);
        }
    }

    private isWithinBase(base: string, candidate: string): boolean {
        try {
            const realBase = fs.realpathSync(base);
            const resolved = path.resolve(candidate);
            // For paths that don't exist yet, resolve the existing parent
            const realCandidate = fs.existsSync(resolved)
                ? fs.realpathSync(resolved)
                : path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
            return realCandidate.startsWith(realBase + path.sep) || realCandidate === realBase;
        } catch {
            return false;
        }
    }

    private async deserializeItems(items: ExportedRunbookItem[], currentPath: string, depth: number = 0): Promise<void> {
        if (!Array.isArray(items)) { return; }
        if (depth > RunbookService.MAX_IMPORT_DEPTH) {
            this.logger.warn(`Runbook import: max nesting depth (${RunbookService.MAX_IMPORT_DEPTH}) exceeded, skipping deeper items`);
            return;
        }

        for (const item of items) {
            if (!item || !item.type || !item.name) { continue; }

            if (item.type === 'group') {
                const groupPath = path.join(currentPath, item.name);
                if (!this.isWithinBase(this.storagePath, groupPath)) {
                    this.logger.error(`Path traversal blocked during import: ${item.name}`);
                    continue;
                }
                if (!fs.existsSync(groupPath)) {
                    await fsp.mkdir(groupPath, { recursive: true });
                }
                if (item.children) {
                    await this.deserializeItems(item.children, groupPath, depth + 1);
                }
            } else if (item.type === 'markdown') {
                const fileName = item.name.endsWith('.md') ? item.name : item.name + '.md';
                const filePath = path.join(currentPath, fileName);
                if (!this.isWithinBase(this.storagePath, filePath)) {
                    this.logger.error(`Path traversal blocked during import: ${item.name}`);
                    continue;
                }
                const content = item.content || '';
                await fsp.writeFile(filePath, content, 'utf-8');
            }
        }
    }

    public dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
