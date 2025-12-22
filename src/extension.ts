import * as vscode from 'vscode';
import { FilterManager } from './services/FilterManager';
import { FilterTreeDataProvider } from './views/FilterTreeView';
import { LogProcessor } from './services/LogProcessor';
import { FilterGroup, FilterItem } from './models/Filter';
import { HighlightService } from './services/HighlightService';

export function activate(context: vscode.ExtensionContext) {
	const filterManager = new FilterManager();
	const wordTreeDataProvider = new FilterTreeDataProvider(filterManager, 'word');
	const regexTreeDataProvider = new FilterTreeDataProvider(filterManager, 'regex');
	const logProcessor = new LogProcessor();
	const highlightService = new HighlightService(filterManager);

	vscode.window.createTreeView('loglens-filters', { treeDataProvider: wordTreeDataProvider, dragAndDropController: wordTreeDataProvider });
	vscode.window.createTreeView('loglens-regex-filters', { treeDataProvider: regexTreeDataProvider, dragAndDropController: regexTreeDataProvider });

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

	// Update highlights when configuration changes (e.g. color)
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('loglens.highlightColor')) {
			highlightService.refreshDecorationType();
			if (vscode.window.activeTextEditor) {
				highlightService.updateHighlights(vscode.window.activeTextEditor);
			}
		}
	}));

	// Initial highlight
	if (vscode.window.activeTextEditor) {
		highlightService.updateHighlights(vscode.window.activeTextEditor);
	}

	// Command: Add Word Filter Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addFilterGroup', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Enter Word Filter Group Name' });
		if (name) {
			filterManager.addGroup(name, false);
		}
	}));

	// Command: Add Regex Filter Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addRegexFilterGroup', async () => {
		const name = await vscode.window.showInputBox({ prompt: 'Enter Regex Filter Group Name' });
		if (name) {
			filterManager.addGroup(name, true);
		}
	}));

	// Command: Add Word Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addFilter', async (group: FilterGroup | undefined) => {
		const targetGroupId = await ensureGroupId(filterManager, group, false);
		if (!targetGroupId) {
			return;
		}

		const keyword = await vscode.window.showInputBox({ prompt: 'Enter Filter Keyword' });
		if (!keyword) {
			return;
		}

		const items: vscode.QuickPickItem[] = [
			{ label: 'Include', description: 'Show lines containing this keyword' },
			{ label: 'Exclude', description: 'Hide lines containing this keyword' }
		];

		const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select Filter Type' });
		if (!selected) {
			return;
		}

		filterManager.addFilter(targetGroupId, keyword, selected.label === 'Include' ? 'include' : 'exclude', false);
	}));

	// Command: Add Regex Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.addRegexFilter', async (group: FilterGroup | undefined) => {
		const targetGroupId = await ensureGroupId(filterManager, group, true);
		if (!targetGroupId) {
			return;
		}

		const nickname = await vscode.window.showInputBox({ prompt: 'Enter Filter Nickname (e.g. ADB Logcat)' });
		if (!nickname) {
			return;
		}

		const pattern = await vscode.window.showInputBox({
			prompt: 'Enter Regex Pattern',
			validateInput: (value) => {
				try {
					new RegExp(value);
					return null;
				} catch (e) {
					return 'Invalid Regular Expression';
				}
			}
		});
		if (!pattern) {
			return;
		}

		// Skip type selection for Regex, default to 'include'
		filterManager.addFilter(targetGroupId, pattern, 'include', true, nickname);
	}));

	async function ensureGroupId(manager: FilterManager, group: FilterGroup | undefined, isRegex: boolean): Promise<string | undefined> {
		if (group?.id) {
			return group.id;
		}

		const groups = manager.getGroups().filter(g => isRegex ? g.isRegex : !g.isRegex);
		if (groups.length === 0) {
			vscode.window.showErrorMessage(`No ${isRegex ? 'Regex' : 'Word'} filter groups exist. Create a group first.`);
			return undefined;
		}
		const selected = await vscode.window.showQuickPick(groups.map(g => ({ label: g.name, id: g.id })), { placeHolder: `Select ${isRegex ? 'Regex' : 'Word'} Filter Group` });
		return selected?.id;
	}

	// Command: Toggle Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.toggleGroup', (group: FilterGroup) => {
		if (group) {
			filterManager.toggleGroup(group.id);
		}
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
				if (!item.isEnabled) {
					filterManager.toggleFilter(g.id, item.id);
				}
				break;
			}
		}
	}));

	// Command: Disable Filter
	context.subscriptions.push(vscode.commands.registerCommand('loglens.disableFilter', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		for (const g of groups) {
			if (g.filters.find(f => f.id === item.id)) {
				if (item.isEnabled) {
					filterManager.toggleFilter(g.id, item.id);
				}
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

	// Command: Toggle Filter Highlight Mode (Full Line vs Word)
	context.subscriptions.push(vscode.commands.registerCommand('loglens.toggleFilterHighlightMode', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

		if (targetGroup) {
			filterManager.toggleFilterHighlightMode(targetGroup.id, item.id);
		}
	}));


	// Command: Toggle Filter Case Sensitivity
	context.subscriptions.push(vscode.commands.registerCommand('loglens.toggleFilterCaseSensitivity', (item: FilterItem) => {
		const groups = filterManager.getGroups();
		let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

		if (targetGroup) {
			filterManager.toggleFilterCaseSensitivity(targetGroup.id, item.id);
		}
	}));

	// Command: Change Filter Color
	context.subscriptions.push(vscode.commands.registerCommand('loglens.changeFilterColor', async (item: any) => {
		// item likely has structure: { groupId, id, ... } from Tree Item context

		const groups = filterManager.getGroups();
		let targetGroup = groups.find(g => g.filters.some(f => f.id === item.id));

		if (targetGroup) {
			const presets = filterManager.getColorPresets();

			// Create QuickPickItems with SVG icons for each color
			const colorItems = presets.map(preset => {
				const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${preset.icon}"/></svg>`;
				const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

				return {
					label: preset.name,
					description: `Dark: ${preset.dark} | Light: ${preset.light}`,
					iconPath: iconUri,
					detail: '',
					picked: false
				} as vscode.QuickPickItem;
			});

			const picked = await vscode.window.showQuickPick(colorItems, {
				placeHolder: 'Select a highlight color',
				ignoreFocusOut: true
			});

			if (picked) {
				filterManager.updateFilterColor(targetGroup.id, item.id, picked.label);
			}
		}
	}));

	// Command: Delete Filter / Group
	context.subscriptions.push(vscode.commands.registerCommand('loglens.deleteFilter', async (item: FilterGroup | FilterItem) => {
		if (!item) {
			return;
		}
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
		if (isProcessing) {
			return;
		}
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
					if (openFile) {
						document = openFile;
					}
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
							if (keep) {
								stats.matched++;
							}
							return keep;
						});
						inMemoryContent = filtered.join('\n');
					} else {
						// Read from Disk (Stream)
						const targetPath = filePathFromTab || document?.uri.fsPath;
						if (!targetPath) {
							throw new Error("Could not check active file path");
						}

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
				const timeout = vscode.workspace.getConfiguration('loglens').get<number>('statusBarTimeout') || 5000;
				vscode.window.setStatusBarMessage(message, timeout);
			}

			if (document && document.isUntitled) {
				const newDoc = await vscode.workspace.openTextDocument({ content: inMemoryContent, language: 'log' });
				await vscode.window.showTextDocument(newDoc, { preview: false });
			} else {
				if (outputPath) {
					// Check file size
					const fs = require('fs');
					const stats = fs.statSync(outputPath);
					const fileSizeInBytes = stats.size;
					const limitInMB = vscode.workspace.getConfiguration('loglens').get<number>('maxFileSizeMB') || 50;
					const limitInBytes = limitInMB * 1024 * 1024;

					if (fileSizeInBytes > limitInBytes) {
						// Large file strategy: use vscode.open which handles large files better (no tokenization by default)
						await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
						// Note: We skip setting language to 'log' because for large files generic text handling is safer/faster
					} else {
						// Normal strategy
						const newDoc = await vscode.workspace.openTextDocument(outputPath);
						await vscode.window.showTextDocument(newDoc, { preview: false });
						// Ensure language mode
						if (newDoc.languageId !== 'log') {
							await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
						}
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
			if (exclude.isRegex) {
				try {
					const regex = new RegExp(exclude.keyword);
					if (regex.test(line)) {
						return false;
					}
				} catch (e) { /* ignore invalid regex */ }
			} else {
				if (exclude.caseSensitive) {
					if (line.includes(exclude.keyword)) {
						return false;
					}
				} else {
					if (line.toLowerCase().includes(exclude.keyword.toLowerCase())) {
						return false;
					}
				}
			}
		}

		if (includes.length > 0) {
			let matchFound = false;
			for (const include of includes) {
				if (include.isRegex) {
					try {
						const regex = new RegExp(include.keyword);
						if (regex.test(line)) {
							matchFound = true;
							break;
						}
					} catch (e) { /* ignore invalid regex */ }
				} else {
					if (include.caseSensitive) {
						if (line.includes(include.keyword)) {
							matchFound = true;
							break;
						}
					} else {
						if (line.toLowerCase().includes(include.keyword.toLowerCase())) {
							matchFound = true;
							break;
						}
					}
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
