import * as vscode from 'vscode';
import * as fs from 'fs';
import { FilterManager } from './services/FilterManager';
import { FilterTreeDataProvider } from './views/FilterTreeView';
import { QuickAccessProvider } from './views/QuickAccessProvider';
import { LogProcessor } from './services/LogProcessor';
import { HighlightService } from './services/HighlightService';
import { ResultCountService } from './services/ResultCountService';
import { Logger } from './services/Logger';
import { CommandManager } from './services/CommandManager';
import { AdbService } from './services/AdbService';
import { AdbDeviceTreeProvider } from './views/AdbDeviceTreeProvider';
import { AdbCommandManager } from './services/AdbCommandManager';
import { LogBookmarkService } from './services/LogBookmarkService';
import { LogBookmarkWebviewProvider } from './views/LogBookmarkWebviewProvider';
import { LogBookmarkCommandManager } from './services/LogBookmarkCommandManager';
import { JsonPrettyService } from './services/JsonPrettyService';
import { JsonTreeWebview } from './views/JsonTreeWebview';
import { SourceMapService } from './services/SourceMapService';
import { FilteredLogDefinitionProvider } from './providers/FilteredLogDefinitionProvider';
import { Constants } from './constants';

let debounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
	const logger = Logger.getInstance();
	logger.info('LogMagnifier activated');

	const filterManager = new FilterManager(context);
	context.subscriptions.push(filterManager);

	const quickAccessProvider = new QuickAccessProvider(filterManager);
	const logProcessor = new LogProcessor();

	const highlightService = new HighlightService(filterManager, logger);
	context.subscriptions.push(highlightService);
	const resultCountService = new ResultCountService(filterManager);

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
	const isGroup = (item: unknown): item is import('./models/Filter').FilterGroup => {
		return typeof item === 'object' && item !== null && Array.isArray((item as import('./models/Filter').FilterGroup).filters);
	};

	const setupExpansionSync = (view: vscode.TreeView<any>) => {
		context.subscriptions.push(view.onDidExpandElement(e => {
			if (isGroup(e.element)) {
				filterManager.setGroupExpanded(e.element.id, true);
			}
		}));
		context.subscriptions.push(view.onDidCollapseElement(e => {
			if (isGroup(e.element)) {
				filterManager.setGroupExpanded(e.element.id, false);
			}
		}));
	};

	setupExpansionSync(wordTreeView);
	setupExpansionSync(regexTreeView);

	// Source Map Service
	const sourceMapService = SourceMapService.getInstance();

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

	const jsonPrettyService = new JsonPrettyService(logger, sourceMapService, jsonTreeWebview, highlightService);
	new CommandManager(context, filterManager, highlightService, resultCountService, logProcessor, quickAccessProvider, logger, wordTreeView, regexTreeView, jsonPrettyService, sourceMapService);

	// ADB Devices
	const adbService = new AdbService(logger);
	context.subscriptions.push(adbService);
	const adbDeviceTreeProvider = new AdbDeviceTreeProvider(adbService);
	vscode.window.registerTreeDataProvider(Constants.Views.ADBDevices, adbDeviceTreeProvider);
	new AdbCommandManager(context, adbService, adbDeviceTreeProvider);

	// Deferred initialization is now handled lazily by AdbDeviceTreeProvider.getChildren()

	// Log Bookmark
	const bookmarkService = new LogBookmarkService(context);
	context.subscriptions.push(bookmarkService);

	const bookmarkWebviewProvider = new LogBookmarkWebviewProvider(context.extensionUri, bookmarkService, logger);
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

	// Listen for selection changes to trigger navigation animation (flash)
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
		const editor = e.textEditor;
		if (editor && e.selections.length > 0) {
			const line = e.selections[0].active.line;
			if (sourceMapService.checkAndConsumePendingNavigation(editor.document.uri, line)) {
				highlightService.flashLine(editor, line);
			}
		}
	}));

	// Update highlights and counts when active editor changes
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async editor => {
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

			if (lastProcessedDoc && editor.document === lastProcessedDoc) {
				return;
			}

			const largeFileOptimizations = vscode.workspace.getConfiguration(Constants.Configuration.Editor.Section).get<boolean>(Constants.Configuration.Editor.LargeFileOptimizations);
			const fileName = editor.document.fileName;
			const scheme = editor.document.uri.scheme;
			logger.info(`Active editor changed to: ${fileName} (Scheme: ${scheme}, LargeFileOptimizations: ${largeFileOptimizations})`);

			quickAccessProvider.refresh();

			const counts = await highlightService.updateHighlights(editor);
			if (counts) {
				resultCountService.updateCounts(counts);
			}
			lastProcessedDoc = editor.document;
		} else {
			// Fallback for large files where activeTextEditor is undefined
			// We only want to handle the specific case where a file is too large for VS Code to provide an editor.
			// Other cases (e.g. focus lost to Output panel, transition states) should be ignored to prevent redundant refreshes/logs.
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			if (activeTab && activeTab.input instanceof vscode.TabInputText) {
				const uri = activeTab.input.uri;
				try {
					if (uri.scheme === Constants.Schemes.File) {
						const stats = fs.statSync(uri.fsPath);
						const sizeMB = stats.size / (1024 * 1024);
						if (sizeMB > 50) {
							lastProcessedDoc = undefined;
							resultCountService.clearCounts();
							quickAccessProvider.refresh();
							logger.info(`Active editor changed to (Tab): ${uri.fsPath} (${sizeMB.toFixed(2)}MB). - Too large for extension host (Limit 50MB).`);
							vscode.window.setStatusBarMessage(`LogMagnifier: File too large (${sizeMB.toFixed(1)}MB). VS Code limits extension support to 50MB.`, 5000);
						}
					}
				} catch (e) {
					logger.error(`Error checking file size: ${e}`);
				}
			}
		}
	}));

	// Update highlights when filters change
	context.subscriptions.push(filterManager.onDidChangeFilters(async () => {
		lastProcessedDoc = undefined; // Force update
		if (vscode.window.activeTextEditor) {
			const scheme = vscode.window.activeTextEditor.document.uri.scheme;
			if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
				const counts = await highlightService.updateHighlights(vscode.window.activeTextEditor);
				if (counts) {
					resultCountService.updateCounts(counts);
				}
				lastProcessedDoc = vscode.window.activeTextEditor.document;
			}
		}
	}));

	// Update highlights when configuration changes (e.g. color)
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration(`${Constants.Configuration.Section}.${Constants.Configuration.Regex.HighlightColor}`) ||
			e.affectsConfiguration(`${Constants.Configuration.Section}.${Constants.Configuration.Regex.EnableHighlight}`)) {
			highlightService.refreshDecorationType();
			lastProcessedDoc = undefined; // Force update
			if (vscode.window.activeTextEditor) {
				const scheme = vscode.window.activeTextEditor.document.uri.scheme;
				if (isSupportedScheme(vscode.window.activeTextEditor.document.uri)) {
					const counts = await highlightService.updateHighlights(vscode.window.activeTextEditor);
					if (counts) {
						resultCountService.updateCounts(counts);
					}
					lastProcessedDoc = vscode.window.activeTextEditor.document;
				}
			}
		}

		// Refresh Quick Access view if editor settings change
		if (e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.WordWrap}`) ||
			e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.MinimapEnabled}`) ||
			e.affectsConfiguration(`${Constants.Configuration.Editor.Section}.${Constants.Configuration.Editor.StickyScrollEnabled}`)) {
			quickAccessProvider.refresh();
		}
	}));

	// Refresh tree views when color theme changes to update icons
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
		wordTreeDataProvider.refresh();
		regexTreeDataProvider.refresh();
	}));

	// Initial highlight
	if (vscode.window.activeTextEditor) {
		const editor = vscode.window.activeTextEditor;
		const scheme = editor.document.uri.scheme;
		const fileName = editor.document.fileName;
		logger.info(`Initial active editor: ${fileName} (Scheme: ${scheme})`);

		// Initial highlight (async)
		(async () => {
			const counts = await highlightService.updateHighlights(editor);
			if (counts) {
				resultCountService.updateCounts(counts);
			}
		})();
		lastProcessedDoc = editor.document;
	}


	// Update counts when text changes
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
			const scheme = e.document.uri.scheme;
			if (!isSupportedScheme(e.document.uri)) {
				return;
			}

			lastProcessedDoc = undefined; // Invalidate because content changed

			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}

			debounceTimer = setTimeout(async () => {
				if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
					const counts = await highlightService.updateHighlights(vscode.window.activeTextEditor);
					if (counts) {
						resultCountService.updateCounts(counts);
					}
					lastProcessedDoc = vscode.window.activeTextEditor.document;
				}
			}, 500);

			// Update Quick Access if untitled (size changes)
			if (e.document.isUntitled) {
				quickAccessProvider.refresh();
			}
		}
	}));

	// Update Quick Access when file is saved (size changes)
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
		if (vscode.window.activeTextEditor && doc === vscode.window.activeTextEditor.document) {
			quickAccessProvider.refresh();
		}
	}));

	// Prevent memory leak by clearing reference to closed documents
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
		if (lastProcessedDoc === doc) {
			lastProcessedDoc = undefined;
			resultCountService.clearCounts();
			quickAccessProvider.refresh();
		}
		sourceMapService.unregister(doc.uri);
	}));
}

export function deactivate() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
}

function isSupportedScheme(uri: vscode.Uri): boolean {
	return uri.scheme === Constants.Schemes.File || uri.scheme === Constants.Schemes.Untitled;
}
