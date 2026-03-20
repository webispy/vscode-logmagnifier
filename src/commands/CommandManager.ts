import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
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

export interface CommandManagerServices {
    filterManager: FilterManager;
    highlightService: HighlightService;
    resultCountService: ResultCountService;
    logProcessor: LogProcessor;
    quickAccessProvider: QuickAccessProvider;
    logger: Logger;
    wordTreeView: vscode.TreeView<FilterGroup | FilterItem>;
    regexTreeView: vscode.TreeView<FilterGroup | FilterItem>;
    jsonPrettyService: JsonPrettyService;
    sourceMapService: SourceMapService;
}

export class CommandManager {
    private static readonly JSON_PREVIEW_DEBOUNCE_MS = 50;
    private lastActiveLine: number = -1;
    private lastUriStr: string = '';
    private debounceTimer: NodeJS.Timeout | undefined;

    private readonly filterManager: FilterManager;
    private readonly highlightService: HighlightService;
    private readonly logProcessor: LogProcessor;
    private readonly quickAccessProvider: QuickAccessProvider;
    private readonly logger: Logger;
    private readonly wordTreeView: vscode.TreeView<FilterGroup | FilterItem>;
    private readonly regexTreeView: vscode.TreeView<FilterGroup | FilterItem>;
    private readonly jsonPrettyService: JsonPrettyService;
    private readonly sourceMapService: SourceMapService;

    constructor(
        private context: vscode.ExtensionContext,
        services: CommandManagerServices
    ) {
        this.filterManager = services.filterManager;
        this.highlightService = services.highlightService;
        this.logProcessor = services.logProcessor;
        this.quickAccessProvider = services.quickAccessProvider;
        this.logger = services.logger;
        this.wordTreeView = services.wordTreeView;
        this.regexTreeView = services.regexTreeView;
        this.jsonPrettyService = services.jsonPrettyService;
        this.sourceMapService = services.sourceMapService;
        // Instantiate sub-modules
        new FilterGroupCommandManager(context, this.filterManager, this.logger);
        new FilterItemCommandManager(context, this.filterManager, this.logger, this.wordTreeView);
        new FilterPropertyCommandManager(context, this.filterManager);
        new FilterExportImportCommandManager(context, this.filterManager);
        new FilterExecutionCommandManager(context, this.filterManager, this.highlightService, this.logProcessor, this.logger, this.sourceMapService, this.wordTreeView, this.regexTreeView);
        new EditorToggleCommandManager(context, this.quickAccessProvider, this.jsonPrettyService);

        this.registerClearDataCommand();
        this.registerEventListeners();

        // Ensure debounce timer is cleared on dispose
        context.subscriptions.push({
            dispose: () => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = undefined;
                }
            }
        });
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

    /** Debounces JSON preview updates when the cursor moves to a new line or document. */
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
        }, CommandManager.JSON_PREVIEW_DEBOUNCE_MS);
    }

    private registerClearDataCommand() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand(Constants.Commands.ClearAllData, async () => {
                const answer = await vscode.window.showWarningMessage(
                    Constants.Prompts.ConfirmClearAllData,
                    { modal: true },
                    'Yes'
                );

                if (answer === 'Yes') {
                    const keys = this.context.globalState.keys();
                    for (const key of keys) {
                        this.logger.info(`[CommandManager] Clearing globalState key: ${key}`);
                        await this.context.globalState.update(key, undefined);
                    }
                    await this.deleteRunbookStorage();
                    await this.showClearResult(Constants.Messages.Info.ClearAllDataCompleted);
                }
            }),

            vscode.commands.registerCommand(Constants.Commands.ClearFilterData, async () => {
                const answer = await vscode.window.showWarningMessage(
                    Constants.Prompts.ConfirmClearFilterData,
                    { modal: true },
                    'Yes'
                );

                if (answer === 'Yes') {
                    await this.clearGlobalStateKeys([
                        Constants.GlobalState.FilterGroups,
                        Constants.GlobalState.FilterProfiles,
                        Constants.GlobalState.ActiveProfile,
                    ]);
                    await this.showClearResult(Constants.Messages.Info.ClearFilterDataCompleted);
                }
            }),

            vscode.commands.registerCommand(Constants.Commands.ClearBookmarkData, async () => {
                const answer = await vscode.window.showWarningMessage(
                    Constants.Prompts.ConfirmClearBookmarkData,
                    { modal: true },
                    'Yes'
                );

                if (answer === 'Yes') {
                    await this.clearGlobalStateKeys([
                        Constants.GlobalState.Bookmarks,
                        Constants.GlobalState.BookmarkIncludeLnMap,
                        Constants.GlobalState.BookmarkWordWrap,
                        Constants.GlobalState.BookmarkFileOrder,
                    ]);
                    await this.showClearResult(Constants.Messages.Info.ClearBookmarkDataCompleted);
                }
            }),

            vscode.commands.registerCommand(Constants.Commands.ClearWorkflowData, async () => {
                const answer = await vscode.window.showWarningMessage(
                    Constants.Prompts.ConfirmClearWorkflowData,
                    { modal: true },
                    'Yes'
                );

                if (answer === 'Yes') {
                    await this.clearGlobalStateKeys([
                        Constants.GlobalState.Workflows,
                        Constants.GlobalState.ActiveWorkflow,
                    ]);
                    await this.showClearResult(Constants.Messages.Info.ClearWorkflowDataCompleted);
                }
            }),

            vscode.commands.registerCommand(Constants.Commands.ClearRunbookData, async () => {
                const answer = await vscode.window.showWarningMessage(
                    Constants.Prompts.ConfirmClearRunbookData,
                    { modal: true },
                    'Yes'
                );

                if (answer === 'Yes') {
                    await this.deleteRunbookStorage();
                    await this.showClearResult(Constants.Messages.Info.ClearRunbookDataCompleted);
                }
            }),
        );
    }

    private async clearGlobalStateKeys(keys: string[]) {
        for (const key of keys) {
            this.logger.info(`[CommandManager] Clearing globalState key: ${key}`);
            await this.context.globalState.update(key, undefined);
        }
    }

    private async deleteRunbookStorage(): Promise<void> {
        const runbookPath = path.join(this.context.globalStorageUri.fsPath, 'runbooks');
        if (fs.existsSync(runbookPath)) {
            await fsp.rm(runbookPath, { recursive: true, force: true });
            this.logger.info(`[CommandManager] Cleared runbook storage: ${runbookPath}`);
        }
    }

    private async showClearResult(message: string) {
        const reload = await vscode.window.showInformationMessage(
            message,
            Constants.Prompts.ReloadConfirm
        );

        if (reload === Constants.Prompts.ReloadConfirm) {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}
