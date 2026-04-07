import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem } from '../models/Filter';

import { FilterManager } from '../services/FilterManager';
import { HighlightService } from '../services/HighlightService';
import { LogProcessor } from '../services/LogProcessor';
import { Logger } from '../services/Logger';
import { LineMappingService } from '../services/LineMappingService';
import { EditorUtils } from '../utils/EditorUtils';
import { RegexUtils } from '../utils/RegexUtils';

export class FilterExecutionCommandManager {
    private prependLineNumbersEnabled: boolean = false;
    private isProcessing = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly filterManager: FilterManager,
        private readonly highlightService: HighlightService,
        private readonly logProcessor: LogProcessor,
        private readonly logger: Logger,
        private readonly lineMappingService: LineMappingService,
        private readonly textTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private readonly regexTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        registerCommands: boolean = true
    ) {
        if (registerCommands) {
            this.registerCommands();
        }
        // Initialize context key
        this.setPrependLineNumbersEnabled(false);
    }

    /** Updates the prepend-line-numbers flag and syncs the VS Code context key. */
    private setPrependLineNumbersEnabled(value: boolean) {
        this.prependLineNumbersEnabled = value;
        vscode.commands.executeCommand('setContext', Constants.ContextKeys.PrependLineNumbersEnabled, value).then(undefined, (e: unknown) =>
            this.logger.error(`[FilterExecution] setContext failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    /**
     * Applies enabled filters to the active document, writing matched lines to a new output file.
     * @param filterType Limits execution to word or regex groups; omit to apply both.
     * @param targetGroup When provided, runs only that group regardless of its enabled state.
     */
    private async applyFilter(filterType?: 'word' | 'regex', targetGroup?: FilterGroup) {
        if (this.isProcessing) {
            vscode.window.showWarningMessage(Constants.Messages.Warn.FilterAlreadyProcessing);
            return;
        }
        this.isProcessing = true;

        try {
            // 1. Select relevant groups (Target specific or All)
            let candidateGroups = this.filterManager.getGroups();
            if (targetGroup) {
                // Specific Run: Use target group regardless of enabled state
                candidateGroups = candidateGroups.filter(g => g.id === targetGroup.id);
            } else {
                // Global Apply: Use ONLY enabled groups
                candidateGroups = candidateGroups.filter(g => g.isEnabled);
            }

            candidateGroups = candidateGroups.filter(g => {
                if (filterType === 'word') {
                    return !g.isRegex;
                }
                if (filterType === 'regex') {
                    return g.isRegex;
                }
                return true;
            });

            // 3. Validate "Effective" Groups
            const activeGroups = candidateGroups.filter(g => {
                // Only keep groups that have at least one enabled filter.
                // The group's own enabled state is ignored.
                return g.filters.some(f => f.isEnabled);
            });

            if (activeGroups.length === 0) {
                const displayType = filterType === 'word' ? 'text' : filterType;
                vscode.window.showWarningMessage(Constants.Messages.Warn.NoActiveGroups.replace('{0}', displayType || 'filter'));
                return;
            }

            let document = await EditorUtils.resolveActiveDocument();
            let filePathFromTab: string | undefined;

            if (!document) {
                const uri = EditorUtils.resolveActiveUri();
                if (uri) {
                    if (uri.scheme === 'file') {
                        filePathFromTab = uri.fsPath;
                    } else if (uri.scheme === 'untitled') {
                        try {
                            // Try to open validation doc if possible
                            const doc = await vscode.workspace.openTextDocument(uri);
                            document = doc;
                        } catch (e: unknown) {
                            this.logger.error(`[FilterExecutionCommandManager] ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                }
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
                        prependLineNumbers: this.prependLineNumbersEnabled,
                        totalLineCount: totalLineCount,
                        content: document ? document.getText() : undefined
                    });
                    outputPath = result.outputPath;
                    stats.processed = result.processed;
                    stats.matched = result.matched;

                    // Register line mapping
                    let sourceUri: vscode.Uri | undefined;
                    if (document) {
                        sourceUri = document.uri;
                    } else if (filePathFromTab) {
                        sourceUri = vscode.Uri.file(filePathFromTab);
                    }

                    if (sourceUri && result.lineMapping) {
                        const outputUri = vscode.Uri.file(outputPath);
                        this.lineMappingService.register(outputUri, sourceUri, result.lineMapping);
                    }
                } catch (e: unknown) {
                    vscode.window.showErrorMessage(Constants.Messages.Error.ApplyFiltersError.replace('{0}', e instanceof Error ? e.message : String(e)));
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
                        } catch (e: unknown) {
                            this.logger.info(`[FilterExecutionCommandManager] Set language failed: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                } catch (e: unknown) {
                    this.logger.info(`[FilterExecutionCommandManager] ${Constants.Messages.Info.FallbackToOpen.replace('{0}', e instanceof Error ? e.message : String(e))}`);
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Navigates to the next or previous match of a filter pattern in the active editor.
     * @param item The filter item whose pattern to search for; falls back to tree view selection.
     * @param direction Whether to search forward or backward, wrapping at document boundaries.
     */
    private async findMatch(item: FilterItem | undefined, direction: 'next' | 'previous') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // If no item passed (via shortcut), try to get from TreeView selection
        if (!item) {
            const selection = this.textTreeView.selection;
            if (selection && selection.length > 0) {
                const selected = selection[0];
                // Ensure it is a FilterItem (not a Group) and it is enabled
                if ('pattern' in selected) { // Simple check for FilterItem
                    item = selected as FilterItem;
                }
            }
        }

        if (!item) {
            vscode.window.showInformationMessage(Constants.Messages.Info.SelectFilterFirst);
            return;
        }

        if (!item.isEnabled) {
            vscode.window.showInformationMessage(Constants.Messages.Info.FilterDisabled.replace('{0}', item.pattern));
            return;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Use RegexUtils
        const isRegex = !!item.isRegex;
        const caseSensitive = !!item.caseSensitive;
        const regex = RegexUtils.create(item.pattern, isRegex, caseSensitive);

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
            const offset = document.offsetAt(selection.start);
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

    /** Expands all filter groups of the given type in the corresponding tree view. */
    private async expandAllGroups(isRegex: boolean) {
        this.logger.info(`[FilterExecutionCommandManager] CMD: expandAll${isRegex ? 'Regex' : 'Text'}Groups triggered`);
        const groups = this.filterManager.getGroups().filter(g => !!g.isRegex === isRegex);
        const treeView = isRegex ? this.regexTreeView : this.textTreeView;

        for (const group of groups) {
            this.filterManager.setGroupExpanded(group.id, true);
            try {
                await treeView.reveal(group, { expand: true, focus: false, select: false });
            } catch (e: unknown) {
                this.logger.warn(`[FilterExecutionCommandManager] Failed to expand group ${group.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    /** Collapses all filter groups of the given type using the native tree collapse command. */
    private async collapseAllGroups(isRegex: boolean) {
        this.logger.info(`[FilterExecutionCommandManager] CMD: collapseAll${isRegex ? 'Regex' : 'Text'}Groups triggered`);
        const groups = this.filterManager.getGroups().filter(g => !!g.isRegex === isRegex);
        const treeView = isRegex ? this.regexTreeView : this.textTreeView;
        const viewId = isRegex ? Constants.Views.RegexFilters : Constants.Views.TextFilters;

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
            } catch (e: unknown) {
                this.logger.warn(`[FilterExecutionCommandManager] Failed to execute native collapse: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    /** Navigates from a filtered output line back to its original location in the source file. */
    private async jumpToSource() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const position = editor.selection.active;
        const location = this.lineMappingService.getOriginalLocation(editor.document.uri, position.line);

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
            } catch (e: unknown) {
                vscode.window.showErrorMessage(Constants.Messages.Error.JumpToSourceFailed.replace('{0}', e instanceof Error ? e.message : String(e)));
            }
        } else {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoSourceMapping);
        }
    }

    /** Registers all filter execution, navigation, and view toggle commands. */
    private registerCommands() {
        // Prepend line numbers
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetPrependLineNumbers.Enable, () => {
            this.setPrependLineNumbersEnabled(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetPrependLineNumbers.Disable, () => {
            this.setPrependLineNumbersEnabled(false);
        }));

        // View commands
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExpandAllTextGroups, async () => {
            await this.expandAllGroups(false);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExpandAllRegexGroups, async () => {
            await this.expandAllGroups(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CollapseAllTextGroups, async () => {
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

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyTextFilter, () => this.applyFilter('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.RunFilterGroup, (group: FilterGroup) => {
            const type = group.isRegex ? 'regex' : 'word';
            this.applyFilter(type, group);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyRegexFilter, () => this.applyFilter('regex')));
    }
}
