import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup } from '../models/Filter';
import { Logger } from '../services/Logger';

export class FilterGroupCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private logger: Logger
    ) {
        this.registerCommands();
    }

    private registerCommands() {
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
}
