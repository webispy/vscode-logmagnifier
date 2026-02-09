import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { FilterGroup } from '../models/Filter';
import { IconUtils } from '../utils/IconUtils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface FilterGroupQuickPickItem extends vscode.QuickPickItem {
    groupId: string;
    isEnabled: boolean;
}

export class FilterExportImportCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager
    ) {
        this.registerCommands();
    }

    private registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportWordFilters, () => this.handleExport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportRegexFilters, () => this.handleExport('regex')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ExportGroup, (group: FilterGroup) => this.handleExportGroup(group)));

        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportWordFilters, () => this.handleImport('word')));
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ImportRegexFilters, () => this.handleImport('regex')));

        this.registerProfileCommands();
    }

    private async handleExport(mode: 'word' | 'regex') {
        // Get all groups for the mode
        const allGroups = this.filterManager.getGroups().filter(g => mode === 'regex' ? g.isRegex : !g.isRegex);

        if (allGroups.length === 0) {
            vscode.window.showInformationMessage(Constants.Messages.Info.NoGroupsToExport);
            return;
        }

        // Create QuickPick
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = mode === 'word' ? Constants.Prompts.ExportWordFilters : Constants.Prompts.ExportRegexFilters;
        quickPick.placeholder = Constants.Prompts.SelectGroupsToExport;
        quickPick.canSelectMany = true; // Enable native checkboxes
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        // Add Buttons
        quickPick.buttons = [
            { iconPath: new vscode.ThemeIcon('checklist'), tooltip: 'Select All' },
            { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Select None' },
            { iconPath: new vscode.ThemeIcon('filter'), tooltip: 'Select Enabled Only' },
            { iconPath: new vscode.ThemeIcon('export'), tooltip: 'Export' }
        ];

        // Prepare Items
        const updateItems = () => {
            quickPick.items = allGroups.map(g => {
                // Icon Generation
                const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
                const strokeColor = isDark ? '#cccccc' : '#333333';
                const dimmedColor = isDark ? '#555555' : '#cccccc';

                const folderColor = g.isEnabled ? strokeColor : dimmedColor;
                const overlayColor = g.isEnabled ? undefined : strokeColor;

                const svg = IconUtils.generateGroupSvg(folderColor, overlayColor);
                const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

                return {
                    label: g.name,
                    description: `${g.filters.length} filters${g.isEnabled ? '' : ' • Disabled'}`,
                    picked: true, // Default to all selected
                    groupId: g.id,
                    isEnabled: g.isEnabled,
                    iconPath: iconUri
                } as FilterGroupQuickPickItem;
            });

            // Initialize selection to all
            if (quickPick.items.length > 0) {
                quickPick.selectedItems = quickPick.items;
            }
        };

        updateItems();

        // Handle Button Clicks
        quickPick.onDidTriggerButton(async button => {
            if (button.tooltip === 'Select All') {
                quickPick.selectedItems = quickPick.items;
            } else if (button.tooltip === 'Select None') {
                quickPick.selectedItems = [];
            } else if (button.tooltip === 'Select Enabled Only') {
                const items = quickPick.items as FilterGroupQuickPickItem[];
                quickPick.selectedItems = items.filter(i => i.isEnabled);
            } else if (button.tooltip === 'Export') {
                // Execute Export
                const selectedItems = quickPick.selectedItems as FilterGroupQuickPickItem[];
                if (selectedItems.length === 0) {
                    vscode.window.showWarningMessage('No groups selected to export.');
                    return;
                }

                quickPick.hide();
                const selectedGroupIds = selectedItems.map(i => i.groupId);
                await this.performExport(mode, selectedGroupIds);
            }
        });

        // Trigger export on Accept (Enter key)
        quickPick.onDidAccept(async () => {
            const selectedItems = quickPick.selectedItems as FilterGroupQuickPickItem[];
            if (selectedItems.length === 0) {
                vscode.window.showWarningMessage('No groups selected to export.');
                return;
            }

            quickPick.hide();
            const selectedGroupIds = selectedItems.map(i => i.groupId);
            await this.performExport(mode, selectedGroupIds);
        });

        quickPick.show();
    }

    private async performExport(mode: 'word' | 'regex', groupIds: string[]) {
        const filtersJson = this.filterManager.exportFilters(mode, groupIds);
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
