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
        private regexTreeView: vscode.TreeView<FilterGroup | FilterItem>
    ) {
        this.registerCommands();
        // Initialize context key
        this.setPrependLineNumbersEnabled(false);
    }

    private _prependLineNumbersEnabled: boolean = false;

    private setPrependLineNumbersEnabled(value: boolean) {
        this._prependLineNumbersEnabled = value;
        vscode.commands.executeCommand('setContext', Constants.ContextKeys.PrependLineNumbersEnabled, value);
    }

    private registerCommands() {
        // Command: Add Word Filter Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddFilterGroup, async () => {
            const name = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterFilterGroupName });
            if (name) {
                const group = this.filterManager.addGroup(name, false);
                if (!group) {
                    vscode.window.showErrorMessage(`Word Filter Group '${name}' already exists.`);
                }
            }
        }));

        // Command: Add Regex Filter Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.AddRegexFilterGroup, async () => {
            const name = await vscode.window.showInputBox({ prompt: Constants.Prompts.EnterRegexFilterGroupName });
            if (name) {
                const group = this.filterManager.addGroup(name, true);
                if (!group) {
                    vscode.window.showErrorMessage(`Regex Filter Group '${name}' already exists.`);
                }
            }
        }));

        // Command: Rename Filter Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.renameFilterGroup', async (group: FilterGroup) => {
            if (!group) {
                return;
            }
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new group name',
                value: group.name
            });
            if (newName && newName !== group.name) {
                this.filterManager.renameGroup(group.id, newName);
            }
        }));

        // Command: Edit Filter Item
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.editFilterItem', async (item: FilterItem) => {
            if (!item) {
                return;
            }

            // Find parent group to determine context (needed for updates)
            const groups = this.filterManager.getGroups();
            const group = groups.find(g => g.filters.some(f => f.id === item.id));

            if (!group) {
                return;
            }

            if (group.isRegex) {
                // Regex Filter: 2-step edit (Name -> Regex)
                const newNickname = await vscode.window.showInputBox({
                    prompt: 'Enter Name (Nickname)',
                    value: item.nickname || ''
                });

                if (newNickname === undefined) { return; } // Cancelled

                const newPattern = await vscode.window.showInputBox({
                    prompt: 'Enter Regex Pattern',
                    value: item.keyword,
                    validateInput: (value) => {
                        try {
                            new RegExp(value);
                            return null;
                        } catch (e) {
                            return 'Invalid Regular Expression';
                        }
                    }
                });

                if (newPattern === undefined) { return; } // Cancelled

                if (newNickname !== item.nickname || newPattern !== item.keyword) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        nickname: newNickname,
                        keyword: newPattern
                    });
                }

            } else {
                // Word Filter: simple keyword edit
                const newKeyword = await vscode.window.showInputBox({
                    prompt: 'Enter new keyword',
                    value: item.keyword
                });

                if (newKeyword && newKeyword !== item.keyword) {
                    this.filterManager.updateFilter(group.id, item.id, {
                        keyword: newKeyword
                    });
                }
            }
        }));

        // Command: Expand All Word Groups
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.expandAllWordGroups', async () => {
            this.logger.info('CMD: expandAllWordGroups triggered');
            const wordGroups = this.filterManager.getGroups().filter(g => !g.isRegex);

            for (const group of wordGroups) {
                this.filterManager.setGroupExpanded(group.id, true);
                try {
                    await this.wordTreeView.reveal(group, { expand: true, focus: false, select: false });
                } catch (e) {
                    this.logger.warn(`Failed to expand word group ${group.name}: ${e}`);
                }
            }
        }));

        // Command: Expand All Regex Groups
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.expandAllRegexGroups', async () => {
            this.logger.info('CMD: expandAllRegexGroups triggered');
            const regexGroups = this.filterManager.getGroups().filter(g => g.isRegex);

            for (const group of regexGroups) {
                this.filterManager.setGroupExpanded(group.id, true);
                try {
                    await this.regexTreeView.reveal(group, { expand: true, focus: false, select: false });
                } catch (e) {
                    this.logger.warn(`Failed to expand regex group ${group.name}: ${e}`);
                }
            }
        }));

        // Command: Collapse All Word Groups
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.collapseAllWordGroups', async () => {
            this.logger.info('CMD: collapseAllWordGroups triggered');
            const wordGroups = this.filterManager.getGroups().filter(g => !g.isRegex);

            // Update persistence state
            for (const group of wordGroups) {
                this.filterManager.setGroupExpanded(group.id, false);
            }

            if (wordGroups.length > 0) {
                try {
                    // Ensure view has focus so the generic command works on IT
                    await this.wordTreeView.reveal(wordGroups[0], { select: false, focus: true, expand: undefined });
                    // Call the view-specific collapse command generated by showCollapseAll: true
                    await vscode.commands.executeCommand('workbench.actions.treeView.logmagnifier-filters.collapseAll');
                } catch (e) {
                    this.logger.warn(`Failed to execute native collapse: ${e}`);
                }
            }
        }));

        // Command: Collapse All Regex Groups
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.collapseAllRegexGroups', async () => {
            this.logger.info('CMD: collapseAllRegexGroups triggered');
            const regexGroups = this.filterManager.getGroups().filter(g => g.isRegex);

            // Update persistence state
            for (const group of regexGroups) {
                this.filterManager.setGroupExpanded(group.id, false);
            }

            if (regexGroups.length > 0) {
                try {
                    // Ensure view has focus
                    await this.regexTreeView.reveal(regexGroups[0], { select: false, focus: true, expand: undefined });
                    // Call the view-specific collapse command generated by showCollapseAll: true
                    await vscode.commands.executeCommand('workbench.actions.treeView.logmagnifier-regex-filters.collapseAll');
                } catch (e) {
                    this.logger.warn(`Failed to execute native collapse: ${e}`);
                }
            }
        }));

        // Command: Add Word Filter
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
                vscode.window.showErrorMessage(`Filter '${keyword}' (${type}) already exists in this group.`);
            }
        }));

        // Command: Add Regex Filter
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
                        return 'Invalid Regular Expression';
                    }
                }
            });
            if (!pattern) {
                return;
            }

            const filter = this.filterManager.addFilter(targetGroupId, pattern, Constants.FilterTypes.Include as FilterType, true, nickname);
            if (!filter) {
                vscode.window.showErrorMessage(`Regex Filter with pattern '${pattern}' or nickname '${nickname}' already exists in this group.`);
            }
        }));

        // Command: Add Selection to Filter
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.addSelectionToFilter', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage('Please select some text first.');
                return;
            }

            const selectedText = editor.document.getText(editor.selection).trim();
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
                    const parentGroup = this.filterManager.getGroups().find(g => g.filters.some(f => f.id === focusedItem.id));
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
                            vscode.window.showErrorMessage(`Filter '${selectedText}' already exists in group '${targetGroup.name}'.`);
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
                            vscode.window.showErrorMessage(`Filter '${selectedText}' already exists in group '${existingGroup.name}'.`);
                            return;
                        }
                    }
                }
            }

            if (targetGroupId) {
                this.filterManager.addFilter(targetGroupId, selectedText, Constants.FilterTypes.Include as FilterType, false);
            }
        }));

        // Command: Toggle Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleGroup, (group: FilterGroup) => {
            if (group) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group toggled: ${group.name}`);
            }
        }));

        // Command: Enable Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EnableGroup, (group: FilterGroup) => {
            if (group && !group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group enabled: ${group.name}`);
            }
        }));

        // Command: Disable Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DisableGroup, (group: FilterGroup) => {
            if (group && group.isEnabled) {
                this.filterManager.toggleGroup(group.id);
                this.logger.info(`Group disabled: ${group.name}`);
            }
        }));

        // Command: Enable All Items in Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.enableAllItemsInGroup', (group: FilterGroup) => {
            if (group) {
                this.filterManager.enableAllFiltersInGroup(group.id);
            }
        }));

        // Command: Disable All Items in Group
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.disableAllItemsInGroup', (group: FilterGroup) => {
            if (group) {
                this.filterManager.disableAllFiltersInGroup(group.id);
            }
        }));

        // Command: Copy Group Enabled Items (List)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.copyGroupEnabledItems', async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => f.keyword).join('\n');
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`Copied ${enabledFilters.length} items to clipboard.`);
                } else {
                    vscode.window.showInformationMessage('No enabled items to copy (excluded filters ignored).');
                }
            }
        }));

        // Command: Copy Group Enabled Items (List Single Line)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.copyGroupEnabledItemsSingleLine', async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => f.keyword).join(' '); // Use space as delimiter
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`Copied ${enabledFilters.length} items to clipboard (single line).`);
                } else {
                    vscode.window.showInformationMessage('No enabled items to copy (excluded filters ignored).');
                }
            }
        }));

        // Command: Copy Group Enabled Items (Tags)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.copyGroupEnabledItemsWithTag', async (group: FilterGroup) => {
            if (group) {
                const enabledFilters = group.filters.filter(f => f.isEnabled && f.type !== Constants.FilterTypes.Exclude);
                if (enabledFilters.length > 0) {
                    const text = enabledFilters.map(f => `tag:${f.keyword}`).join(' ');
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`Copied ${enabledFilters.length} items as tags to clipboard.`);
                } else {
                    vscode.window.showInformationMessage('No enabled items to copy (excluded filters ignored).');
                }
            }
        }));

        // Command: Enable Filter
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.EnableFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'enable');
        }));

        // Command: Disable Filter
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DisableFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'disable');
        }));

        // Command: Toggle Filter
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilter, (item: FilterItem) => {
            this.handleFilterToggle(item, 'toggle');
        }));

        // Command: Toggle Filter Type
        const toggleFilterTypeHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterType(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Include, toggleFilterTypeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Exclude, toggleFilterTypeHandler));

        // Command: Filter Type Setters
        const setFilterTypeHandler = (type: FilterType) => (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));
            if (targetGroup) {
                this.filterManager.setFilterType(targetGroup.id, item.id, type);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Include, setFilterTypeHandler(Constants.FilterTypes.Include)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Exclude, setFilterTypeHandler(Constants.FilterTypes.Exclude)));

        // Command: Exclude Style Setters
        const setExcludeStyleHandler = (style: 'line-through' | 'hidden') => (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));
            if (targetGroup) {
                this.filterManager.setFilterExcludeStyle(targetGroup.id, item.id, style);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.setExcludeStyle.lineThrough', setExcludeStyleHandler('line-through')));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.setExcludeStyle.hidden', setExcludeStyleHandler('hidden')));

        // Command: Toggle Filter Type (Legacy/Inline)
        // The original toggleFilterTypeHandler is already defined above, so we don't redefine it.
        // We just need to ensure the registrations are in the correct place if they were moved.
        // Since the original registrations are immediately after its definition, and the new 'set' commands are inserted between,
        // the original registrations will now appear after the 'set' commands. This matches the provided snippet's intent.

        // Command: Toggle Filter Highlight Mode
        const toggleHighlightModeHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
            }
        };


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Word, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Line, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Full, toggleHighlightModeHandler));

        // Command: Highlight Mode Setters
        const setHighlightModeHandler = (mode: number) => (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));
            if (targetGroup) {
                this.filterManager.setFilterHighlightMode(targetGroup.id, item.id, mode);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Word, setHighlightModeHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Line, setHighlightModeHandler(1)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Full, setHighlightModeHandler(2)));


        // Command: Toggle Filter Case Sensitivity
        const toggleCaseSensitivityHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
            }
        };


        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.On, toggleCaseSensitivityHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.Off, toggleCaseSensitivityHandler));

        // Command: Case Sensitivity Setters
        const setCaseSensitivityHandler = (enable: boolean) => (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));
            if (targetGroup) {
                this.filterManager.setFilterCaseSensitivity(targetGroup.id, item.id, enable);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.On, setCaseSensitivityHandler(true)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.Off, setCaseSensitivityHandler(false)));

        // Command: Toggle Filter Context Line
        const toggleContextLineHandler = (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

            if (targetGroup) {
                this.filterManager.toggleFilterContextLine(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.None, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus3, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus5, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus9, toggleContextLineHandler));

        // Command: Context Line Setters
        const setContextLineHandler = (lines: number) => (item: FilterItem) => {
            const groups = this.filterManager.getGroups();
            let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));
            if (targetGroup) {
                this.filterManager.setFilterContextLine(targetGroup.id, item.id, lines);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.None, setContextLineHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus3, setContextLineHandler(3)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus5, setContextLineHandler(5)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus9, setContextLineHandler(9)));


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
                    placeHolder: Constants.Prompts.SelectColor,
                    ignoreFocusOut: false
                });

                if (picked) {
                    this.filterManager.updateFilterColor(targetGroup.id, item.id, picked.label);
                }
            }
        };

        // Command: Change Filter Color (Generic)
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.changeFilterColor', changeColorHandler));



        // Register specific color commands to support specific tooltips
        const colorPresets = this.filterManager.getAvailableColors();
        colorPresets.forEach(colorId => {
            this.context.subscriptions.push(vscode.commands.registerCommand(`${Constants.Commands.ChangeFilterColor.Prefix}.${colorId}`, changeColorHandler));
        });

        // Alias Commands for Context Menu Titles
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.createFilter', (item: any) => {
            // Pass the item (Group) to the AddFilter command so it knows where to add
            vscode.commands.executeCommand(Constants.Commands.AddFilter, item);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.createRegexFilter', (item: any) => {
            vscode.commands.executeCommand(Constants.Commands.AddRegexFilter, item);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.deleteGroup', (item: any) => {
            vscode.commands.executeCommand(Constants.Commands.DeleteFilter, item);
        }));

        // Command: Delete Filter / Group
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.DeleteFilter, async (item: FilterGroup | FilterItem) => {
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
        // Command: Next Match
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.NextMatch, async (item: FilterItem) => {
            await this.findMatch(item, 'next');
        }));

        // Command: Previous Match
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.PreviousMatch, async (item: FilterItem) => {
            await this.findMatch(item, 'previous');
        }));

        // Command: Toggle Prepend Line Numbers (Enable)
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Enable, () => {
            this.setPrependLineNumbersEnabled(true);
        }));

        // Command: Toggle Prepend Line Numbers (Disable)
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.TogglePrependLineNumbers.Disable, () => {
            this.setPrependLineNumbersEnabled(false);
        }));

        // Command: Toggle Word Wrap
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleWordWrap, async () => {
            await vscode.commands.executeCommand('editor.action.toggleWordWrap');
        }));

        // Command: Toggle Minimap
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleMinimap, async () => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section);
            const current = config.get<boolean>(Constants.Configuration.Editor.MinimapEnabled);
            await config.update(Constants.Configuration.Editor.MinimapEnabled, !current, vscode.ConfigurationTarget.Global);
        }));

        // Command: Toggle Sticky Scroll
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleStickyScroll, async () => {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section);
            const current = config.get<boolean>(Constants.Configuration.Editor.StickyScrollEnabled);
            await config.update(Constants.Configuration.Editor.StickyScrollEnabled, !current, vscode.ConfigurationTarget.Global);
        }));

        // Command: Toggle Occurrences Highlight
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
                { label: 'Off', description: 'Disable occurrences highlight' },
                { label: 'Single File', description: 'Highlight occurrences in the current file only' },
                { label: 'Multi File', description: 'Highlight occurrences across all open files' }
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: `Select Occurrences Highlight Mode (Current: ${currentLabel})`
            });

            if (selected) {
                let newValue: boolean | string = false;
                if (selected.label === 'Single File') {
                    newValue = 'singleFile';
                } else if (selected.label === 'Multi File') {
                    newValue = 'multiFile';
                }

                await config.update('occurrencesHighlight', newValue, vscode.ConfigurationTarget.Global);
                this.quickAccessProvider.refresh();
            }
        }));

        // Command: Toggle File Size Unit
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFileSizeUnit, () => {
            this.quickAccessProvider.toggleFileSizeUnit();
        }));

        // Command: Export Filters
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportWordFilters, () => this.handleExport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportRegexFilters, () => this.handleExport('regex')));
        this.context.subscriptions.push(vscode.commands.registerCommand('logmagnifier.exportGroup', (group: FilterGroup) => this.handleExportGroup(group)));

        // Command: Import Filters
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportWordFilters, () => this.handleImport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportRegexFilters, () => this.handleImport('regex')));

        // Command: Apply Filter (Word/Regex)
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyWordFilter, () => this.applyFilter('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ApplyRegexFilter, () => this.applyFilter('regex')));

        // Command: Manage Profiles
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
                    label: '$(plus) New Profile...',
                    description: 'Create a new empty profile'
                });

                // Action: Duplicate (Clone)
                items.push({
                    label: '$(copy) Duplicate Profile...',
                    description: 'Make a copy of the current profile'
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
                    `Are you sure you want to delete profile '${profileName}'?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    await this.filterManager.deleteProfile(profileName);
                    vscode.window.showInformationMessage(`Profile '${profileName}' deleted.`);

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
                            prompt: 'Enter name for new profile',
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
                                vscode.window.showInformationMessage(`Profile '${name}' created and activated.`);
                            } else {
                                vscode.window.showErrorMessage(`Failed to create profile '${name}'.`);
                            }
                        }

                    } else if (label.includes('Duplicate Profile')) {
                        quickPick.hide();
                        const name = await vscode.window.showInputBox({
                            prompt: 'Enter name for duplicated profile',
                            value: `${activeProfile} (Copy)`
                        });
                        if (name) {
                            await this.filterManager.saveProfile(name);
                            vscode.window.showInformationMessage(`Profile duplicated as '${name}'.`);
                        }

                    } else {
                        // Switch Profile
                        const profileName = label.replace('$(check) ', '').trim();
                        if (profileName !== activeProfile) {
                            quickPick.hide();
                            await this.filterManager.loadProfile(profileName);
                            vscode.window.showInformationMessage(`Switched to profile '${profileName}'.`);
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

                // Fallback removed: Do not search for random background files.
                // If the user has no active tab/editor, we should not guess.
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
                        const compiledGroups = this.logProcessor.compileGroups(activeGroups);
                        const filtered = lines.filter(line => {
                            stats.processed++;
                            const matchResult = this.logProcessor.checkMatchCompiled(line, compiledGroups);
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
                const timeout = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<number>(Constants.Configuration.StatusBarTimeout) || 5000;
                vscode.window.setStatusBarMessage(message, timeout);
            }

            if (document && document.isUntitled) {
                // Generate temp file path
                const tmpDir = os.tmpdir();
                const prefix = vscode.workspace.getConfiguration('logmagnifier').get<string>('tempFilePrefix') || 'filtered_';
                const now = new Date();
                const outputFilename = `${prefix}${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.log`;
                const outputPath = path.join(tmpDir, outputFilename);

                try {
                    fs.writeFileSync(outputPath, inMemoryContent, 'utf8');
                    const newDoc = await vscode.workspace.openTextDocument(outputPath);
                    await vscode.window.showTextDocument(newDoc, { preview: false });

                    // Force language if needed (though .log extension should handle it)
                    if (newDoc.languageId !== 'log') {
                        await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                    }
                } catch (e) {
                    this.logger.error(`Failed to write/open temp file for untitled filter: ${e}`);
                    // Fallback to untitled if file write fails
                    const newDoc = await vscode.workspace.openTextDocument({ content: inMemoryContent, language: 'log' });
                    await vscode.window.showTextDocument(newDoc, { preview: false });
                }
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
            title: `Export ${mode === 'word' ? 'Word' : 'Regex'} Filters`
        });

        if (uri) {
            try {
                fs.writeFileSync(uri.fsPath, filtersJson, 'utf8');
                vscode.window.showInformationMessage(`${mode === 'word' ? 'Word' : 'Regex'} filters exported successfully to ${uri.fsPath}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to export filters: ${err}`);
            }
        }
    }

    private async handleExportGroup(group: FilterGroup) {
        if (!group) {
            return;
        }

        const filtersJson = this.filterManager.exportGroup(group.id);
        if (!filtersJson) {
            vscode.window.showErrorMessage(`Failed to export group: ${group.name}`);
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
            title: `Export Group: ${group.name}`
        });

        if (uri) {
            try {
                fs.writeFileSync(uri.fsPath, filtersJson, 'utf8');
                vscode.window.showInformationMessage(`Group '${group.name}' exported successfully to ${uri.fsPath}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to export group: ${err}`);
            }
        }
    }

    private async handleImport(mode: 'word' | 'regex') {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            title: `Import ${mode === 'word' ? 'Word' : 'Regex'} Filters`
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
                    vscode.window.showErrorMessage(`Failed to import filters: ${result.error}`);
                } else if (result.count === 0) {
                    vscode.window.showWarningMessage('No matching filters found in the selected file.');
                } else {
                    vscode.window.showInformationMessage(`Successfully imported ${result.count} ${mode === 'word' ? 'Word' : 'Regex'} filter groups.`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to read filter file: ${err}`);
            }
        }
    }
}
