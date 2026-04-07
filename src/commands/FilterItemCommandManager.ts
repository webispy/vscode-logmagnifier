import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';

import { FilterManager } from '../services/FilterManager';
import { Logger } from '../services/Logger';

export class FilterItemCommandManager {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly filterManager: FilterManager,
        private readonly logger: Logger,
        private readonly textTreeView: vscode.TreeView<FilterGroup | FilterItem>
    ) {
        this.registerCommands();
    }

    /** Enables, disables, or toggles a filter item within its parent group. */
    private handleFilterToggle(item: FilterItem, action: 'enable' | 'disable' | 'toggle') {
        const group = this.filterManager.findGroupByFilterId(item.id);
        if (group) {
            if (action === 'enable' && !item.isEnabled) {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`[FilterItemCommandManager] Filter enabled: ${item.pattern}`);
            } else if (action === 'disable' && item.isEnabled) {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`[FilterItemCommandManager] Filter disabled: ${item.pattern}`);
            } else if (action === 'toggle') {
                this.filterManager.toggleFilter(group.id, item.id);
                this.logger.info(`[FilterItemCommandManager] Filter toggled: ${item.pattern}`);
            }
        }
    }

    /** Returns the group ID, prompting the user to pick one if not provided. */
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

    private registerCommands() {
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
                const newNickname = (await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNickname,
                    value: item.nickname || '',
                    validateInput: (v) => v.length > Constants.Defaults.MaxNameLength
                        ? Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxNameLength))
                        : null,
                }))?.trim();

                if (newNickname === undefined) {
                    return;
                }

                const newPattern = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterRegexPattern,
                    value: item.pattern,
                    validateInput: (value) => {
                        if (value.length > Constants.Defaults.MaxPatternLength) {
                            return Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxPatternLength));
                        }
                        try {
                            new RegExp(value);
                            return null;
                        } catch (_e: unknown) {
                            return Constants.Messages.Error.InvalidRegularExpression;
                        }
                    }
                });

                if (newPattern === undefined) {
                    return;
                }

                if (newNickname !== item.nickname || newPattern !== item.pattern) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        nickname: newNickname,
                        pattern: newPattern
                    });
                }

            } else {
                // Text Filter: simple pattern edit
                const newPattern = await vscode.window.showInputBox({
                    prompt: Constants.Prompts.EnterNewPattern,
                    value: item.pattern,
                    validateInput: (v) => v.length > Constants.Defaults.MaxPatternLength
                        ? Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxPatternLength))
                        : null,
                });

                if (newPattern && newPattern !== item.pattern) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        pattern: newPattern
                    });
                }
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddTextFilter, async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, false);
            if (!targetGroupId) {
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: Constants.Prompts.EnterFilterPattern,
                validateInput: (v) => v.length > Constants.Defaults.MaxPatternLength
                    ? Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxPatternLength))
                    : null,
            });
            if (!pattern) {
                return;
            }

            const type = Constants.FilterTypes.Include as FilterType;
            const filter = this.filterManager.addFilter(targetGroupId, pattern, type, false);
            if (!filter) {
                vscode.window.showErrorMessage(Constants.Messages.Error.FilterExistsInGroup.replace('{0}', pattern).replace('{1}', type));
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddRegexFilter, async (group: FilterGroup | undefined) => {
            const targetGroupId = await this.ensureGroupId(group, true);
            if (!targetGroupId) {
                return;
            }

            const nickname = (await vscode.window.showInputBox({
                prompt: Constants.Prompts.EnterFilterNickname,
                validateInput: (v) => v.length > Constants.Defaults.MaxNameLength
                    ? Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxNameLength))
                    : null,
            }))?.trim();
            if (!nickname) {
                return;
            }

            const pattern = await vscode.window.showInputBox({
                prompt: Constants.Prompts.EnterRegexPattern,
                validateInput: (value) => {
                    if (value.length > Constants.Defaults.MaxPatternLength) {
                        return Constants.Messages.Error.InputTooLong.replace('{0}', String(Constants.Defaults.MaxPatternLength));
                    }
                    try {
                        new RegExp(value);
                        return null;
                    } catch (_e: unknown) {
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

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddSelectionToTextFilter, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage(Constants.Messages.Info.SelectTextFirst);
                return;
            }

            const selectedText = editor.document.getText(editor.selection);
            if (!selectedText) {
                return;
            }

            // Check for focused group in Text Filters view
            const focusedItem = this.textTreeView.selection[0];
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
                // Requirement implies "Text filters".
                const targetGroup = this.filterManager.getGroups().find(g => g.id === targetGroupId);
                if (targetGroup) {
                    if (targetGroup.isRegex) {
                        // Cannot add simple text selection to regex group as-is.
                        // Assume we only target Text Filter groups context.
                        targetGroupId = undefined;
                    } else {
                        // Check for duplicate pattern regardless of type
                        const existingFilter = targetGroup.filters.find(f => f.pattern.toLowerCase() === selectedText.toLowerCase());
                        if (existingFilter) {
                            vscode.window.showWarningMessage(Constants.Messages.Warn.FilterAlreadyExistsInGroup.replace('{0}', selectedText).replace('{1}', targetGroup.name));
                            return;
                        }
                    }
                }
            }

            if (!targetGroupId) {
                // Create new group with pattern name
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
                        const existingFilter = existingGroup.filters.find(f => f.pattern.toLowerCase() === selectedText.toLowerCase());
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

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CreateTextFilter, (item: FilterGroup | undefined) => {
            // Pass the item (Group) to the AddFilter command so it knows where to add
            vscode.commands.executeCommand(Constants.Commands.AddTextFilter, item).then(undefined, (e: unknown) =>
                this.logger.error(`[FilterItemCommand] CreateFilter failed: ${e instanceof Error ? e.message : String(e)}`));
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CreateRegexFilter, (item: FilterGroup | undefined) => {
            vscode.commands.executeCommand(Constants.Commands.AddRegexFilter, item).then(undefined, (e: unknown) =>
                this.logger.error(`[FilterItemCommand] CreateRegexFilter failed: ${e instanceof Error ? e.message : String(e)}`));
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
}
