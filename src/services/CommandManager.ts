import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from './FilterManager';
import { HighlightService } from './HighlightService';
import { ResultCountService } from './ResultCountService';
import { LogProcessor } from './LogProcessor';
import { Logger } from './Logger';
import { QuickAccessProvider } from '../views/QuickAccessProvider';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';
import { RegexUtils } from '../utils/RegexUtils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonPrettyService } from './JsonPrettyService';
import { SourceMapService } from './SourceMapService';

export class CommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private highlightService: HighlightService,
        private resultCountService: ResultCountService,
        private logProcessor: LogProcessor,
        private quickAccessProvider: QuickAccessProvider,
        private logger: Logger,
        private wordTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private regexTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private jsonPrettyService: JsonPrettyService,
        private sourceMapService: SourceMapService
    ) {
        this.registerCommands();
        this.registerEventListeners();
        // Initialize context key
        this.setPrependLineNumbersEnabled(false);
    }

    private _prependLineNumbersEnabled: boolean = false;

    private setPrependLineNumbersEnabled(value: boolean) {
        this._prependLineNumbersEnabled = value;
        vscode.commands.executeCommand('setContext', Constants.ContextKeys.PrependLineNumbersEnabled, value);
    }

    private lastActiveLine: number = -1;
    private lastUriStr: string = '';

    private registerEventListeners() {
        this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;
            // Only trigger if it is the active editor
            if (editor !== vscode.window.activeTextEditor) {
                return;
            }

            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const enabled = config.get<boolean>(Constants.Configuration.JsonPreviewEnabled);

            if (!enabled) {
                return;
            }

            const currentLine = event.selections[0].active.line;
            const currentUriStr = editor.document.uri.toString();

            if (currentLine !== this.lastActiveLine || currentUriStr !== this.lastUriStr) {
                this.lastActiveLine = currentLine;
                this.lastUriStr = currentUriStr;
                // Execute silent
                this.jsonPrettyService.execute(true);
            }
        }));
    }

    private registerCommands() {

        this.registerFilterGroupCommands();
        this.registerFilterItemCommands();
        this.registerViewCommands();
        this.registerPropertyToggleCommands();
        this.registerEditorToggleCommands();
        this.registerExportImportCommands();
        this.registerNavigateCommands();
        this.registerProfileCommands();
    }

    private handleFilterToggle(item: FilterItem, action: 'enable' | 'disable' | 'toggle') {
        const group = this.filterManager.findGroupByFilterId(item.id);
        if (group) {
            if (action === 'enable' && !item.isEnabled) {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`Filter enabled: ${item.keyword}`);
            } else if (action === 'disable' && item.isEnabled) {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`Filter disabled: ${item.keyword}`);
            } else if (action === 'toggle') {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`Filter toggled: ${item.keyword}`);
            }
        }
    }

    private async ensureGroupId(group: FilterGroup | undefined, isRegex: boolean): Promise<string | undefined> {
        if (group?.id) {
            return group.id;
        }

        const groups = this.filterManager.getGroups().filter(g => isRegex ? g.isRegex : !g.isRegex);
        if (groups.length === 0) {
            vscode.window.showErrorMessage(Constants.Messages.Error.NoFilterGroups.replace('{0}', isRegex ? 'Regex' : 'Word'));
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
                if (!g.isEnabled) {
                    return false;
                }
                if (filterType === 'word') {
                    return !g.isRegex;
                }
                if (filterType === 'regex') {
                    return g.isRegex;
                }
                return true;
            });

            if (activeGroups.length === 0) {
                vscode.window.showWarningMessage(Constants.Messages.Warn.NoActiveGroups.replace('{0}', filterType || 'filter'));
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
                        } catch (e) { this.logger.error(String(e)); }
                    }
                }

                // Fallback removed: Do not search for random background files.
                // If the user has no active tab/editor, we should not guess.
            }

            if (!document && !filePathFromTab) {
                vscode.window.showErrorMessage(Constants.Messages.Error.NoActiveFile);
                return;
            }

            let outputPath = '';
            let stats = { processed: 0, matched: 0 };
            const sourceName = document ? (document.fileName || 'Untitled') : (filePathFromTab || 'Large File');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Applying ${filterType || ''} Filters on ${sourceName}...`,
                cancellable: false
            }, async (progress) => {
                try {
                    let targetPath = filePathFromTab || document?.uri.fsPath;
                    let tempInputPath: string | undefined;

                    // Handle Untitled Files: Write to temp file first to use standard processor
                    if (document && document.isUntitled) {
                        const tmpDir = os.tmpdir();
                        const randomSuffix = Math.random().toString(36).substring(7);
                        tempInputPath = path.join(tmpDir, `vscode_loglens_untitled_${randomSuffix}.log`);

                        try {
                            fs.writeFileSync(tempInputPath, document.getText(), 'utf8');
                            targetPath = tempInputPath;
                        } catch (e) {
                            this.logger.error(`Failed to create temp file for untitled document: ${e}`);
                            throw new Error("Failed to process untitled file");
                        }
                    }

                    if (!targetPath) {
                        throw new Error("Could not check active file path");
                    }

                    // Determine total line count for padding
                    let totalLineCount = 999999;
                    if (document) {
                        totalLineCount = document.lineCount;
                    }

                    try {
                        const result = await this.logProcessor.processFile(targetPath, activeGroups, {
                            prependLineNumbers: this._prependLineNumbersEnabled,
                            totalLineCount: totalLineCount
                        });
                        outputPath = result.outputPath;
                        stats.processed = result.processed;
                        stats.matched = result.matched;

                        // Register Source Map
                        // If generated from a specific document, use its URI.
                        // If generated from a file path (without doc), use file URI.
                        let sourceUri: vscode.Uri | undefined;
                        if (document) {
                            sourceUri = document.uri;
                        } else if (filePathFromTab) {
                            sourceUri = vscode.Uri.file(filePathFromTab);
                        }

                        // Handle strict untitled file mapping:
                        // If we created a temp input file for untitled doc, we still mapped lines from that content.
                        // But the USER sees the 'untitled:Untitled-1' document.
                        // Ideally we map back to the 'untitled:...' URI so opening it works if tab is open.
                        // If tab is closed, we can't reopen 'untitled:' content easily unless we saved it?
                        // Actually, SourceMapService stores the URI. clicking 'jumping' opens that URI.
                        // If 'untitled', VSCode tries to find that open valid document.

                        if (sourceUri && result.lineMapping) {
                            const outputUri = vscode.Uri.file(outputPath);
                            this.sourceMapService.register(outputUri, sourceUri, result.lineMapping);
                        }

                    } finally {
                        // Cleanup temp input file if we created one
                        if (tempInputPath && fs.existsSync(tempInputPath)) {
                            try {
                                fs.unlinkSync(tempInputPath);
                            } catch (e) { /* ignore cleanup error */ }
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.ApplyFiltersError.replace('{0}', error as string));
                    return;
                }
            });

            const message = `Filtered ${stats.processed.toLocaleString()} lines. Matched ${stats.matched.toLocaleString()} lines.`;
            if (stats.matched === 0) {
                vscode.window.showWarningMessage(Constants.Messages.Warn.EmptyImport.replace('{0}', message));
            } else {
                const timeout = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<number>(Constants.Configuration.StatusBarTimeout) || 5000;
                vscode.window.setStatusBarMessage(message, timeout);
            }

            if (outputPath) {
                try {
                    const newDoc = await vscode.workspace.openTextDocument(outputPath);
                    await vscode.window.showTextDocument(newDoc, { preview: false });

                    // Force language to log to ensure syntax highlighting works
                    if (newDoc.languageId !== 'log') {
                        try {
                            await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) {
                    this.logger.info(Constants.Messages.Info.FallbackToOpen.replace('{0}', String(e)));
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private async findMatch(item: FilterItem | undefined, direction: 'next' | 'previous') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // If no item passed (via shortcut), try to get from TreeView selection
        if (!item) {
            const selection = this.wordTreeView.selection;
            if (selection && selection.length > 0) {
                const selected = selection[0];
                // Ensure it is a FilterItem (not a Group) and it is enabled
                if ('keyword' in selected) { // Simple check for FilterItem
                    item = selected as FilterItem;
                }
            }
        }

        if (!item) {
            vscode.window.showInformationMessage(Constants.Messages.Info.SelectFilterFirst);
            return;
        }

        if (!item.isEnabled) {
            vscode.window.showInformationMessage(Constants.Messages.Info.FilterDisabled.replace('{0}', item.keyword));
            return;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Use RegexUtils
        const isRegex = !!item.isRegex;
        const caseSensitive = !!item.caseSensitive;
        const regex = RegexUtils.create(item.keyword, isRegex, caseSensitive);

        const fullText = document.getText();
        let targetMatch: { index: number, text: string } | undefined;

        if (direction === 'next') {
            const offset = document.offsetAt(selection.active);
            regex.lastIndex = offset;

            let match = regex.exec(fullText);

            // If we found a match exactly at offset, we might want the next one
            if (match && match.index === offset) {
                match = regex.exec(fullText);
            }

            if (match) {
                targetMatch = { index: match.index, text: match[0] };
            } else {
                // Wrap: start from beginning
                regex.lastIndex = 0;
                match = regex.exec(fullText);
                if (match) {
                    targetMatch = { index: match.index, text: match[0] };
                }
            }
        } else {
            // Previous
            const offset = document.offsetAt(selection.active);
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            let verifyLastMatch: RegExpExecArray | undefined;
            let lastInFile: RegExpExecArray | undefined;

            // Iterate to find candidate
            while ((match = regex.exec(fullText)) !== null) {
                lastInFile = match;
                if (match.index < offset) {
                    verifyLastMatch = match;
                } else {
                    // Found a match after offset.
                    // If we found a 'before' match (verifyLastMatch), we have our target.
                    // If not, we might wrap to the last match in the file (lastInFile).
                    // We continue scanning to find the true lastInFile.
                }
            }

            if (verifyLastMatch) {
                targetMatch = { index: verifyLastMatch.index, text: verifyLastMatch[0] };
            } else if (lastInFile) {
                // Wrap to last match in file
                targetMatch = { index: lastInFile.index, text: lastInFile[0] };
            }
        }

        if (targetMatch) {
            const startPos = document.positionAt(targetMatch.index);
            const endPos = document.positionAt(targetMatch.index + targetMatch.text.length);
            const range = new vscode.Range(startPos, endPos);

            editor.selection = new vscode.Selection(startPos, endPos);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

            // Trigger Flash Animation
            // Pass the filter color from the item
            this.highlightService.flashLine(editor, startPos.line, item.color);
        }
    }

    private async handleExport(mode: 'word' | 'regex') {
        const filtersJson = this.filterManager.exportFilters(mode);
        const fileName = `logmagnifier_${mode}_filters.json`;

        const downloadsPath = path.join(os.homedir(), 'Downloads');
        let defaultUri = vscode.Uri.file(path.join(downloadsPath, fileName));

        // Fallback to homedir if Downloads doesn't exist
        if (!fs.existsSync(downloadsPath)) {
            defaultUri = vscode.Uri.file(path.join(os.homedir(), fileName));
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            filters: { 'JSON': ['json'] },
            title: mode === 'word' ? Constants.Prompts.ExportWordFilters : Constants.Prompts.ExportRegexFilters
        });

        if (uri) {
            try {
                fs.writeFileSync(uri.fsPath, filtersJson, 'utf8');
                vscode.window.showInformationMessage(Constants.Messages.Info.ExportSuccess.replace('{0}', mode === 'word' ? 'Word' : 'Regex').replace('{1}', uri.fsPath));
            } catch (err) {
                vscode.window.showErrorMessage(Constants.Messages.Error.ExportFailed.replace('{0}', err instanceof Error ? err.message : String(err)));
            }
        }
    }

    private async handleExportGroup(group: FilterGroup) {
        if (!group) {
            return;
        }

        const filtersJson = this.filterManager.exportGroup(group.id);
        if (!filtersJson) {
            vscode.window.showErrorMessage(Constants.Messages.Error.ExportGroupFailed.replace('{0}', group.name));
            return;
        }

        const safeName = group.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `logmagnifier_group_${safeName}.json`;

        const downloadsPath = path.join(os.homedir(), 'Downloads');
        let defaultUri = vscode.Uri.file(path.join(downloadsPath, fileName));

        // Fallback to homedir if Downloads doesn't exist
        if (!fs.existsSync(downloadsPath)) {
            defaultUri = vscode.Uri.file(path.join(os.homedir(), fileName));
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            filters: { 'JSON': ['json'] },
            title: Constants.Prompts.ExportGroup.replace('{0}', group.name)
        });

        if (uri) {
            try {
                fs.writeFileSync(uri.fsPath, filtersJson, 'utf8');
                vscode.window.showInformationMessage(Constants.Messages.Info.ExportGroupSuccess.replace('{0}', group.name).replace('{1}', uri.fsPath));
            } catch (err) {
                vscode.window.showErrorMessage(Constants.Messages.Error.ExportGroupFailed.replace('{0}', err instanceof Error ? err.message : String(err)));
            }
        }
    }

    private async handleImport(mode: 'word' | 'regex') {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            title: mode === 'word' ? Constants.Prompts.ImportWordFilters : Constants.Prompts.ImportRegexFilters
        });

        if (uris && uris.length > 0) {
            try {
                const json = fs.readFileSync(uris[0].fsPath, 'utf8');

                const choice = await vscode.window.showQuickPick(
                    [Constants.ImportModes.Merge, Constants.ImportModes.Overwrite],
                    { placeHolder: Constants.Prompts.SelectImportMode }
                );

                if (!choice) {
                    return;
                }

                const overwrite = choice === Constants.ImportModes.Overwrite;
                const result = this.filterManager.importFilters(json, mode, overwrite);

                if (result.error) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.ImportFailed.replace('{0}', result.error));
                } else if (result.count === 0) {
                    vscode.window.showWarningMessage(Constants.Messages.Warn.NoMatchingFilters);
                } else {
                    vscode.window.showInformationMessage(Constants.Messages.Info.ImportSuccess.replace('{0}', result.count.toString()).replace('{1}', mode === 'word' ? 'Word' : 'Regex'));
                }
            } catch (err) {
                vscode.window.showErrorMessage(Constants.Messages.Error.ReadFilterFileFailed.replace('{0}', err instanceof Error ? err.message : String(err)));
            }
        }
    }

    private async expandAllGroups(isRegex: boolean) {
        this.logger.info(`CMD: expandAll${isRegex ? 'Regex' : 'Word'}Groups triggered`);
        const groups = this.filterManager.getGroups().filter(g => !!g.isRegex === isRegex);
        const treeView = isRegex ? this.regexTreeView : this.wordTreeView;

        for (const group of groups) {
            this.filterManager.setGroupExpanded(group.id, true);
            try {
                await treeView.reveal(group, { expand: true, focus: false, select: false });
            } catch (e) {
                this.logger.warn(`Failed to expand group ${group.name}: ${e}`);
            }
        }
    }

    private async collapseAllGroups(isRegex: boolean) {
        this.logger.info(`CMD: collapseAll${isRegex ? 'Regex' : 'Word'}Groups triggered`);
        const groups = this.filterManager.getGroups().filter(g => !!g.isRegex === isRegex);
        const treeView = isRegex ? this.regexTreeView : this.wordTreeView;
        const viewId = isRegex ? Constants.Views.RegexFilters : Constants.Views.Filters;

        // Update persistence state
        for (const group of groups) {
            this.filterManager.setGroupExpanded(group.id, false);
        }

        if (groups.length > 0) {
            try {
                // Ensure view has focus
                await treeView.reveal(groups[0], { select: false, focus: true, expand: undefined });
                // Call the view-specific collapse command
                await vscode.commands.executeCommand(`workbench.actions.treeView.${viewId}.collapseAll`);
            } catch (e) {
                this.logger.warn(`Failed to execute native collapse: ${e}`);
            }
        }
    }

    private async jumpToSource() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const position = editor.selection.active;
        const location = this.sourceMapService.getOriginalLocation(editor.document.uri, position.line);

        if (location) {
            try {
                // Open document
                const doc = await vscode.workspace.openTextDocument(location.uri);
                const sourceEditor = await vscode.window.showTextDocument(doc, { preview: true });

                // Reveal range
                const range = new vscode.Range(location.range.start, location.range.start);
                sourceEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                sourceEditor.selection = new vscode.Selection(range.start, range.start);

                // Flash line
                this.highlightService.flashLine(sourceEditor, range.start.line);
            } catch (e) {
                vscode.window.showErrorMessage(Constants.Messages.Error.JumpToSourceFailed.replace('{0}', e instanceof Error ? e.message : String(e)));
            }
        } else {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoSourceMapping);
        }
    }

    private registerFilterGroupCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddFilterGroup, async () => {
            const name = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterFilterGroupName });
            if (name) {
                const group = this.filterManager.addGroup(name, false);
                if (!group) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.WordFilterGroupExists.replace('{0}', name));
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddRegexFilterGroup, async () => {
            const name = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterRegexFilterGroupName });
            if (name) {
                const group = this.filterManager.addGroup(name, true);
                if (!group) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.RegexFilterGroupExists.replace('{0}', name));
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RenameFilterGroup, async (group: FilterGroup) => {
            if (!group) {
                return;
            }
            const newName = await vscode.window.showInputBox({
                prompt: Constants.Prompts.EnterNewGroupName,
                value: group.name
            });
            if (newName && newName !== group.name) {
                this.filterManager.renameGroup(group.id, newName);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleGroup, (group: FilterGroup) => {
            if (group) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group toggled: ${group.name}`);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EnableGroup, (group: FilterGroup) => {
            if (group && !group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group enabled: ${group.name}`);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DisableGroup, (group: FilterGroup) => {
            if (group && group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group disabled: ${group.name}`);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EnableAllItemsInGroup, (group: FilterGroup) => {
            if (group) {
                this.filterManager.enableAllFiltersInGroup(group.id);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DisableAllItemsInGroup, (group: FilterGroup) => {
            if (group) {
                this.filterManager.disableAllFiltersInGroup(group.id);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyGroupEnabledItems, async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => f.keyword).join('\n');
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(Constants.Messages.Info.CopiedItems.replace('{0}', enabledFilters.length.toString()));
                } else {
                    vscode.window.showInformationMessage(Constants.Messages.Info.NoEnabledItems);
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyGroupEnabledItemsSingleLine, async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => f.keyword).join(' '); // Use space as delimiter
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(Constants.Messages.Info.CopiedItemsSingleLine.replace('{0}', enabledFilters.length.toString()));
                } else {
                    vscode.window.showInformationMessage(Constants.Messages.Info.NoEnabledItems);
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CopyGroupEnabledItemsWithTag, async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => `tag:${f.keyword}`).join(' ');
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(Constants.Messages.Info.CopiedItemsTags.replace('{0}', enabledFilters.length.toString()));
                } else {
                    vscode.window.showInformationMessage(Constants.Messages.Info.NoEnabledItems);
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DeleteGroup, (item: FilterGroup | undefined) => {
            if (item) {
                vscode.commands.executeCommand(Constants.Commands.DeleteFilter, item);
            }
        }));
    }

    private registerFilterItemCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EditFilterItem, async (item: FilterItem) => {
            if (!item) {
                return;
            }

            // Find parent group to determine context (needed for updates)
            const group = this.filterManager.findGroupByFilterId(item.id);

            if (!group) {
                return;
            }

            if (group.isRegex) {
                // Regex Filter: 2-step edit (Name -> Regex)
                const newNickname = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNickname,
                    value: item.nickname || ''
                });

                if (newNickname === undefined) {
                    return;
                }

                const newPattern = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterRegexPattern,
                    value: item.keyword,
                    validateInput: (value) => {
                        try {
                            new RegExp(value);
                            return null;
                        } catch (e) {
                            return Constants.Messages.Error.InvalidRegularExpression;
                        }
                    }
                });

                if (newPattern === undefined) {
                    return;
                }

                if (newNickname !== item.nickname || newPattern !== item.keyword) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        nickname: newNickname,
                        keyword: newPattern
                    });
                }

            } else {
                // Word Filter: simple keyword edit
                const newKeyword = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNewKeyword,
                    value: item.keyword
                });

                if (newKeyword && newKeyword !== item.keyword) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        keyword: newKeyword
                    });
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddFilter, async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, false);
            if (!targetGroupId) {
                return;
            }

            const keyword = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterFilterKeyword });
            if (!keyword) {
                return;
            }

            const type = Constants.FilterTypes.Include as FilterType;
            const filter = this.filterManager.addFilter(targetGroupId, keyword, type, false);
            if (!filter) {
                vscode.window.showErrorMessage(Constants.Messages.Error.FilterExistsInGroup.replace('{0}', keyword).replace('{1}', type));
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddRegexFilter, async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, true);
            if (!targetGroupId) {
                return;
            }

            const nickname = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterFilterNickname });
            if (!nickname) {
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: Constants.Prompts.EnterRegexPattern,
                validateInput: (value) => {
                    try {
                        new RegExp(value);
                        return null;
                    } catch (e) {
                        return Constants.Messages.Error.InvalidRegularExpression;
                    }
                }
            });
            if (!pattern) {
                return;
            }

            const filter = this.filterManager.addFilter(targetGroupId, pattern, Constants.FilterTypes.Include as FilterType, true, nickname);
            if (!filter) {
                vscode.window.showErrorMessage(Constants.Messages.Error.RegexFilterExists.replace('{0}', pattern).replace('{1}', nickname || ''));
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddSelectionToFilter, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage(Constants.Messages.Info.SelectTextFirst);
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            if (!selectedText) {
                return;
            }

            // Check for focused group in Word Search view
            const focusedItem = this.wordTreeView.selection[0];
            let targetGroupId: string | undefined;

            if (focusedItem) {
                // Determine group ID from focused item
                if ((focusedItem as FilterGroup).filters !== undefined) {
                    // It is a group
                    targetGroupId = focusedItem.id;
                } else {
                    // It is an item, find its parent group
                    const parentGroup = this.filterManager.findGroupByFilterId(focusedItem.id);
                    if (parentGroup) {
                        targetGroupId = parentGroup.id;
                    }
                }
            }

            if (targetGroupId) {
                // Add to existing group
                // Check if it's a regex group.
                // Requirement implies "Word filters".
                const targetGroup = this.filterManager.getGroups().find(g => g.id === targetGroupId);
                if (targetGroup) {
                    if (targetGroup.isRegex) {
                        // Cannot add simple text selection to regex group as-is.
                        // Assume we only target Word Filter groups context.
                        targetGroupId = undefined;
                    } else {
                        // Check for duplicate keyword regardless of type
                        const existingFilter = targetGroup.filters.find(f => f.keyword.toLowerCase() === selectedText.toLowerCase());
                        if (existingFilter) {
                            vscode.window.showWarningMessage(Constants.Messages.Warn.FilterAlreadyExistsInGroup.replace('{0}', selectedText).replace('{1}', targetGroup.name));
                            return;
                        }
                    }
                }
            }

            if (!targetGroupId) {
                // Create new group with keyword name
                // If group doesn't exist, create it.
                const newGroup = this.filterManager.addGroup(selectedText, false);
                if (newGroup) {
                    targetGroupId = newGroup.id;
                } else {
                    // Group with same name exists.
                    const existingGroup = this.filterManager.getGroups().find(g => g.name === selectedText && !g.isRegex);
                    if (existingGroup) {
                        targetGroupId = existingGroup.id;
                        // Check for duplicate in this existing group as well, just in case
                        const existingFilter = existingGroup.filters.find(f => f.keyword.toLowerCase() === selectedText.toLowerCase());
                        if (existingFilter) {
                            vscode.window.showWarningMessage(Constants.Messages.Warn.FilterAlreadyExistsInGroup.replace('{0}', selectedText).replace('{1}', existingGroup.name));
                            return;
                        }
                    }
                }
            }

            if (targetGroupId) {
                this.filterManager.addFilter(targetGroupId, selectedText, Constants.FilterTypes.Include as FilterType, false);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RemoveMatchesWithSelection, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage(Constants.Messages.Info.SelectTextFirst);
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            if (!selectedText) {
                return;
            }

            const doc = editor.document;
            const fullText = doc.getText();
            // Split by newline to process lines without object overhead
            const lines = fullText.split(/\r?\n/);

            const rangesToDelete: vscode.Range[] = [];
            let matchCount = 0;

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(selectedText)) {
                    // Create range for the entire line including the line break
                    rangesToDelete.push(new vscode.Range(i, 0, i + 1, 0));
                    matchCount++;
                }
            }

            if (matchCount === 0) {
                vscode.window.showInformationMessage(Constants.Messages.Info.NoMatchesForText.replace('{0}', selectedText));
                return;
            }

            // Confirm deletion if many lines
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const removeMatchesMaxLines = config.get<number>(Constants.Configuration.Editor.RemoveMatchesMaxLines, 2000);

            if (matchCount > removeMatchesMaxLines) {
                const response = await vscode.window.showWarningMessage(
                    Constants.Messages.Warn.RemoveMatchesConfirm.replace('{0}', matchCount.toString()).replace('{1}', selectedText),
                    'Yes', 'No'
                );
                if (response !== 'Yes') {
                    return;
                }
            }

            const edits = new vscode.WorkspaceEdit();
            for (const range of rangesToDelete) {
                edits.delete(doc.uri, range);
            }

            await vscode.workspace.applyEdit(edits);
            vscode.window.showInformationMessage(Constants.Messages.Info.RemovedLines.replace('{0}', matchCount.toString()).replace('{1}', selectedText));
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EnableFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'enable');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DisableFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'disable');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'toggle');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CreateFilter, (item: FilterGroup | undefined) => {
            // Pass the item (Group) to the AddFilter command so it knows where to add
            vscode.commands.executeCommand(Constants.Commands.AddFilter, item);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CreateRegexFilter, (item: FilterGroup | undefined) => {
            vscode.commands.executeCommand(Constants.Commands.AddRegexFilter, item);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DeleteFilter, async (item: FilterGroup | FilterItem) => {
            if (!item) {
                return;
            }
            if ((item as FilterGroup).filters !== undefined) {
                this.filterManager.removeGroup(item.id);
            } else {
                const group = this.filterManager.findGroupByFilterId(item.id);
                if (group) {
                    this.filterManager.removeFilter(group.id, item.id);
                }
            }
        }));
    }

    private registerViewCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExpandAllWordGroups, async () => {
            await this.expandAllGroups(false);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExpandAllRegexGroups, async () => {
            await this.expandAllGroups(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CollapseAllWordGroups, async () => {
            await this.collapseAllGroups(false);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CollapseAllRegexGroups, async () => {
            await this.collapseAllGroups(true);
        }));
    }

    private registerPropertyToggleCommands() {
        const toggleFilterTypeHandler = (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterType(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Include, toggleFilterTypeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Exclude, toggleFilterTypeHandler));


        const setFilterTypeHandler = (type: FilterType) => (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterType(targetGroup.id, item.id, type);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Include, setFilterTypeHandler(Constants.FilterTypes.Include)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Exclude, setFilterTypeHandler(Constants.FilterTypes.Exclude)));


        const setExcludeStyleHandler = (style: 'line-through' | 'hidden') => (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterExcludeStyle(targetGroup.id, item.id, style);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.LineThrough, setExcludeStyleHandler('line-through')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.Hidden, setExcludeStyleHandler('hidden')));


        const toggleHighlightModeHandler = (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Word, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Line, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Full, toggleHighlightModeHandler));


        const setHighlightModeHandler = (mode: number) => (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterHighlightMode(targetGroup.id, item.id, mode);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Word, setHighlightModeHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Line, setHighlightModeHandler(1)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Full, setHighlightModeHandler(2)));


        const toggleCaseSensitivityHandler = (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.On, toggleCaseSensitivityHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.Off, toggleCaseSensitivityHandler));


        const setCaseSensitivityHandler = (enable: boolean) => (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterCaseSensitivity(targetGroup.id, item.id, enable);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.On, setCaseSensitivityHandler(true)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.Off, setCaseSensitivityHandler(false)));


        const toggleContextLineHandler = (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterContextLine(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.None, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus3, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus5, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus9, toggleContextLineHandler));


        const setContextLineHandler = (lines: number) => (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterContextLine(targetGroup.id, item.id, lines);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.None, setContextLineHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus3, setContextLineHandler(3)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus5, setContextLineHandler(5)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus9, setContextLineHandler(9)));


        const changeColorHandler = async (item: FilterItem) => {
            let targetGroup = this.filterManager.findGroupByFilterId(item.id);

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
                    placeHolder: Constants.Prompts.SelectColor,
                    ignoreFocusOut: false
                });

                if (picked) {
                    this.filterManager.updateFilterColor(targetGroup.id, item.id, picked.label);
                }
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ChangeFilterColor.Prefix, changeColorHandler));

        // Register specific color commands to support specific tooltips
        const colorPresets = this.filterManager.getAvailableColors();
        colorPresets.forEach(colorId => {
            this.context.subscriptions.push(vscode.commands.registerCommand(`${Constants.Commands.ChangeFilterColor.Prefix}.${colorId}`, changeColorHandler));
        });
    }

    private registerEditorToggleCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Enable, () => {
            this.setPrependLineNumbersEnabled(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Disable, () => {
            this.setPrependLineNumbersEnabled(false);
        }));


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleWordWrap, async () => {
            await vscode.commands.executeCommand('editor.action.toggleWordWrap');
        }));


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleMinimap, async () => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section);
            const current = config.get<boolean>(Constants.Configuration.Editor.MinimapEnabled);
            await config.update(Constants.Configuration.Editor.MinimapEnabled, !current, vscode.ConfigurationTarget.Global);
        }));


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleStickyScroll, async () => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section);
            const current = config.get<boolean>(Constants.Configuration.Editor.StickyScrollEnabled);
            await config.update(Constants.Configuration.Editor.StickyScrollEnabled, !current, vscode.ConfigurationTarget.Global);
        }));


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleOccurrencesHighlight, async (value?: boolean | string) => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section);

            // If argument is provided, set it directly
            if (value !== undefined) {
                await config.update('occurrencesHighlight', value, vscode.ConfigurationTarget.Global);
                this.quickAccessProvider.refresh();
                return;
            }

            // Legacy/Fallback: Show Quick Pick
            const currentValue = config.get<boolean | string>('occurrencesHighlight'); // 'off' | 'singleFile' | 'multiFile' (boolean false is off)

            // Map current value to QuickPick selection
            let currentLabel = 'Off';
            if (currentValue === 'singleFile' || currentValue === true) {
                currentLabel = 'Single File';
            } else if (currentValue === 'multiFile') {
                currentLabel = 'Multi File';
            }

            const options: vscode.QuickPickItem[] = [
                { label: Constants.Labels.Off, description: Constants.Descriptions.OccurrencesOff },
                { label: Constants.Labels.SingleFile, description: Constants.Descriptions.OccurrencesSingle },
                { label: Constants.Labels.MultiFile, description: Constants.Descriptions.OccurrencesMulti }
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: Constants.Prompts.SelectOccurrencesHighlightMode.replace('{0}', currentLabel)
            });

            if (selected) {
                let newValue: boolean | string = 'off';
                if (selected.label === Constants.Labels.SingleFile) {
                    newValue = 'singleFile';
                } else if (selected.label === Constants.Labels.MultiFile) {
                    newValue = 'multiFile';
                }

                await config.update('occurrencesHighlight', newValue, vscode.ConfigurationTarget.Global);
                this.quickAccessProvider.refresh();
            }
        }));


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFileSizeUnit, () => {
            this.quickAccessProvider.toggleFileSizeUnit();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleJsonPreview, async () => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const current = config.get<boolean>(Constants.Configuration.JsonPreviewEnabled);
            const newValue = !current;
            await config.update(Constants.Configuration.JsonPreviewEnabled, newValue, vscode.ConfigurationTarget.Global);
            this.quickAccessProvider.refresh();

            if (newValue) {
                this.jsonPrettyService.execute(true);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyJsonPretty, async () => {
            await this.jsonPrettyService.execute();
        }));
    }

    private registerExportImportCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportWordFilters, () => this.handleExport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportRegexFilters, () => this.handleExport('regex')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportGroup, (group: FilterGroup) => this.handleExportGroup(group)));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportWordFilters, () => this.handleImport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportRegexFilters, () => this.handleImport('regex')));
    }

    private registerNavigateCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.JumpToSource, () => this.jumpToSource()));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.NextMatch, async (item: FilterItem) => {
            await this.findMatch(item, 'next');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.PreviousMatch, async (item: FilterItem) => {
            await this.findMatch(item, 'previous');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyWordFilter, () => this.applyFilter('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyRegexFilter, () => this.applyFilter('regex')));
    }

    private registerProfileCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ManageProfiles, async () => {
            const activeProfile = this.filterManager.getActiveProfile();
            const profilesMetadata = this.filterManager.getProfilesMetadata();

            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = `Manage Profiles (Current: ${activeProfile})`;
            quickPick.ignoreFocusOut = false;

            const updateItems = () => {
                const items: vscode.QuickPickItem[] = [];

                // Action: New Profile
                items.push({
                    label: `$(plus) ${Constants.Labels.NewProfile}`,
                    description: Constants.Descriptions.CreateNewProfile
                });

                // Action: Duplicate (Clone)
                items.push({
                    label: `$(copy) ${Constants.Labels.DuplicateProfile}`,
                    description: Constants.Descriptions.DuplicateProfile
                });

                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

                // List Profiles
                const profileItems = profilesMetadata.map(p => {
                    return {
                        label: p.name === activeProfile ? `$(check) ${p.name}` : p.name,
                        description: p.name === activeProfile
                            ? `Active (Word: ${p.wordCount}, Regex: ${p.regexCount})`
                            : `(Word: ${p.wordCount}, Regex: ${p.regexCount})`,
                        detail: 'Switch to this profile',
                        buttons: p.name === Constants.Labels.DefaultProfile ? [] : [
                            {
                                iconPath: new vscode.ThemeIcon('trash'),
                                tooltip: 'Delete Profile'
                            }
                        ]
                    } as vscode.QuickPickItem;
                });

                items.push(...profileItems);
                quickPick.items = items;
            };

            updateItems();

            quickPick.onDidTriggerItemButton(async e => {
                const profileName = e.item.label.replace('$(check) ', '').trim();

                // Confirm deletion
                const confirm = await vscode.window.showWarningMessage(
                    Constants.Messages.Warn.ConfirmDeleteProfile.replace('{0}', profileName),
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    await this.filterManager.deleteProfile(profileName);
                    vscode.window.showInformationMessage(Constants.Messages.Info.ProfileDeleted.replace('{0}', profileName));

                    // Refresh list
                    quickPick.hide();
                    vscode.commands.executeCommand(Constants.Commands.ManageProfiles);
                }
            });

            quickPick.onDidChangeSelection(async selection => {
                if (selection[0]) {
                    const label = selection[0].label;

                    if (label.includes('New Profile')) {
                        quickPick.hide();
                        const name = await vscode.window.showInputBox({
                            prompt: Constants.Prompts.EnterNewProfileName,
                            validateInput: (value) => {
                                if (profilesMetadata.some(p => p.name === value)) {
                                    return 'Profile with this name already exists';
                                }
                                return null;
                            }
                        });
                        if (name) {
                            const success = await this.filterManager.createProfile(name);
                            if (success) {
                                vscode.window.showInformationMessage(Constants.Messages.Info.ProfileCreated.replace('{0}', name));
                            } else {
                                vscode.window.showErrorMessage(Constants.Messages.Error.ProfileCreateFailed.replace('{0}', name));
                            }
                        }

                    } else if (label.includes('Duplicate Profile')) {
                        quickPick.hide();
                        const name = await vscode.window.showInputBox({
                            prompt: Constants.Prompts.EnterDuplicateProfileName,
                            value: `${activeProfile} (Copy)`
                        });
                        if (name) {
                            await this.filterManager.saveProfile(name);
                            vscode.window.showInformationMessage(Constants.Messages.Info.ProfileDuplicated.replace('{0}', name));
                        }

                    } else {
                        // Switch Profile
                        const profileName = label.replace('$(check) ', '').trim();
                        if (profileName !== activeProfile) {
                            quickPick.hide();
                            await this.filterManager.loadProfile(profileName);
                            vscode.window.showInformationMessage(Constants.Messages.Info.ProfileSwitched.replace('{0}', profileName));
                        } else {
                            // Already active
                            quickPick.hide();
                        }
                    }
                }
            });

            quickPick.show();
        }));
    }
}
