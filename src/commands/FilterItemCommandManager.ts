import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';
import { Logger } from '../services/Logger';

export class FilterItemCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private logger: Logger,
        private wordTreeView: vscode.TreeView<FilterGroup | FilterItem>
    ) {
        this.registerCommands();
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
                        } catch (_e) {
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
                    } catch (_e) {
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
}
