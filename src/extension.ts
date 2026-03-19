import * as vscode from 'vscode';

import { FilterManager } from './services/FilterManager';
import { FilterTreeDataProvider } from './views/FilterTreeDataProvider';
import { QuickAccessProvider } from './views/QuickAccessProvider';
import { LogProcessor } from './services/LogProcessor';
import { HighlightService } from './services/HighlightService';
import { ResultCountService } from './services/ResultCountService';
import { Logger } from './services/Logger';
import { CommandManager } from './commands/CommandManager';
import { AdbService } from './services/AdbService';
import { AdbDeviceTreeProvider } from './views/AdbDeviceTreeProvider';
import { AdbCommandManager } from './commands/AdbCommandManager';
import { LogBookmarkService } from './services/LogBookmarkService';
import { LogBookmarkWebviewProvider } from './views/LogBookmarkWebviewProvider';
import { LogBookmarkCommandManager } from './commands/LogBookmarkCommandManager';
import { JsonPrettyService } from './services/JsonPrettyService';
import { JsonTreeWebview } from './views/JsonTreeWebview';
import { SourceMapService } from './services/SourceMapService';
import { FilteredLogDefinitionProvider } from './providers/FilteredLogDefinitionProvider';
import { RunbookService } from './services/RunbookService';
import { RunbookTreeDataProvider } from './views/RunbookTreeDataProvider';
import { RunbookCommandManager } from './commands/RunbookCommandManager';
import { Constants } from './Constants';
import { FilterGroup, FilterItem, isFilterGroup } from './models/Filter';
import { FileHierarchyService } from './services/FileHierarchyService';
import { NavigationCommandManager } from './commands/NavigationCommandManager';
import { FileHierarchyLensProvider } from './providers/FileHierarchyLensProvider';
import { WorkflowManager } from './services/WorkflowManager';
import { WorkflowWebviewProvider } from './views/WorkflowWebviewProvider';
import { WorkflowCommandManager } from './commands/WorkflowCommandManager';

// Cache frequently-read config values; invalidated in onDidChangeConfiguration
let cachedLargeFileOptimizations: boolean | undefined = vscode.workspace
    .getConfiguration(Constants.Configuration.Editor.Section)
    .get<boolean>(Constants.Configuration.Editor.LargeFileOptimizations);

function invalidateCachedConfig(): void {
    cachedLargeFileOptimizations = vscode.workspace
        .getConfiguration(Constants.Configuration.Editor.Section)
        .get<boolean>(Constants.Configuration.Editor.LargeFileOptimizations);
}

export function activate(context: vscode.ExtensionContext) {
  try {
    const logger = Logger.getInstance();
    context.subscriptions.push(logger);
    logger.info('LogMagnifier activated');

    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push({
        dispose: () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
        }
    });

    const filterManager = new FilterManager(context);
    context.subscriptions.push(filterManager);

    const sourceMapService = SourceMapService.getInstance();
    const logProcessor = new LogProcessor();
    const highlightService = new HighlightService(filterManager, logger);
    const workflowManager = new WorkflowManager(context, filterManager.profileManagerRef, logProcessor, logger, highlightService, sourceMapService);
    context.subscriptions.push(workflowManager);

    const quickAccessProvider = new QuickAccessProvider(filterManager, workflowManager);
    context.subscriptions.push(quickAccessProvider);
    context.subscriptions.push(highlightService);
    const resultCountService = new ResultCountService(filterManager);

    const workflowProvider = new WorkflowWebviewProvider(context, workflowManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(Constants.Views.Workflow, workflowProvider)
    );

    let highlightCts: vscode.CancellationTokenSource | undefined;

    const refreshHighlightsForEditor = async (editor: vscode.TextEditor) => {
        highlightCts?.cancel();
        highlightCts?.dispose();
        highlightCts = new vscode.CancellationTokenSource();
        const counts = await highlightService.updateHighlights(editor, highlightCts.token);
        if (counts) {
            resultCountService.updateCounts(counts);
        }
    };

    let lastProcessedDoc: vscode.TextDocument | undefined;

    const wordTreeDataProvider = new FilterTreeDataProvider(filterManager, 'word');
    context.subscriptions.push(wordTreeDataProvider);
    const wordTreeView = vscode.window.createTreeView(Constants.Views.Filters, {
        treeDataProvider: wordTreeDataProvider,
        dragAndDropController: wordTreeDataProvider,
        showCollapseAll: false
    });

    const regexTreeDataProvider = new FilterTreeDataProvider(filterManager, 'regex');
    context.subscriptions.push(regexTreeDataProvider);
    const regexTreeView = vscode.window.createTreeView(Constants.Views.RegexFilters, {
        treeDataProvider: regexTreeDataProvider,
        dragAndDropController: regexTreeDataProvider,
        showCollapseAll: false
    });

    // Sync expansion state
    const setupExpansionSync = (view: vscode.TreeView<FilterGroup | FilterItem>) => {
        context.subscriptions.push(view.onDidExpandElement(e => {
            if (isFilterGroup(e.element)) {
                filterManager.setGroupExpanded(e.element.id, true);
            }
        }));
        context.subscriptions.push(view.onDidCollapseElement(e => {
            if (isFilterGroup(e.element)) {
                filterManager.setGroupExpanded(e.element.id, false);
            }
        }));
    };

    setupExpansionSync(wordTreeView);
    setupExpansionSync(regexTreeView);

    // Register Definition Provider for Click-to-Navigate
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            [
                { scheme: Constants.Schemes.File, language: 'log' },
                { scheme: Constants.Schemes.Untitled, language: 'log' },
                { scheme: Constants.Schemes.Untitled, language: 'jsonc' },
                { scheme: Constants.Schemes.Untitled, language: 'json' }
            ],
            new FilteredLogDefinitionProvider(sourceMapService)
        )
    );

    // Initialize Command Manager (Handles all command registrations)
    const jsonTreeWebview = new JsonTreeWebview(context);
    context.subscriptions.push(jsonTreeWebview);

    const jsonPrettyService = new JsonPrettyService(logger, sourceMapService, jsonTreeWebview, highlightService);
    context.subscriptions.push(jsonPrettyService);
    new CommandManager(context, {
        filterManager, highlightService, resultCountService, logProcessor,
        quickAccessProvider, logger, wordTreeView, regexTreeView,
        jsonPrettyService, sourceMapService
    });
    new WorkflowCommandManager(context, workflowManager, filterManager, logger);

    // File Hierarchy Service & Navigation
    const fileHierarchyService = FileHierarchyService.createInstance(context);
    new NavigationCommandManager(context, fileHierarchyService);
    const hierarchyLensProvider = new FileHierarchyLensProvider(fileHierarchyService);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [{ scheme: Constants.Schemes.File }, { scheme: Constants.Schemes.Untitled }],
            hierarchyLensProvider
        )
    );

    // ADB Devices
    const adbService = new AdbService(logger);
    context.subscriptions.push(adbService);
    const adbDeviceTreeProvider = new AdbDeviceTreeProvider(adbService);
    context.subscriptions.push(adbDeviceTreeProvider);
    const adbTreeView = vscode.window.createTreeView(Constants.Views.ADBDevices, {
        treeDataProvider: adbDeviceTreeProvider,
        showCollapseAll: true
    });
    new AdbCommandManager(context, adbService, adbDeviceTreeProvider, adbTreeView);

    // Runbook
    const runbookService = new RunbookService(context);
    const runbookTreeDataProvider = new RunbookTreeDataProvider(runbookService);
    context.subscriptions.push(runbookTreeDataProvider);
    vscode.window.createTreeView(Constants.Views.Runbook, {
        treeDataProvider: runbookTreeDataProvider,
        showCollapseAll: false
    });
    new RunbookCommandManager(context, runbookService);

    // Log Bookmark
    const bookmarkService = new LogBookmarkService(context);
    context.subscriptions.push(bookmarkService);

    const bookmarkWebviewProvider = new LogBookmarkWebviewProvider(context.extensionUri, bookmarkService, logger);
    context.subscriptions.push(bookmarkWebviewProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(Constants.Views.Bookmark, bookmarkWebviewProvider)
    );

    new LogBookmarkCommandManager(context, bookmarkService, highlightService);

    // Initialize mouse over context
    vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, false);

    logger.info(`Registering QuickAccessProvider with view ID: ${Constants.Views.QuickAccess}`);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(Constants.Views.QuickAccess, quickAccessProvider)
    );
    logger.info('QuickAccessProvider registered');

    // Initial highlight
    if (vscode.window.activeTextEditor) {
        const editor = vscode.window.activeTextEditor;
        const scheme = editor.document.uri.scheme;
        const fileName = editor.document.fileName;
        logger.info(`Initial active editor: ${fileName} (Scheme: ${scheme})`);

        refreshHighlightsForEditor(editor).catch(e => logger.error(`Initial highlight failed: ${e}`));
        lastProcessedDoc = editor.document;
    }

    registerEditorEventListeners(context, {
        logger, sourceMapService, highlightService, resultCountService,
        quickAccessProvider, refreshHighlightsForEditor,
        getLastProcessedDoc: () => lastProcessedDoc,
        setLastProcessedDoc: (doc) => { lastProcessedDoc = doc; },
        getDebounceTimer: () => debounceTimer,
        setDebounceTimer: (t) => { debounceTimer = t; },
    });

    registerFilterEventListeners(context, {
        logger, filterManager, highlightService, quickAccessProvider,
        wordTreeDataProvider, regexTreeDataProvider, runbookTreeDataProvider,
        refreshHighlightsForEditor,
        setLastProcessedDoc: (doc) => { lastProcessedDoc = doc; },
    });

    return {
        filterManager,
        bookmarkService,
        highlightService,
        sourceMapService,
        adbService
    };
  } catch (err) {
    vscode.window.showErrorMessage(
        `LogMagnifier failed to activate: ${err instanceof Error ? err.message : err}`
    );
    throw err;
  }
}

export function deactivate() {
    Logger.getInstance().info('LogMagnifier deactivated');
}

function isSupportedScheme(uri: vscode.Uri): boolean {
    return uri.scheme === Constants.Schemes.File || uri.scheme === Constants.Schemes.Untitled;
}

interface EditorEventListenerDeps {
    logger: Logger;
    sourceMapService: SourceMapService;
    highlightService: HighlightService;
    resultCountService: ResultCountService;
    quickAccessProvider: QuickAccessProvider;
    refreshHighlightsForEditor: (editor: vscode.TextEditor) => Promise<void>;
    getLastProcessedDoc: () => vscode.TextDocument | undefined;
    setLastProcessedDoc: (doc: vscode.TextDocument | undefined) => void;
    getDebounceTimer: () => NodeJS.Timeout | undefined;
    setDebounceTimer: (t: NodeJS.Timeout | undefined) => void;
}

function registerEditorEventListeners(context: vscode.ExtensionContext, deps: EditorEventListenerDeps) {
    const { logger, sourceMapService, highlightService, resultCountService,
        quickAccessProvider, refreshHighlightsForEditor,
        getLastProcessedDoc, setLastProcessedDoc,
        getDebounceTimer, setDebounceTimer } = deps;

    // Listen for selection changes to trigger navigation animation (flash)
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        try {
            const editor = e.textEditor;
            if (editor && e.selections.length > 0) {
                const line = e.selections[0].active.line;
                if (sourceMapService.checkAndConsumePendingNavigation(editor.document.uri, line)) {
                    highlightService.flashLine(editor, line);
                }
            }
        } catch (error) {
            logger.error(`Error in onDidChangeTextEditorSelection: ${error}`);
        }
    }));

    // Update highlights and counts when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async editor => {
        try {
            sourceMapService.updateContextKey(editor);

            // Check for pending navigation (animation) on active editor change
            if (editor && editor.selection) {
                const line = editor.selection.active.line;
                if (sourceMapService.checkAndConsumePendingNavigation(editor.document.uri, line)) {
                    highlightService.flashLine(editor, line);
                }
            }

            if (editor) {
                if (!isSupportedScheme(editor.document.uri)) {
                    return;
                }

                if (getLastProcessedDoc() && editor.document === getLastProcessedDoc()) {
                    return;
                }

                const largeFileOptimizations = cachedLargeFileOptimizations;
                const fileName = editor.document.fileName;
                const scheme = editor.document.uri.scheme;
                logger.info(`Active editor changed to: ${fileName} (Scheme: ${scheme}, LargeFileOptimizations: ${largeFileOptimizations})`);

                quickAccessProvider.refresh();

                await refreshHighlightsForEditor(editor);
                setLastProcessedDoc(editor.document);
            } else {
                // Fallback for large files where activeTextEditor is undefined
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab && activeTab.input instanceof vscode.TabInputText) {
                    const uri = activeTab.input.uri;
                    try {
                        if (uri.scheme === Constants.Schemes.File) {
                            const stat = await vscode.workspace.fs.stat(uri);
                            const sizeMB = stat.size / (1024 * 1024);
                            if (sizeMB > Constants.Defaults.LargeFileSizeLimitMB) {
                                setLastProcessedDoc(undefined);
                                resultCountService.clearCounts();
                                quickAccessProvider.refresh();
                                logger.info(`Active editor changed to (Tab): ${uri.fsPath} (${sizeMB.toFixed(2)}MB). - Too large for extension host (Limit ${Constants.Defaults.LargeFileSizeLimitMB}MB).`);
                                vscode.window.setStatusBarMessage(`LogMagnifier: File too large (${sizeMB.toFixed(1)}MB). VS Code limits extension support to ${Constants.Defaults.LargeFileSizeLimitMB}MB.`, 5000);
                            }
                        }
                    } catch (e) {
                        logger.error(`Error checking file size: ${e}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error in onDidChangeActiveTextEditor: ${error}`);
        }
    }));

    // Update counts when text changes
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
        try {
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
                if (!isSupportedScheme(e.document.uri)) {
                    return;
                }

                setLastProcessedDoc(undefined); // Invalidate because content changed

                const timer = getDebounceTimer();
                if (timer) {
                    clearTimeout(timer);
                }

                setDebounceTimer(setTimeout(async () => {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && e.document === editor.document) {
                        try {
                            await refreshHighlightsForEditor(editor);
                            setLastProcessedDoc(editor.document);
                        } catch (innerError) {
                            logger.error(`Error in onDidChangeTextEditor debounce: ${innerError}`);
                        }
                    }
                    setDebounceTimer(undefined);
                }, 500));

                // Update Quick Access if untitled (size changes)
                if (e.document.isUntitled) {
                    quickAccessProvider.refresh();
                }
            }
        } catch (error) {
            logger.error(`Error in onDidChangeTextDocument: ${error}`);
        }
    }));

    // Update Quick Access when file is saved (size changes)
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
        try {
            if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
                quickAccessProvider.refresh();
            }
        } catch (error) {
            logger.error(`Error in onDidSaveTextDocument: ${error}`);
        }
    }));

    // Prevent memory leak by clearing reference to closed documents
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        try {
            if (getLastProcessedDoc() === doc) {
                setLastProcessedDoc(undefined);
                resultCountService.clearCounts();
                quickAccessProvider.refresh();
            }
            sourceMapService.unregister(doc.uri);
            highlightService.unregisterDocumentFilters(doc.uri);
        } catch (error) {
            logger.error(`Error in onDidCloseTextDocument: ${error}`);
        }
    }));
}

interface FilterEventListenerDeps {
    logger: Logger;
    filterManager: FilterManager;
    highlightService: HighlightService;
    quickAccessProvider: QuickAccessProvider;
    wordTreeDataProvider: FilterTreeDataProvider;
    regexTreeDataProvider: FilterTreeDataProvider;
    runbookTreeDataProvider: RunbookTreeDataProvider;
    refreshHighlightsForEditor: (editor: vscode.TextEditor) => Promise<void>;
    setLastProcessedDoc: (doc: vscode.TextDocument | undefined) => void;
}

function registerFilterEventListeners(context: vscode.ExtensionContext, deps: FilterEventListenerDeps) {
    const { logger, filterManager, highlightService, quickAccessProvider,
        wordTreeDataProvider, regexTreeDataProvider, runbookTreeDataProvider,
        refreshHighlightsForEditor, setLastProcessedDoc } = deps;

    // Update highlights when filters change
    context.subscriptions.push(filterManager.onDidChangeFilters(async () => {
        try {
            setLastProcessedDoc(undefined);
            if (vscode.window.activeTextEditor) {
                if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
                    await refreshHighlightsForEditor(vscode.window.activeTextEditor);
                    setLastProcessedDoc(vscode.window.activeTextEditor.document);
                }
            }
        } catch (error) {
            logger.error(`Error in onDidChangeFilters: ${error}`);
        }
    }));

    // Update highlights when configuration changes (e.g. color)
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        try {
            if (e.affectsConfiguration(`${Constants.Configuration.Section}.${Constants.Configuration.Regex.HighlightColor}`) ||
                e.affectsConfiguration(`${Constants.Configuration.Section}.${Constants.Configuration.Regex.EnableHighlight}`)) {
                highlightService.refreshDecorationType();
                setLastProcessedDoc(undefined);
                if (vscode.window.activeTextEditor) {
                    if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
                        await refreshHighlightsForEditor(vscode.window.activeTextEditor);
                        setLastProcessedDoc(vscode.window.activeTextEditor.document);
                    }
                }
            }

            // Invalidate cached editor config
            if (e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.LargeFileOptimizations}`)) {
                invalidateCachedConfig();
            }

            // Refresh Quick Access view if editor settings change
            if (e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.WordWrap}`) ||
                e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.MinimapEnabled}`) ||
                e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.StickyScrollEnabled}`)) {
                quickAccessProvider.refresh();
            }
        } catch (error) {
            logger.error(`Error in onDidChangeConfiguration: ${error}`);
        }
    }));

    // Refresh tree views and highlights when color theme changes
    context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(async () => {
        try {
            highlightService.refreshDecorationType();
            wordTreeDataProvider.refresh();
            regexTreeDataProvider.refresh();
            runbookTreeDataProvider.refresh();
            if (vscode.window.activeTextEditor) {
                if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
                    await refreshHighlightsForEditor(vscode.window.activeTextEditor);
                }
            }
        } catch (error) {
            logger.error(`Error in onDidChangeActiveColorTheme: ${error}`);
        }
    }));
}
