import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { FilterItem, FilterType } from '../models/Filter';

export class FilterPropertyCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager
    ) {
        this.registerCommands();
    }

    private registerCommands() {
        const toggleFilterTypeHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterType(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Include, toggleFilterTypeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterType.Exclude, toggleFilterTypeHandler));

        const setFilterTypeHandler = (type: FilterType) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterType(targetGroup.id, item.id, type);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Include, setFilterTypeHandler(Constants.FilterTypes.Include)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Exclude, setFilterTypeHandler(Constants.FilterTypes.Exclude)));

        const setExcludeStyleHandler = (style: 'line-through' | 'hidden') => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterExcludeStyle(targetGroup.id, item.id, style);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.LineThrough, setExcludeStyleHandler('line-through')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.Hidden, setExcludeStyleHandler('hidden')));

        const toggleHighlightModeHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Word, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Line, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterHighlightMode.Full, toggleHighlightModeHandler));

        const setHighlightModeHandler = (mode: number) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterHighlightMode(targetGroup.id, item.id, mode);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Word, setHighlightModeHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Line, setHighlightModeHandler(1)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Full, setHighlightModeHandler(2)));

        const toggleCaseSensitivityHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.On, toggleCaseSensitivityHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterCaseSensitivity.Off, toggleCaseSensitivityHandler));

        const setCaseSensitivityHandler = (enable: boolean) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterCaseSensitivity(targetGroup.id, item.id, enable);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.On, setCaseSensitivityHandler(true)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterCaseSensitivity.Off, setCaseSensitivityHandler(false)));

        const toggleContextLineHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterContextLine(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.None, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus3, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus5, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ToggleFilterContextLine.PlusMinus9, toggleContextLineHandler));

        const setContextLineHandler = (lines: number) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterContextLine(targetGroup.id, item.id, lines);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.None, setContextLineHandler(0)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus3, setContextLineHandler(3)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus5, setContextLineHandler(5)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterContextLine.PlusMinus9, setContextLineHandler(9)));

        const changeColorHandler = async (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

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
}
