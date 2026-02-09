import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterManager } from '../services/FilterManager';
import { HighlightService } from '../services/HighlightService';
import { ResultCountService } from '../services/ResultCountService';
import { LogProcessor } from '../services/LogProcessor';
import { Logger } from '../services/Logger';
import { QuickAccessProvider } from '../views/QuickAccessProvider';
import { FilterGroup, FilterItem } from '../models/Filter';
import { JsonPrettyService } from '../services/JsonPrettyService';
import { SourceMapService } from '../services/SourceMapService';
import { FilterGroupCommandManager } from './FilterGroupCommandManager';
import { FilterItemCommandManager } from './FilterItemCommandManager';
import { FilterPropertyCommandManager } from './FilterPropertyCommandManager';
import { FilterExportImportCommandManager } from './FilterExportImportCommandManager';
import { FilterExecutionCommandManager } from './FilterExecutionCommandManager';
import { EditorToggleCommandManager } from './EditorToggleCommandManager';

export class CommandManager {
    private lastActiveLine: number = -1;
    private lastUriStr: string = '';
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private filterManager: FilterManager,
        private highlightService: HighlightService,
        private resultCountService: ResultCountService,
        private logProcessor: LogProcessor,
        private quickAccessProvider: QuickAccessProvider,
        private logger: Logger,
        private wordTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private regexTreeView: vscode.TreeView<FilterGroup | FilterItem>,
        private jsonPrettyService: JsonPrettyService,
        private sourceMapService: SourceMapService
    ) {
        // Instantiate sub-modules
        new FilterGroupCommandManager(context, filterManager, logger);
        new FilterItemCommandManager(context, filterManager, logger, wordTreeView);
        new FilterPropertyCommandManager(context, filterManager);
        new FilterExportImportCommandManager(context, filterManager);
        new FilterExecutionCommandManager(context, filterManager, highlightService, logProcessor, logger, sourceMapService, wordTreeView, regexTreeView);
        new EditorToggleCommandManager(context, quickAccessProvider, jsonPrettyService);

        this.registerClearDataCommand();
        this.registerEventListeners();
    }

    private registerEventListeners() {
        this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;

            // Ignore output channels to prevent recursive loops (logging triggers change -> triggers preview -> logs more)
            if (editor.document.uri.scheme === 'output') {
                return;
            }

            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const enabled = config.get<boolean>(Constants.Configuration.JsonPreviewEnabled);

            if (!enabled) {
                return;
            }

            const currentLine = event.selections[0].active.line;
            const currentUriStr = editor.document.uri.toString();

            if (currentLine !== this.lastActiveLine || currentUriStr !== this.lastUriStr) {
                this.triggerJsonPreviewUpdate(editor, currentLine, currentUriStr);
            }
        }));

        this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            const activeEditor = vscode.window.activeTextEditor;
            // Only proceed if the change happened in the active editor
            if (!activeEditor || activeEditor.document !== event.document) {
                return;
            }

            // Ignore output channels
            if (activeEditor.document.uri.scheme === 'output') {
                return;
            }

            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const enabled = config.get<boolean>(Constants.Configuration.JsonPreviewEnabled);

            if (!enabled) {
                return;
            }

            const currentLine = activeEditor.selection.active.line;
            const currentUriStr = activeEditor.document.uri.toString();

            this.triggerJsonPreviewUpdate(activeEditor, currentLine, currentUriStr);
        }));
    }

    private triggerJsonPreviewUpdate(editor: vscode.TextEditor, currentLine: number, currentUriStr: string) {
        // Cancel previous pending update
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }

        this.lastActiveLine = currentLine;
        this.lastUriStr = currentUriStr;

        this.debounceTimer = setTimeout(() => {
            this.jsonPrettyService.execute(true, editor);
            this.debounceTimer = undefined;
        }, 50);
    }

    private registerClearDataCommand() {
        this.context.subscriptions.push(vscode.commands.registerCommand(Constants.Commands.ClearAllData, async () => {
            const answer = await vscode.window.showWarningMessage(
                Constants.Prompts.ConfirmClearAllData,
                { modal: true },
                'Yes'
            );

            if (answer === 'Yes') {
                // Clear all globalState
                const keys = this.context.globalState.keys();
                for (const key of keys) {
                    this.logger.info(`Clearing globalState key: ${key}`);
                    await this.context.globalState.update(key, undefined);
                }

                // Show success and ask for reload
                const reload = await vscode.window.showInformationMessage(
                    Constants.Messages.Info.ClearAllDataCompleted,
                    Constants.Prompts.ReloadConfirm
                );

                if (reload === Constants.Prompts.ReloadConfirm) {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
        }));
    }
}
