import * as vscode from 'vscode';
import { FilterManager } from './services/FilterManager';
import { FilterTreeDataProvider } from './views/FilterTreeView';
import { LogProcessor } from './services/LogProcessor';
import { FilterGroup, FilterItem } from './models/Filter';
import { HighlightService } from './services/HighlightService';

export function activate(context: vscode.ExtensionContext) {
	const filterManager = new FilterManager();
	const treeDataProvider = new FilterTreeDataProvider(filterManager);
	const logProcessor = new LogProcessor();
	const highlightService = new HighlightService(filterManager);

	vscode.window.registerTreeDataProvider('loglens-filters', treeDataProvider);

	// Update highlights when active editor changes
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			highlightService.updateHighlights(editor);
		}
	}));

	// Update highlights when filters change
	context.subscriptions.push(filterManager.onDidChangeFilters(() => {
		if (vscode.window.activeTextEditor) {
			highlightService.updateHighlights(vscode.window.activeTextEditor);
		}
	}));

	// Initial highlight
	if (vscode.window.activeTextEditor) {
		highlightService.updateHighlights(vscode.window.activeTextEditor);
	}

	// Command: Add Filter Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addFilterGroup', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Enter Filter Group Name' });
		if (name) {
			filterManager.addGroup(name);
		}
	}));

	// Command: Add Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addFilter', async (group: FilterGroup | undefined) => {
		let targetGroupId: string | undefined = group?.id;

		if (!targetGroupId) {
			const groups = filterManager.getGroups();
			if (groups.length === 0) {
				vscode.window.showErrorMessage('No filter groups exist. Create a group first.');
				return;
			}
			const selected = await vscode.window.showQuickPick(groups.map(g => ({ label: g.name, id: g.id })), { placeHolder: 'Select Filter Group' });
			if (!selected) return;
			targetGroupId = selected.id;
		}

		const keyword = await vscode.window.showInputBox({ prompt: 'Enter Filter Keyword' });
		if (!keyword) return;

		const type = await vscode.window.showQuickPick(['include', 'exclude'], { placeHolder: 'Select Filter Type' });
		if (!type) return;

		filterManager.addFilter(targetGroupId, keyword, type as 'include' | 'exclude');
	}));

	// Command: Toggle Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.toggleGroup', (group: FilterGroup) => {
		if (group) filterManager.toggleGroup(group.id);
	}));

	// Command: Enable Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.enableGroup', (group: FilterGroup) => {
		if (group && !group.isEnabled) {
			filterManager.toggleGroup(group.id);
		}
	}));

	// Command: Disable Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.disableGroup', (group: FilterGroup) => {
		if (group && group.isEnabled) {
			filterManager.toggleGroup(group.id);
		}
	}));

	// Command: Enable Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.enableFilter', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		for (const g of groups) {
			if (g.filters.find(f => f.id === item.id)) {
				if (!item.isEnabled) filterManager.toggleFilter(g.id, item.id);
				break;
			}
		}
	}));

	// Command: Disable Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.disableFilter', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		for (const g of groups) {
			if (g.filters.find(f => f.id === item.id)) {
				if (item.isEnabled) filterManager.toggleFilter(g.id, item.id);
				break;
			}
		}
	}));

	// Command: Toggle Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.toggleFilter', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		for (const g of groups) {
			if (g.filters.find(f => f.id === item.id)) {
				filterManager.toggleFilter(g.id, item.id);
				break;
			}
		}
	}));

	// Command: Delete Filter / Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.deleteFilter', async (item: FilterGroup | FilterItem) => {
		if (!item) return;
		if ((item as FilterGroup).filters !== undefined) {
			filterManager.removeGroup(item.id);
		} else {
			const groups = filterManager.getGroups();
			for (const g of groups) {
				if (g.filters.find(f => f.id === item.id)) {
					filterManager.removeFilter(g.id, item.id);
					break;
				}
			}
		}
	}));

	// Guard
	let isProcessing = false;

	// Command: Apply Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.applyFilter', async () => {
		if (isProcessing) return;
		isProcessing = true;

		try {
			const activeGroups = filterManager.getGroups().filter(g => g.isEnabled);
			if (activeGroups.length === 0) {
				vscode.window.showWarningMessage('No active filter groups selected.');
				return;
			}

			// Strategy: 
			// 1. Try Active Text Editor (Normal files, Untitled)
			// 2. Try Tab API (Large files, Restricted mode)

			let document: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;
			let filePathFromTab: string | undefined;

			if (!document) {
				// Try to find the active tab URI via Tab API (Robust for Large files)
				const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
				if (activeTab && activeTab.input instanceof vscode.TabInputText) {
					const uri = activeTab.input.uri;
					if (uri.scheme === 'file') {
						filePathFromTab = uri.fsPath;
					} else if (uri.scheme === 'untitled') {
						// If it's untitled but not active editor, it might be weird, but let's try to open it
						try {
							const doc = await vscode.workspace.openTextDocument(uri);
							document = doc;
						} catch (e) { console.error(e); }
					}
				}

				// Fallback aggressive search if Tab API didn't give a path (e.g. custom editor?)
				if (!filePathFromTab && !document) {
					const openFile = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled');
					if (openFile) document = openFile;
				}
			}

			if (!document && !filePathFromTab) {
				vscode.window.showErrorMessage('No active file found. Please ensure a log file is open and visible.');
				return;
			}

			let outputPath = '';
			let inMemoryContent = '';
			let stats = { processed: 0, matched: 0 };

			// sourceName for progress log
			const sourceName = document ? (document.fileName || 'Untitled') : (filePathFromTab || 'Large File');

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Applying Filters on ${sourceName}...`,
				cancellable: false
			}, async (progress) => {
				try {
					if (document && document.isUntitled) {
						const fullText = document.getText();
						const lines = fullText.split(/\r?\n/);
						const filtered = lines.filter(line => {
							stats.processed++;
							const keep = shouldKeepLine(line, activeGroups);
							if (keep) stats.matched++;
							return keep;
						});
						inMemoryContent = filtered.join('\n');
					} else {
						// Read from Disk (Stream)
						const targetPath = filePathFromTab || document?.uri.fsPath;
						if (!targetPath) throw new Error("Could not check active file path");

						const result = await logProcessor.processFile(targetPath, activeGroups);
						outputPath = result.outputPath;
						stats.processed = result.processed;
						stats.matched = result.matched;
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Error applying filters: ${error}`);
					return;
				}
			});

			const message = `Filtered ${stats.processed.toLocaleString()} lines. Matched ${stats.matched.toLocaleString()} lines.`;
			if (stats.matched === 0) {
				vscode.window.showWarningMessage(message + " Check your filter keywords (case-sensitive).");
			} else {
				vscode.window.setStatusBarMessage(message, 5000);
			}

			if (document && document.isUntitled) {
				const newDoc = await vscode.workspace.openTextDocument({ content: inMemoryContent, language: 'log' });
				await vscode.window.showTextDocument(newDoc, { preview: false });
			} else {
				if (outputPath) {
					const newDoc = await vscode.workspace.openTextDocument(outputPath);
					await vscode.window.showTextDocument(newDoc, { preview: false });
					// Ensure language mode
					if (newDoc.languageId !== 'log') {
						await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
					}
				}
			}
		} finally {
			isProcessing = false;
		}
	}));
}

function shouldKeepLine(line: string, groups: FilterGroup[]): boolean {
	for (const group of groups) {
		const includes = group.filters.filter(f => f.type === 'include' && f.isEnabled);
		const excludes = group.filters.filter(f => f.type === 'exclude' && f.isEnabled);

		for (const exclude of excludes) {
			if (line.includes(exclude.keyword)) {
				return false;
			}
		}

		if (includes.length > 0) {
			let matchFound = false;
			for (const include of includes) {
				if (line.includes(include.keyword)) {
					matchFound = true;
					break;
				}
			}
			if (!matchFound) {
				return false;
			}
		}
	}
	return true;
}

export function deactivate() { }
