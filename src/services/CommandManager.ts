import * as vscode from 'vscode';
import { FilterManager } from './FilterManager';
import { HighlightService } from './HighlightService';
import { ResultCountService } from './ResultCountService';
import { LogProcessor } from './LogProcessor';
import { Logger } from './Logger';
import { FilterGroup, FilterItem } from '../models/Filter';
import { RegexUtils } from '../utils/RegexUtils';
import * as fs from 'fs';

export class CommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private highlightService: HighlightService,
        private resultCountService: ResultCountService,
        private logProcessor: LogProcessor,
        private logger: Logger
    ) {
        this.registerCommands();
        // Initialize context key
        this.setPrependLineNumbersEnabled(false);
    }

    private _prependLineNumbersEnabled: boolean = false;

    private setPrependLineNumbersEnabled(value: boolean) {
        this._prependLineNumbersEnabled = value;
        vscode.commands.executeCommand('setContext', 'logmagnifier.prependLineNumbersEnabled', value);
    }

    private registerCommands() {
        // Command: Add Word Filter Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.addFilterGroup', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'Enter Word Filter Group Name' });
            if (name) {
                const group = this.filterManager.addGroup(name, false);
                if (!group) {
                    vscode.window.showErrorMessage(`Word Filter Group '${name}' already exists.`);
                }
            }
        }));

        // Command: Add Regex Filter Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.addRegexFilterGroup', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'Enter Regex Filter Group Name' });
            if (name) {
                const group = this.filterManager.addGroup(name, true);
                if (!group) {
                    vscode.window.showErrorMessage(`Regex Filter Group '${name}' already exists.`);
                }
            }
        }));

        // Command: Add Word Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.addFilter', async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, false);
            if (!targetGroupId) {
                return;
            }

            const keyword = await vscode.window.showInputBox({ prompt: 'Enter Filter Keyword' });
            if (!keyword) {
                return;
            }

            const items: vscode.QuickPickItem[] = [
                { label: 'Include', description: 'Show lines containing this keyword' },
                { label: 'Exclude', description: 'Hide lines containing this keyword' }
            ];

            const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select Filter Type' });
            if (!selected) {
                return;
            }

            const type = selected.label === 'Include' ? 'include' : 'exclude';
            const filter = this.filterManager.addFilter(targetGroupId, keyword, type, false);
            if (!filter) {
                vscode.window.showErrorMessage(`Filter '${keyword}' (${type}) already exists in this group.`);
            }
        }));

        // Command: Add Regex Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.addRegexFilter', async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, true);
            if (!targetGroupId) {
                return;
            }

            const nickname = await vscode.window.showInputBox({ prompt: 'Enter Filter Nickname (e.g. ADB Logcat)' });
            if (!nickname) {
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter Regex Pattern',
                validateInput: (value) => {
                    try {
                        new RegExp(value);
                        return null;
                    } catch (e) {
                        return 'Invalid Regular Expression';
                    }
                }
            });
            if (!pattern) {
                return;
            }

            const filter = this.filterManager.addFilter(targetGroupId, pattern, 'include', true, nickname);
            if (!filter) {
                vscode.window.showErrorMessage(`Regex Filter with pattern '${pattern}' or nickname '${nickname}' already exists in this group.`);
            }
        }));

        // Command: Toggle Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleGroup', (group: FilterGroup) => {
            if (group) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group toggled: ${group.name}`);
            }
        }));

        // Command: Enable Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.enableGroup', (group: FilterGroup) => {
            if (group && !group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group enabled: ${group.name}`);
            }
        }));

        // Command: Disable Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.disableGroup', (group: FilterGroup) => {
            if (group && group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group disabled: ${group.name}`);
            }
        }));

        // Command: Enable Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.enableFilter', (item: FilterItem) => {
            this.handleFilterToggle(item, 'enable');
        }));

        // Command: Disable Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.disableFilter', (item: FilterItem) => {
            this.handleFilterToggle(item, 'disable');
        }));

        // Command: Toggle Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilter', (item: FilterItem) => {
            this.handleFilterToggle(item, 'toggle');
        }));

        // Command: Toggle Filter Highlight Mode
        const toggleHighlightModeHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
            }
        };


        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterHighlightMode.word', toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterHighlightMode.line', toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterHighlightMode.full', toggleHighlightModeHandler));


        // Command: Toggle Filter Case Sensitivity
        const toggleCaseSensitivityHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
            }
        };


        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterCaseSensitivity.on', toggleCaseSensitivityHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterCaseSensitivity.off', toggleCaseSensitivityHandler));

        // Command: Toggle Filter Context Line
        const toggleContextLineHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterContextLine(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterContextLine_cl0', toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterContextLine_cl3', toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterContextLine_cl5', toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.toggleFilterContextLine_cl9', toggleContextLineHandler));


        // Command: Change Filter Color
        // Command: Change Filter Color
        const changeColorHandler = async (item: any) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                const presets = this.filterManager.getColorPresets();

                const colorItems = presets.map(preset => {
                    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
                    const iconColor = isDark ? preset.dark : preset.light;
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${iconColor}"/></svg>`;
                    const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

                    return {
                        label: preset.id,
                        description: `Dark: ${preset.dark} | Light: ${preset.light}`,
                        iconPath: iconUri,
                        detail: '',
                        picked: false
                    } as vscode.QuickPickItem;
                });

                const picked = await vscode.window.showQuickPick(colorItems, {
                    placeHolder: 'Select a highlight color',
                    ignoreFocusOut: true
                });

                if (picked) {
                    this.filterManager.updateFilterColor(targetGroup.id, item.id, picked.label);
                }
            }
        };



        // Register specific color commands to support specific tooltips
        const colorPresets = this.filterManager.getAvailableColors();
        colorPresets.forEach(colorId => {
            this.context.subscriptions.push(vscode.commands.registerCommand(`logmagnifier.changeFilterColor.${colorId}`, changeColorHandler));
        });

        // Command: Delete Filter / Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.deleteFilter', async (item: FilterGroup | FilterItem) => {
            if (!item) {
                return;
            }
            if ((item as FilterGroup).filters !== undefined) {
                this.filterManager.removeGroup(item.id);
            } else {
                const groups = this.filterManager.getGroups();
                for (const g of groups) {
                    if (g.filters.find(f => f.id === item.id)) {
                        this.filterManager.removeFilter(g.id, item.id);
                        break;
                    }
                }
            }
        }));

        // Command: Apply Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.applyWordFilter', () => this.applyFilter('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.applyRegexFilter', () => this.applyFilter('regex')));

        // Command: Next Match
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.nextMatch', async (item: FilterItem) => {
            await this.findMatch(item, 'next');
        }));

        // Command: Previous Match
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.previousMatch', async (item: FilterItem) => {
            await this.findMatch(item, 'previous');
        }));

        // Command: Toggle Prepend Line Numbers (Enable)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.togglePrependLineNumbers.enable', () => {
            this.setPrependLineNumbersEnabled(true);
        }));

        // Command: Toggle Prepend Line Numbers (Disable)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.togglePrependLineNumbers.disable', () => {
            this.setPrependLineNumbersEnabled(false);
        }));
    }

    private handleFilterToggle(item: FilterItem, action: 'enable' | 'disable' | 'toggle') {
        const groups = this.filterManager.getGroups();
        for (const g of groups) {
            if (g.filters.find(f => f.id === item.id)) {
                if (action === 'enable' && !item.isEnabled) {
                    this.filterManager.toggleFilter(g.id, item.id);
                    this.logger.info(`Filter enabled: ${item.keyword}`);
                } else if (action === 'disable' && item.isEnabled) {
                    this.filterManager.toggleFilter(g.id, item.id);
                    this.logger.info(`Filter disabled: ${item.keyword}`);
                } else if (action === 'toggle') {
                    this.filterManager.toggleFilter(g.id, item.id);
                    this.logger.info(`Filter toggled: ${item.keyword}`);
                }
                break;
            }
        }
    }

    private async ensureGroupId(group: FilterGroup | undefined, isRegex: boolean): Promise<string | undefined> {
        if (group?.id) {
            return group.id;
        }

        const groups = this.filterManager.getGroups().filter(g => isRegex ? g.isRegex : !g.isRegex);
        if (groups.length === 0) {
            vscode.window.showErrorMessage(`No ${isRegex ? 'Regex' : 'Word'} filter groups exist. Create a group first.`);
            return undefined;
        }
        const selected = await vscode.window.showQuickPick(groups.map(g => ({ label: g.name, id: g.id })), { placeHolder: `Select ${isRegex ? 'Regex' : 'Word'} Filter Group` });
        return selected?.id;
    }

    private isProcessing = false;

    private async applyFilter(filterType?: 'word' | 'regex') {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            const activeGroups = this.filterManager.getGroups().filter(g => {
                if (!g.isEnabled) { return false; }
                if (filterType === 'word') { return !g.isRegex; }
                if (filterType === 'regex') { return g.isRegex; }
                return true;
            });

            if (activeGroups.length === 0) {
                vscode.window.showWarningMessage(`No active ${filterType || 'filter'} groups selected.`);
                return;
            }

            let document: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;
            let filePathFromTab: string | undefined;

            if (!document) {
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                    const uri = activeTab.input.uri;
                    if (uri.scheme === 'file') {
                        filePathFromTab = uri.fsPath;
                    } else if (uri.scheme === 'untitled') {
                        try {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            document = doc;
                        } catch (e) { console.error(e); }
                    }
                }

                if (!filePathFromTab && !document) {
                    const openFile = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled');
                    if (openFile) {
                        document = openFile;
                    }
                }
            }

            if (!document && !filePathFromTab) {
                vscode.window.showErrorMessage('No active file found. Please ensure a log file is open and visible.');
                return;
            }

            let outputPath = '';
            let inMemoryContent = '';
            let stats = { processed: 0, matched: 0 };
            const sourceName = document ? (document.fileName || 'Untitled') : (filePathFromTab || 'Large File');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Applying ${filterType || ''} Filters on ${sourceName}...`,
                cancellable: false
            }, async (progress) => {
                try {
                    if (document && document.isUntitled) {
                        const fullText = document.getText();
                        const lines = fullText.split(/\r?\n/);
                        const filtered = lines.filter(line => {
                            stats.processed++;
                            const matchResult = this.logProcessor.checkMatch(line, activeGroups);
                            if (matchResult.isMatched) {
                                stats.matched++;
                            }
                            return matchResult.isMatched;
                        });
                        inMemoryContent = filtered.join('\n');
                    } else {
                        const targetPath = filePathFromTab || document?.uri.fsPath;
                        if (!targetPath) {
                            throw new Error("Could not check active file path");
                        }

                        // Determine total line count for padding
                        let totalLineCount = 999999;
                        if (document) {
                            totalLineCount = document.lineCount;
                        }

                        const result = await this.logProcessor.processFile(targetPath, activeGroups, {
                            prependLineNumbers: this._prependLineNumbersEnabled,
                            totalLineCount: totalLineCount
                        });
                        outputPath = result.outputPath;
                        stats.processed = result.processed;
                        stats.matched = result.matched;
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error applying filters: ${error}`);
                    return;
                }
            });

            const message = `Filtered ${stats.processed.toLocaleString()} lines. Matched ${stats.matched.toLocaleString()} lines.`;
            if (stats.matched === 0) {
                vscode.window.showWarningMessage(message + " Check your filter keywords (case-sensitive).");
            } else {
                const timeout = vscode.workspace.getConfiguration('logmagnifier').get<number>('statusBarTimeout') || 5000;
                vscode.window.setStatusBarMessage(message, timeout);
            }

            if (document && document.isUntitled) {
                const newDoc = await vscode.workspace.openTextDocument({ content: inMemoryContent, language: 'log' });
                await vscode.window.showTextDocument(newDoc, { preview: false });
            } else {
                if (outputPath) {
                    try {
                        const newDoc = await vscode.workspace.openTextDocument(outputPath);
                        await vscode.window.showTextDocument(newDoc, { preview: false });
                        if (newDoc.languageId !== 'log') {
                            try {
                                await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                            } catch (e) { /* ignore */ }
                        }
                    } catch (e) {
                        this.logger.info(`Failed to open text document (likely too large), falling back to vscode.open: ${e}`);
                        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private async findMatch(item: FilterItem, direction: 'next' | 'previous') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Use RegexUtils
        const isRegex = !!item.isRegex;
        const caseSensitive = !!item.caseSensitive;
        const regex = RegexUtils.create(item.keyword, isRegex, caseSensitive);

        const fullText = document.getText();
        const matches = Array.from(fullText.matchAll(regex));

        if (matches.length === 0) {
            vscode.window.showInformationMessage('No matches found for: ' + item.keyword);
            return;
        }

        let targetMatch: { index: number, text: string } | undefined;

        if (direction === 'next') {
            const offset = document.offsetAt(selection.active);
            let nextM = matches.find(m => m.index! > offset);

            if (!nextM) {
                nextM = matches.find(m => m.index! <= offset && (m.index! + m[0].length) > offset);
                // Wrap
                const currentStart = document.offsetAt(selection.start);
                const currentEnd = document.offsetAt(selection.end);
                if (!nextM || (nextM.index === currentStart && (nextM.index + nextM[0].length) === currentEnd)) {
                    nextM = matches[0];
                }
            }
            targetMatch = { index: nextM.index!, text: nextM[0] };
        } else {
            const offset = document.offsetAt(selection.active);
            const matchesBefore = matches.filter(m => m.index! < offset);

            if (matchesBefore.length > 0) {
                let prevM = matchesBefore[matchesBefore.length - 1];

                const currentStart = document.offsetAt(selection.start);
                const currentEnd = document.offsetAt(selection.end);
                if (prevM.index === currentStart && (prevM.index + prevM[0].length) === currentEnd) {
                    if (matchesBefore.length > 1) {
                        prevM = matchesBefore[matchesBefore.length - 2];
                    } else {
                        prevM = matches[matches.length - 1]; // Wrap
                    }
                }
                targetMatch = { index: prevM.index!, text: prevM[0] };
            } else {
                const lastM = matches[matches.length - 1];
                targetMatch = { index: lastM.index!, text: lastM[0] };
            }
        }

        if (targetMatch) {
            const startPos = document.positionAt(targetMatch.index);
            const endPos = document.positionAt(targetMatch.index + targetMatch.text.length);
            const range = new vscode.Range(startPos, endPos);

            editor.selection = new vscode.Selection(startPos, endPos);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
    }
}
