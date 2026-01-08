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

export function activate(context: vscode.ExtensionContext) {
	const filterManager = new FilterManager(context);

	const quickAccessProvider = new QuickAccessProvider();
	const logProcessor = new LogProcessor();
	const logger = Logger.getInstance();
	logger.info('LogMagnifier activated');

	const highlightService = new HighlightService(filterManager, logger);
	const resultCountService = new ResultCountService(filterManager);

	let lastProcessedDoc: vscode.TextDocument | undefined;

	const wordTreeDataProvider = new FilterTreeDataProvider(filterManager, 'word');
	const wordTreeView = vscode.window.createTreeView('logmagnifier-filters', {
		treeDataProvider: wordTreeDataProvider,
		dragAndDropController: wordTreeDataProvider,
		showCollapseAll: false
	});

	const regexTreeDataProvider = new FilterTreeDataProvider(filterManager, 'regex');
	const regexTreeView = vscode.window.createTreeView('logmagnifier-regex-filters', {
		treeDataProvider: regexTreeDataProvider,
		dragAndDropController: regexTreeDataProvider,
		showCollapseAll: false
	});

	// Sync expansion state
	const setupExpansionSync = (view: vscode.TreeView<any>) => {
		context.subscriptions.push(view.onDidExpandElement(e => {
			if ((e.element as any).filters) { // Check if group
				filterManager.setGroupExpanded(e.element.id, true);
			}
		}));
		context.subscriptions.push(view.onDidCollapseElement(e => {
			if ((e.element as any).filters) {
				filterManager.setGroupExpanded(e.element.id, false);
			}
		}));
	};

	setupExpansionSync(wordTreeView);
	setupExpansionSync(regexTreeView);

	// Initialize Command Manager (Handles all command registrations)
	new CommandManager(context, filterManager, highlightService, resultCountService, logProcessor, quickAccessProvider, logger, wordTreeView, regexTreeView);

	vscode.window.createTreeView('logmagnifier-quick-access', { treeDataProvider: quickAccessProvider });

	// Update highlights and counts when active editor changes
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		quickAccessProvider.refresh();
		if (editor) {
			const scheme = editor.document.uri.scheme;
			if (scheme !== 'file' && scheme !== 'untitled') {
				return;
			}
			const fileName = editor.document.fileName;

			// Optimization: Prevent redundant processing if switching back to the same document
			if (lastProcessedDoc && editor.document === lastProcessedDoc) {
				return;
			}

			const largeFileOptimizations = vscode.workspace.getConfiguration('editor').get<boolean>('largeFileOptimizations');
			logger.info(`Active editor changed to: ${fileName} (Scheme: ${scheme}, LargeFileOptimizations: ${largeFileOptimizations})`);

			const counts = highlightService.updateHighlights(editor);
			resultCountService.updateCounts(counts);
			lastProcessedDoc = editor.document;
		} else {
			lastProcessedDoc = undefined; // Invalidate since we are not tracking a standard editor

			// Fallback for large files where activeTextEditor is undefined
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			if (activeTab && activeTab.input instanceof vscode.TabInputText) {
				const uri = activeTab.input.uri;

				// Standard VS Code limit for extensions is 50MB
				try {
					if (uri.scheme === 'file') {
						const stats = fs.statSync(uri.fsPath);
						const sizeMB = stats.size / (1024 * 1024);
						if (sizeMB > 50) {
							logger.info(`Active editor changed to (Tab): ${uri.fsPath} (${sizeMB.toFixed(2)}MB). - Too large for extension host (Limit 50MB).`);
							vscode.window.setStatusBarMessage(`LogMagnifier: File too large (${sizeMB.toFixed(1)}MB). VS Code limits extension support to 50MB.`, 5000);
							resultCountService.clearCounts();
							return;
						}
					}
				} catch (e) {
					logger.error(`Error checking file size: ${e}`);
				}

				logger.info(`Active editor changed to (Tab): ${uri.fsPath} (Scheme: ${uri.scheme}) - activeTextEditor undefined.`);
			} else {
				logger.info('Active editor changed to: (None)');
			}
		}
	}));

	// Update highlights when filters change
	context.subscriptions.push(filterManager.onDidChangeFilters(() => {
		lastProcessedDoc = undefined; // Force update
		if (vscode.window.activeTextEditor) {
			const scheme = vscode.window.activeTextEditor.document.uri.scheme;
			if (scheme === 'file' || scheme === 'untitled') {
				const counts = highlightService.updateHighlights(vscode.window.activeTextEditor);
				resultCountService.updateCounts(counts);
				lastProcessedDoc = vscode.window.activeTextEditor.document;
			}
		}
	}));

	// Update highlights when configuration changes (e.g. color)
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('logmagnifier.regex.highlightColor') || e.affectsConfiguration('logmagnifier.regex.enableHighlight')) {
			highlightService.refreshDecorationType();
			lastProcessedDoc = undefined; // Force update
			if (vscode.window.activeTextEditor) {
				const scheme = vscode.window.activeTextEditor.document.uri.scheme;
				if (scheme === 'file' || scheme === 'untitled') {
					const counts = highlightService.updateHighlights(vscode.window.activeTextEditor);
					resultCountService.updateCounts(counts);
					lastProcessedDoc = vscode.window.activeTextEditor.document;
				}
			}
		}

		// Refresh Quick Access view if editor settings change
		if (e.affectsConfiguration('editor.wordWrap') ||
			e.affectsConfiguration('editor.minimap.enabled') ||
			e.affectsConfiguration('editor.stickyScroll.enabled')) {
			quickAccessProvider.refresh();
		}
	}));

	// Initial highlight
	if (vscode.window.activeTextEditor) {
		const editor = vscode.window.activeTextEditor;
		const scheme = editor.document.uri.scheme;
		const fileName = editor.document.fileName;
		logger.info(`Initial active editor: ${fileName} (Scheme: ${scheme})`);

		const counts = highlightService.updateHighlights(editor);
		resultCountService.updateCounts(counts);
		lastProcessedDoc = editor.document;
	}

	let debounceTimer: NodeJS.Timeout | undefined;

	// Update counts when text changes
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
			const scheme = e.document.uri.scheme;
			if (scheme !== 'file' && scheme !== 'untitled') {
				return;
			}

			lastProcessedDoc = undefined; // Invalidate because content changed

			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}

			debounceTimer = setTimeout(() => {
				if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
					const counts = highlightService.updateHighlights(vscode.window.activeTextEditor);
					resultCountService.updateCounts(counts);
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
}

export function deactivate() { }
