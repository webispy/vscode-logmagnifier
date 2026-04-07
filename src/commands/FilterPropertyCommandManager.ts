import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterItem, FilterType, HighlightMode } from '../models/Filter';

import { FilterManager } from '../services/FilterManager';
import { IconUtils } from '../utils/IconUtils';

export class FilterPropertyCommandManager {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly filterManager: FilterManager
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

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterType.Include, toggleFilterTypeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterType.Exclude, toggleFilterTypeHandler));

        const setFilterTypeHandler = (type: FilterType) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterType(targetGroup.id, item.id, type);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Include, setFilterTypeHandler(Constants.FilterTypes.Include)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterType.Exclude, setFilterTypeHandler(Constants.FilterTypes.Exclude)));

        const setExcludeStyleHandler = (style: 'strikethrough' | 'hidden') => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterExcludeStyle(targetGroup.id, item.id, style);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.Strikethrough, setExcludeStyleHandler('strikethrough')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetExcludeStyle.Hidden, setExcludeStyleHandler('hidden')));

        const toggleHighlightModeHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterHighlightMode.Word, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterHighlightMode.Line, toggleHighlightModeHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterHighlightMode.Full, toggleHighlightModeHandler));

        const setHighlightModeHandler = (mode: HighlightMode) => (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);
            if (targetGroup) {
                this.filterManager.setFilterHighlightMode(targetGroup.id, item.id, mode);
            }
        };
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Word, setHighlightModeHandler(HighlightMode.Word)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Line, setHighlightModeHandler(HighlightMode.Line)));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.SetFilterHighlightMode.Full, setHighlightModeHandler(HighlightMode.FullLine)));

        const toggleCaseSensitivityHandler = (item: FilterItem) => {
            const targetGroup = this.filterManager.findGroupByFilterId(item.id);

            if (targetGroup) {
                this.filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
            }
        };

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterCaseSensitivity.On, toggleCaseSensitivityHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterCaseSensitivity.Off, toggleCaseSensitivityHandler));

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

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterContextLine.None, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterContextLine.PlusMinus3, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterContextLine.PlusMinus5, toggleContextLineHandler));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.CycleFilterContextLine.PlusMinus9, toggleContextLineHandler));

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
                    const svg = IconUtils.generateSimpleCircleSvg(iconColor);
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
