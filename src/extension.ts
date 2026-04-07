import * as vscode from 'vscode';

import { Constants } from './Constants';
import { FilterGroup, FilterItem, isFilterGroup } from './models/Filter';
import { TimestampIndex } from './models/Timestamp';

import { AdbCommandManager } from './commands/AdbCommandManager';
import { CommandManager } from './commands/CommandManager';
import { LogBookmarkCommandManager } from './commands/LogBookmarkCommandManager';
import { NavigationCommandManager } from './commands/NavigationCommandManager';
import { RunbookCommandManager } from './commands/RunbookCommandManager';
import { TimestampCommandManager } from './commands/TimestampCommandManager';
import { WorkflowCommandManager } from './commands/WorkflowCommandManager';
import { FileHierarchyLensProvider } from './providers/FileHierarchyLensProvider';
import { FilteredLogDefinitionProvider } from './providers/FilteredLogDefinitionProvider';
import { AdbService } from './services/AdbService';
import { FileHierarchyService } from './services/FileHierarchyService';
import { FilterManager } from './services/FilterManager';
import { HighlightService } from './services/HighlightService';
import { JsonPrettyService } from './services/JsonPrettyService';
import { LogBookmarkService } from './services/LogBookmarkService';
import { Logger } from './services/Logger';
import { LogProcessor } from './services/LogProcessor';
import { ResultCountService } from './services/ResultCountService';
import { RunbookService } from './services/RunbookService';
import { LineMappingService } from './services/LineMappingService';
import { TimestampService } from './services/TimestampService';
import { WorkflowManager } from './services/WorkflowManager';
import { LmToolManager } from './tools/LmToolManager';
import { AdbDeviceTreeProvider } from './views/AdbDeviceTreeProvider';
import { FilterTreeDataProvider } from './views/FilterTreeDataProvider';
import { JsonTreeWebview } from './views/JsonTreeWebview';
import { LogBookmarkWebviewProvider } from './views/LogBookmarkWebviewProvider';
import { DashboardProvider } from './views/DashboardProvider';
import { RunbookTreeDataProvider } from './views/RunbookTreeDataProvider';
import { TimeRangeTreeDataProvider } from './views/TimeRangeTreeDataProvider';
import { WorkflowWebviewProvider } from './views/WorkflowWebviewProvider';

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
    logger.info('[extension] LogMagnifier activated');

    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push({
        dispose: () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
        }
    });

    logger.info('[extension] Initializing core services...');
    const filterManager = new FilterManager(context);
    context.subscriptions.push(filterManager);

    const lineMappingService = LineMappingService.getInstance();
    const logProcessor = new LogProcessor();
    const highlightService = new HighlightService(filterManager, logger);
    const workflowManager = new WorkflowManager(context, filterManager.profileManagerRef, logProcessor, logger, highlightService, lineMappingService, filterManager.filterStateServiceRef);
    context.subscriptions.push(workflowManager);

    const dashboardProvider = new DashboardProvider(filterManager, workflowManager, logger);
    context.subscriptions.push(dashboardProvider);
    context.subscriptions.push(highlightService);
    const resultCountService = new ResultCountService(filterManager);
    logger.info('[extension] Core services initialized');

    logger.info('[extension] Registering Workflow view...');
    const workflowProvider = new WorkflowWebviewProvider(context, workflowManager, logger);
    context.subscriptions.push(workflowProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(Constants.Views.Workflow, workflowProvider)
    );
    logger.info('[extension] Workflow view registered');

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

    logger.info('[extension] Registering Filter views...');
    const textTreeDataProvider = new FilterTreeDataProvider(filterManager, 'text', logger);
    context.subscriptions.push(textTreeDataProvider);
    const textTreeView = vscode.window.createTreeView(Constants.Views.TextFilters, {
        treeDataProvider: textTreeDataProvider,
        dragAndDropController: textTreeDataProvider,
        showCollapseAll: false
    });

    const regexTreeDataProvider = new FilterTreeDataProvider(filterManager, 'regex', logger);
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

    setupExpansionSync(textTreeView);
    setupExpansionSync(regexTreeView);

    logger.info('[extension] Filter views registered');

    // Register Definition Provider for Click-to-Navigate
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            [
                { scheme: Constants.Schemes.File, language: 'log' },
                { scheme: Constants.Schemes.Untitled, language: 'log' },
                { scheme: Constants.Schemes.Untitled, language: 'jsonc' },
                { scheme: Constants.Schemes.Untitled, language: 'json' }
            ],
            new FilteredLogDefinitionProvider(lineMappingService)
        )
    );

    logger.info('[extension] Registering Command Manager...');
    // Initialize Command Manager (Handles all command registrations)
    const jsonTreeWebview = new JsonTreeWebview(context, logger);
    context.subscriptions.push(jsonTreeWebview);

    const jsonPrettyService = new JsonPrettyService(logger, jsonTreeWebview, highlightService);
    context.subscriptions.push(jsonPrettyService);
    new CommandManager(context, {
        filterManager, highlightService, resultCountService, logProcessor,
        dashboardProvider, logger, textTreeView, regexTreeView,
        jsonPrettyService, lineMappingService
    });
    new WorkflowCommandManager(context, workflowManager, filterManager, logger);

    logger.info('[extension] Command Manager registered');

    // File Hierarchy Service & Navigation
    logger.info('[extension] Registering File Hierarchy...');
    const fileHierarchyService = FileHierarchyService.createInstance(context);
    context.subscriptions.push(fileHierarchyService);
    new NavigationCommandManager(context, fileHierarchyService, logger);
    const hierarchyLensProvider = new FileHierarchyLensProvider(fileHierarchyService);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [{ scheme: Constants.Schemes.File }, { scheme: Constants.Schemes.Untitled }],
            hierarchyLensProvider
        )
    );

    logger.info('[extension] File Hierarchy registered');

    // ADB Devices
    logger.info('[extension] Registering ADB Devices view...');
    const adbService = new AdbService(logger);
    context.subscriptions.push(adbService);
    const adbDeviceTreeProvider = new AdbDeviceTreeProvider(adbService);
    context.subscriptions.push(adbDeviceTreeProvider);
    const adbTreeView = vscode.window.createTreeView(Constants.Views.ADBDevices, {
        treeDataProvider: adbDeviceTreeProvider,
        showCollapseAll: true
    });
    new AdbCommandManager(context, adbService, adbDeviceTreeProvider, adbTreeView, logger);

    logger.info('[extension] ADB Devices view registered');

    // Runbook
    logger.info('[extension] Registering Runbook view...');
    const runbookService = new RunbookService(context, logger);
    const runbookTreeDataProvider = new RunbookTreeDataProvider(runbookService);
    context.subscriptions.push(runbookTreeDataProvider);
    vscode.window.createTreeView(Constants.Views.Runbook, {
        treeDataProvider: runbookTreeDataProvider,
        showCollapseAll: false
    });
    new RunbookCommandManager(context, runbookService, logger);

    logger.info('[extension] Runbook view registered');

    // Log Bookmark
    logger.info('[extension] Registering Bookmark view...');
    const bookmarkService = new LogBookmarkService(context);
    context.subscriptions.push(bookmarkService);

    const bookmarkWebviewProvider = new LogBookmarkWebviewProvider(context.extensionUri, bookmarkService, logger);
    context.subscriptions.push(bookmarkWebviewProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(Constants.Views.Bookmark, bookmarkWebviewProvider)
    );

    new LogBookmarkCommandManager(context, bookmarkService, highlightService);

    logger.info('[extension] Bookmark view registered');

    // Timestamp Analysis — Status Bar + Time Range Explorer
    logger.info('[extension] Registering Timestamp Analysis + Time Range Explorer...');
    const timestampService = new TimestampService();
    const timestampStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    timestampStatusBar.command = Constants.Commands.TimestampGotoTime;
    context.subscriptions.push(timestampStatusBar);

    const timeRangeProvider = new TimeRangeTreeDataProvider();
    context.subscriptions.push(timeRangeProvider);
    vscode.window.createTreeView(Constants.Views.TimeRange, {
        treeDataProvider: timeRangeProvider,
        showCollapseAll: true,
    });

    const applyTimestampIndex = (index: TimestampIndex) => {
        const text = timestampService.formatStatusBarText(index);
        if (text) {
            timestampStatusBar.text = text;
            timestampStatusBar.tooltip = `Timestamp: ${index.format.name} (${index.lineTimestamps.size} lines with timestamps)`;
            timestampStatusBar.show();
        } else {
            timestampStatusBar.hide();
        }
        timeRangeProvider.setIndex(index);
    };

    const updateTimestampAnalysis = (document: vscode.TextDocument | undefined) => {
        if (!document) {
            return;
        }
        if (!isSupportedScheme(document.uri)) {
            return;
        }
        try {
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            if (!config.get<boolean>(Constants.Configuration.Timestamp.Enabled, true) ||
                !config.get<boolean>(Constants.Configuration.Timestamp.AutoDetect, true)) {
                timestampStatusBar.hide();
                timeRangeProvider.clearIndex();
                return;
            }
            const uri = document.uri.toString();

            // Use cached index if available
            const cached = timestampService.getIndex(uri);
            if (cached) {
                applyTimestampIndex(cached);
                return;
            }

            const lines: string[] = [];
            const sampleSize = Math.min(document.lineCount, 100);
            for (let i = 0; i < sampleSize; i++) {
                lines.push(document.lineAt(i).text);
            }
            const fmt = timestampService.detectFormat(lines);
            if (!fmt) {
                timestampStatusBar.hide();
                timeRangeProvider.clearIndex();
                return;
            }
            const allLines: string[] = [];
            for (let i = 0; i < document.lineCount; i++) {
                allLines.push(document.lineAt(i).text);
            }
            const index = timestampService.buildIndex(allLines, fmt, uri);
            applyTimestampIndex(index);
        } catch (e: unknown) {
            logger.error(`Error updating timestamp analysis: ${e instanceof Error ? e.message : String(e)}`);
            timestampStatusBar.hide();
            timeRangeProvider.clearIndex();
        }
    };

    context.subscriptions.push(vscode.commands.registerCommand(
        Constants.Commands.TimeRangeJumpToLine,
        (line: number) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || line < 0 || line >= editor.document.lineCount) {
                return;
            }
            const range = new vscode.Range(line, 0, line, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.start);
            highlightService.flashLine(editor, line);
        }
    ));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        updateTimestampAnalysis(editor?.document);
    }));
    // Invalidate timestamp cache when document content changes
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
        timestampService.invalidateIndex(e.document.uri.toString());
    }));
    // Clean up timestamp cache when document is closed
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        timestampService.invalidateIndex(doc.uri.toString());
    }));
    new TimestampCommandManager(context, timestampService, lineMappingService, highlightService, timeRangeProvider, logger);
    logger.info('[extension] Timestamp Analysis + Time Range Explorer registered');

    // Selection Gap Display — show gap gutter icons when multi-line selection
    const selectionGapStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 49);
    context.subscriptions.push(selectionGapStatusBar);

    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        const editor = e.textEditor;
        const index = timeRangeProvider.getIndex();
        if (!editor || !index) {
            highlightService.clearGapDecorations(editor);
            selectionGapStatusBar.hide();
            return;
        }

        const selection = e.selections[0];
        const startLine = Math.min(selection.anchor.line, selection.active.line);
        const endLine = Math.max(selection.anchor.line, selection.active.line);

        if (startLine >= endLine) {
            highlightService.clearGapDecorations(editor);
            selectionGapStatusBar.hide();
            return;
        }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const thresholdMs = config.get<number>(Constants.Configuration.Timestamp.GapThreshold) ?? 1000;
        const gaps = timestampService.findGapsInRange(index, startLine, endLine, thresholdMs);

        if (gaps.length === 0) {
            highlightService.clearGapDecorations(editor);
            selectionGapStatusBar.hide();
            return;
        }

        highlightService.showGapDecorations(editor, gaps);

        // Status bar summary
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatDuration = (ms: number): string => {
            if (ms < 1000) { return `${ms}ms`; }
            if (ms < 60_000) { return `${(ms / 1000).toFixed(1)}s`; }
            return `${(ms / 60_000).toFixed(1)}m`; };
        const lineCount = endLine - startLine + 1;
        const maxGap = Math.max(...gaps.map(g => g.durationMs));
        const firstTs = index.lineTimestamps.get(startLine);
        const lastTs = index.lineTimestamps.get(endLine);
        let timeRange = '';
        if (firstTs && lastTs) {
            timeRange = ` | ${pad(firstTs.getHours())}:${pad(firstTs.getMinutes())}~${pad(lastTs.getHours())}:${pad(lastTs.getMinutes())}`;
        }
        selectionGapStatusBar.text = `$(watch) ${lineCount} lines${timeRange} | ${gaps.length} gap${gaps.length > 1 ? 's' : ''} (max +${formatDuration(maxGap)})`;
        selectionGapStatusBar.show();
    }));

    if (vscode.window.activeTextEditor) {
        updateTimestampAnalysis(vscode.window.activeTextEditor.document);
    }

    // Language Model Tools (AI Agent integration)
    logger.info('[extension] Registering Language Model Tools...');
    const lmToolManager = new LmToolManager(
        filterManager, logProcessor,
        timestampService, lineMappingService,
        workflowManager, bookmarkService, logger
    );
    context.subscriptions.push(lmToolManager);
    logger.info('[extension] Language Model Tools registered');

    // Initialize mouse over context
    vscode.commands.executeCommand('setContext', Constants.ContextKeys.BookmarkMouseOver, false);

    logger.info(`Registering DashboardProvider with view ID: ${Constants.Views.Dashboard}`);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(Constants.Views.Dashboard, dashboardProvider)
    );
    logger.info('DashboardProvider registered');

    // Initial highlight
    if (vscode.window.activeTextEditor) {
        const editor = vscode.window.activeTextEditor;
        const scheme = editor.document.uri.scheme;
        const fileName = editor.document.fileName;
        logger.info(`Initial active editor: ${fileName} (Scheme: ${scheme})`);

        refreshHighlightsForEditor(editor).catch(e => logger.error(`Initial highlight failed: ${e instanceof Error ? e.message : String(e)}`));
        lastProcessedDoc = editor.document;
    }

    logger.info('[extension] Registering event listeners...');
    registerEditorEventListeners(context, {
        logger, lineMappingService, highlightService, resultCountService,
        dashboardProvider, refreshHighlightsForEditor,
        getLastProcessedDoc: () => lastProcessedDoc,
        setLastProcessedDoc: (doc) => { lastProcessedDoc = doc; },
        getDebounceTimer: () => debounceTimer,
        setDebounceTimer: (t) => { debounceTimer = t; },
    });

    registerFilterEventListeners(context, {
        logger, filterManager, highlightService, dashboardProvider,
        textTreeDataProvider, regexTreeDataProvider, runbookTreeDataProvider,
        refreshHighlightsForEditor,
        setLastProcessedDoc: (doc) => { lastProcessedDoc = doc; },
    });
    logger.info('[extension] Activation complete');

    return {
        filterManager,
        bookmarkService,
        highlightService,
        lineMappingService,
        adbService
    };
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
        `LogMagnifier failed to activate: ${e instanceof Error ? e.message : String(e)}`
    );
    throw e;
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
    lineMappingService: LineMappingService;
    highlightService: HighlightService;
    resultCountService: ResultCountService;
    dashboardProvider: DashboardProvider;
    refreshHighlightsForEditor: (editor: vscode.TextEditor) => Promise<void>;
    getLastProcessedDoc: () => vscode.TextDocument | undefined;
    setLastProcessedDoc: (doc: vscode.TextDocument | undefined) => void;
    getDebounceTimer: () => NodeJS.Timeout | undefined;
    setDebounceTimer: (t: NodeJS.Timeout | undefined) => void;
}

function registerEditorEventListeners(context: vscode.ExtensionContext, deps: EditorEventListenerDeps) {
    const { logger, lineMappingService, highlightService, resultCountService,
        dashboardProvider, refreshHighlightsForEditor,
        getLastProcessedDoc, setLastProcessedDoc,
        getDebounceTimer, setDebounceTimer } = deps;

    // Listen for selection changes to trigger navigation animation (flash)
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        try {
            const editor = e.textEditor;
            if (editor && e.selections.length > 0) {
                const line = e.selections[0].active.line;
                if (lineMappingService.checkAndConsumePendingNavigation(editor.document.uri, line)) {
                    highlightService.flashLine(editor, line);
                }
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeTextEditorSelection: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));

    // Update highlights and counts when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async editor => {
        try {
            lineMappingService.updateContextKey(editor);

            // Check for pending navigation (animation) on active editor change
            if (editor && editor.selection) {
                const line = editor.selection.active.line;
                if (lineMappingService.checkAndConsumePendingNavigation(editor.document.uri, line)) {
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

                dashboardProvider.refresh();

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
                                dashboardProvider.refresh();
                                logger.info(`Active editor changed to (Tab): ${uri.fsPath} (${sizeMB.toFixed(2)}MB). - Too large for extension host (Limit ${Constants.Defaults.LargeFileSizeLimitMB}MB).`);
                                vscode.window.setStatusBarMessage(`LogMagnifier: File too large (${sizeMB.toFixed(1)}MB). VS Code limits extension support to ${Constants.Defaults.LargeFileSizeLimitMB}MB.`, 5000);
                            }
                        }
                    } catch (e: unknown) {
                        logger.error(`Error checking file size: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeActiveTextEditor: ${e instanceof Error ? e.message : String(e)}`);
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
                        } catch (e: unknown) {
                            logger.error(`Error in onDidChangeTextEditor debounce: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                    setDebounceTimer(undefined);
                }, 500));

                // Update Dashboard if untitled (size changes)
                if (e.document.isUntitled) {
                    dashboardProvider.refresh();
                }
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeTextDocument: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));

    // Update Dashboard when file is saved (size changes)
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
        try {
            if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
                dashboardProvider.refresh();
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidSaveTextDocument: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));

    // Prevent memory leak by clearing reference to closed documents
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        try {
            if (getLastProcessedDoc() === doc) {
                setLastProcessedDoc(undefined);
                resultCountService.clearCounts();
                dashboardProvider.refresh();
            }
            lineMappingService.unregister(doc.uri);
            highlightService.unregisterDocumentFilters(doc.uri);
        } catch (e: unknown) {
            logger.error(`Error in onDidCloseTextDocument: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));
}

interface FilterEventListenerDeps {
    logger: Logger;
    filterManager: FilterManager;
    highlightService: HighlightService;
    dashboardProvider: DashboardProvider;
    textTreeDataProvider: FilterTreeDataProvider;
    regexTreeDataProvider: FilterTreeDataProvider;
    runbookTreeDataProvider: RunbookTreeDataProvider;
    refreshHighlightsForEditor: (editor: vscode.TextEditor) => Promise<void>;
    setLastProcessedDoc: (doc: vscode.TextDocument | undefined) => void;
}

function registerFilterEventListeners(context: vscode.ExtensionContext, deps: FilterEventListenerDeps) {
    const { logger, filterManager, highlightService, dashboardProvider,
        textTreeDataProvider, regexTreeDataProvider, runbookTreeDataProvider,
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
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeFilters: ${e instanceof Error ? e.message : String(e)}`);
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

            // Refresh Dashboard view if editor settings change
            if (e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.WordWrap}`) ||
                e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.MinimapEnabled}`) ||
                e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.StickyScrollEnabled}`)) {
                dashboardProvider.refresh();
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeConfiguration: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));

    // Refresh tree views and highlights when color theme changes
    context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(async () => {
        try {
            highlightService.refreshDecorationType();
            textTreeDataProvider.refresh();
            regexTreeDataProvider.refresh();
            runbookTreeDataProvider.refresh();
            if (vscode.window.activeTextEditor) {
                if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
                    await refreshHighlightsForEditor(vscode.window.activeTextEditor);
                }
            }
        } catch (e: unknown) {
            logger.error(`Error in onDidChangeActiveColorTheme: ${e instanceof Error ? e.message : String(e)}`);
        }
    }));
}
