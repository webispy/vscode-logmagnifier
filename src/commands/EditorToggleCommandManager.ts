import * as vscode from 'vscode';
import { Constants } from '../constants';
import { QuickAccessProvider } from '../views/QuickAccessProvider';
import { JsonPrettyService } from '../services/JsonPrettyService';

export class EditorToggleCommandManager {
    constructor(
        private context: vscode.ExtensionContext,
        private quickAccessProvider: QuickAccessProvider,
        private jsonPrettyService: JsonPrettyService
    ) {
        this.registerCommands();
    }

    private registerCommands() {
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
}
