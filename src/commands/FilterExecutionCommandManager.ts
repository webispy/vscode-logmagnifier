import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { HighlightService } from '../services/HighlightService';
import { LogProcessor } from '../services/LogProcessor';
import { Logger } from '../services/Logger';
import { SourceMapService } from '../services/SourceMapService';
import { FilterGroup, FilterItem } from '../models/Filter';
import { RegexUtils } from '../utils/RegexUtils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class FilterExecutionCommandManager {
    private _prependLineNumbersEnabled: boolean = false;
    private isProcessing = false;

    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private highlightService: HighlightService,
        private logProcessor: LogProcessor,
        private logger: Logger,
        private sourceMapService: SourceMapService,
        private wordTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private regexTreeView: vscode.TreeView<FilterGroup | FilterItem>
    ) {
        this.registerCommands();
        // Initialize context key
        this.setPrependLineNumbersEnabled(false);
    }

    private setPrependLineNumbersEnabled(value: boolean) {
        this._prependLineNumbersEnabled = value;
        vscode.commands.executeCommand('setContext', Constants.ContextKeys.PrependLineNumbersEnabled, value);
    }

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
            const stats = { processed: 0, matched: 0 };
            const sourceName = document ? (document.fileName || 'Untitled') : (filePathFromTab || 'Large File');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Applying ${filterType || ''} Filters on ${sourceName}...`,
                cancellable: false
            }, async (_progress) => {
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
                            } catch (_e) { /* ignore cleanup error */ }
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.ApplyFiltersError.replace('{0}', error instanceof Error ? error.message : String(error)));
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
                        } catch (_e) { /* ignore */ }
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

    private registerCommands() {
        // Prepend line numbers toggle
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Enable, () => {
            this.setPrependLineNumbersEnabled(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Disable, () => {
            this.setPrependLineNumbersEnabled(false);
        }));

        // View commands
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

        // Navigate commands
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
}
