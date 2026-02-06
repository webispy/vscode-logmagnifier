import * as vscode from 'vscode';
import { Constants } from '../constants';

import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';
import { Logger } from './Logger';
import { RegexUtils } from '../utils/RegexUtils';

export class HighlightService implements vscode.Disposable {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, { decoration: vscode.TextEditorDecorationType, config: any }> = new Map();
    private activeFlashDecoration: vscode.TextEditorDecorationType | undefined;
    private activeFlashTimeout: NodeJS.Timeout | undefined;

    constructor(
        private filterManager: FilterManager,
        private logger: Logger
    ) { }

    private getDecorationKey(colorNameOrValue: string | { light: string, dark: string } | undefined, isFullLine: boolean, textDecoration?: string, fontWeight?: string, textColor?: string): string {
        let colorKey = 'undefined';
        if (typeof colorNameOrValue === 'string') {
            const preset = this.filterManager.getPresetById(colorNameOrValue);
            if (preset) {
                colorKey = JSON.stringify({ light: preset.light, dark: preset.dark });
            } else {
                colorKey = colorNameOrValue;
            }
        } else if (colorNameOrValue) {
            colorKey = JSON.stringify(colorNameOrValue);
        }

        return `${colorKey}_${isFullLine}_${textDecoration || ''}_${fontWeight || 'auto'}_${textColor || 'auto'}`;
    }

    private getDecorationInfo(colorNameOrValue: string | { light: string, dark: string } | undefined, isFullLine: boolean = false, textDecoration?: string, fontWeight?: string, textColor?: string): { decoration: vscode.TextEditorDecorationType, config: any } {
        const key = this.getDecorationKey(colorNameOrValue, isFullLine, textDecoration, fontWeight, textColor);

        if (!this.decorationTypes.has(key)) {
            let decorationOptions: vscode.DecorationRenderOptions;

            const config = { colorNameOrValue, isFullLine, textDecoration, fontWeight, textColor };

            if (typeof colorNameOrValue === 'string') {
                const preset = this.filterManager.getPresetById(colorNameOrValue);
                if (preset) {
                    decorationOptions = {
                        light: { backgroundColor: preset.light },
                        dark: { backgroundColor: preset.dark },
                        fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration,
                        color: textColor
                    };
                } else {
                    decorationOptions = {
                        backgroundColor: colorNameOrValue,
                        fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration,
                        color: textColor
                    };
                }
            } else if (colorNameOrValue) {
                decorationOptions = {
                    light: { backgroundColor: colorNameOrValue.light },
                    dark: { backgroundColor: colorNameOrValue.dark },
                    fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration,
                    color: textColor
                };
            } else {
                decorationOptions = {
                    fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration,
                    opacity: '0.6',
                    color: textColor
                };
            }

            const decoration = vscode.window.createTextEditorDecorationType(decorationOptions);
            this.decorationTypes.set(key, { decoration, config });
        }
        return this.decorationTypes.get(key)!;
    }

    public refreshDecorationType() {
        // Explicitly clear decorations from all visible editors first
        vscode.window.visibleTextEditors.forEach(editor => {
            this.decorationTypes.forEach(({ decoration }) => {
                editor.setDecorations(decoration, []);
            });
        });

        this.dispose();
        // Clear cache explicitly after disposal to prevent memory leaks if dispose implementation changes
        this.decorationTypes.clear();
    }

    public async updateHighlights(editor: vscode.TextEditor): Promise<Map<string, number>> {
        if (!editor) {
            return new Map();
        }

        const lineCount = editor.document.lineCount;
        // Use chunked processing for files larger than 5000 lines
        // This threshold balances responsiveness and overhead
        if (lineCount > 5000) {
            return this.updateHighlightsChunked(editor);
        } else {
            return this.updateHighlightsSync(editor);
        }
    }

    private updateHighlightsSync(editor: vscode.TextEditor): Map<string, number> {
        const matchCounts = new Map<string, number>();
        const activeFilters = this.filterManager.getActiveFilters();
        const enableRegexHighlight = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<boolean>(Constants.Configuration.Regex.EnableHighlight) || false;

        const filtersToRun = activeFilters.filter(item => {
            return item.filter.isRegex ? enableRegexHighlight : true;
        });

        if (filtersToRun.length === 0) {
            this.decorationTypes.forEach(val => editor.setDecorations(val.decoration, []));
            return matchCounts;
        }

        this.logger.info(`Highlighting started (Sync, Items: ${filtersToRun.length})`);
        const startTime = Date.now();
        const text = editor.document.getText();
        const rangesByDeco: Map<string, vscode.Range[]> = new Map();
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        const defaultColor = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string | { light: string, dark: string }>(Constants.Configuration.Regex.HighlightColor) || Constants.Configuration.Regex.DefaultHighlightColor;

        filtersToRun.forEach(({ filter, groupId }) => {
            this.processFilter(editor, text, filter, groupId, defaultColor, rangesByDeco, matchCounts, 0);
        });

        this.applyDecorations(editor, rangesByDeco);

        const duration = Date.now() - startTime;
        this.logger.info(`Highlighting finished (Sync, ${duration}ms)`);
        return matchCounts;
    }

    private async updateHighlightsChunked(editor: vscode.TextEditor): Promise<Map<string, number>> {
        const CHUNK_SIZE = 2000;
        const YIELD_INTERVAL = 50; // ms

        const matchCounts = new Map<string, number>();
        const activeFilters = this.filterManager.getActiveFilters();
        const enableRegexHighlight = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<boolean>(Constants.Configuration.Regex.EnableHighlight) || false;

        const filtersToRun = activeFilters.filter(item => {
            return item.filter.isRegex ? enableRegexHighlight : true;
        });

        if (filtersToRun.length === 0) {
            this.decorationTypes.forEach(val => editor.setDecorations(val.decoration, []));
            return matchCounts;
        }

        this.logger.info(`Highlighting started (Chunked, Items: ${filtersToRun.length}, Lines: ${editor.document.lineCount})`);
        const startTime = Date.now();

        const rangesByDeco: Map<string, vscode.Range[]> = new Map();
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        const defaultColor = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string | { light: string, dark: string }>(Constants.Configuration.Regex.HighlightColor) || Constants.Configuration.Regex.DefaultHighlightColor;

        let lastYield = Date.now();

        for (let startLine = 0; startLine < editor.document.lineCount; startLine += CHUNK_SIZE) {
            const endLine = Math.min(startLine + CHUNK_SIZE, editor.document.lineCount);
            const range = new vscode.Range(startLine, 0, endLine, 0);
            const chunkText = editor.document.getText(range);
            const chunkOffset = editor.document.offsetAt(new vscode.Position(startLine, 0));

            for (const { filter, groupId } of filtersToRun) {
                this.processFilter(editor, chunkText, filter, groupId, defaultColor, rangesByDeco, matchCounts, chunkOffset);
            }

            // Yield to UI thread if needed
            if (Date.now() - lastYield > YIELD_INTERVAL) {
                await new Promise(resolve => setTimeout(resolve, 0));
                lastYield = Date.now();
            }
        }

        this.applyDecorations(editor, rangesByDeco);

        const elapsed = Date.now() - startTime;
        this.logger.info(`Highlighting finished (Chunked, ${elapsed}ms)`);
        return matchCounts;
    }

    private processFilter(
        editor: vscode.TextEditor,
        text: string,
        filter: FilterItem,
        groupId: string,
        defaultColor: any,
        rangesByDeco: Map<string, vscode.Range[]>,
        matchCounts: Map<string, number>,
        offset: number
    ) {
        if (!filter.keyword) {
            return;
        }

        const isExclude = filter.type === 'exclude';
        const decoRequests: { color: any, isFullLine: boolean, textDecoration?: string, fontWeight?: string, useLineRange: boolean, textColor?: string }[] = [];

        if (isExclude) {
            const style = filter.excludeStyle || 'line-through';
            if (style === 'hidden') {
                decoRequests.push({
                    color: undefined,
                    isFullLine: true,
                    textDecoration: undefined,
                    fontWeight: undefined,
                    useLineRange: true,
                    textColor: 'transparent'
                });
            } else {
                decoRequests.push({
                    color: undefined,
                    isFullLine: true,
                    textDecoration: 'line-through',
                    fontWeight: undefined,
                    useLineRange: true
                });
                decoRequests.push({
                    color: undefined,
                    isFullLine: false,
                    textDecoration: undefined,
                    fontWeight: 'bold',
                    useLineRange: false
                });
            }
        } else {
            const mode = filter.highlightMode ?? 0;
            decoRequests.push({
                color: filter.color || defaultColor,
                isFullLine: mode === 2,
                textDecoration: undefined,
                fontWeight: 'bold',
                useLineRange: (mode === 1 || mode === 2)
            });
        }

        const decoContexts = decoRequests.map(req => {
            const key = this.getDecorationKey(req.color, req.isFullLine, req.textDecoration, req.fontWeight, req.textColor);
            if (!rangesByDeco.has(key)) {
                rangesByDeco.set(key, []);
            }
            const info = this.getDecorationInfo(req.color, req.isFullLine, req.textDecoration, req.fontWeight, req.textColor);
            return { key, useLineRange: req.useLineRange };
        });

        try {
            const regex = RegexUtils.create(filter.keyword, !!filter.isRegex, !!filter.caseSensitive);
            let count = 0;
            let match;

            while ((match = regex.exec(text))) {
                count++;
                const startIndex = match.index;
                const absStartIndex = offset + startIndex;

                let startPos: vscode.Position | undefined;

                decoContexts.forEach(ctx => {
                    if (!startPos) {
                        startPos = editor.document.positionAt(absStartIndex);
                    }

                    if (ctx.useLineRange) {
                        rangesByDeco.get(ctx.key)!.push(editor.document.lineAt(startPos.line).range);
                    } else {
                        const endIndex = startIndex + match![0].length;
                        const absEndIndex = offset + endIndex;
                        const endPos = editor.document.positionAt(absEndIndex);
                        rangesByDeco.get(ctx.key)!.push(new vscode.Range(startPos, endPos));
                    }
                });
            }

            // Accumulate counts (important for chunked processing)
            const currentCount = matchCounts.get(filter.id) || 0;
            matchCounts.set(filter.id, currentCount + count);

        } catch (e) {
            this.logger.warn(`Failed to apply filter '${filter.keyword}': ${e}`);

            // Only show error message once per session/filter to avoid spam, or finding a better way.
            // But original code showed it. To match original behavior (which was "show error"), I'll keep it.
            // But with chunked processing, this might spam if it fails every chunk?
            // Actually RegexUtils.create caches result. usage is same.
            // If it throws, it throws.
            // Logic to show error message (debounce needed?)
            // I'll keep it simple for now as requested.

            if (filter.isRegex) {
                // Optimization: Avoid showing message repeatedly?
                // VS Code suppresses duplicate notifications usually.
                vscode.window.showErrorMessage(
                    Constants.Messages.Error.InvalidFilterPattern.replace('{0}', filter.keyword),
                    'Edit Filter',
                    'Disable Filter'
                ).then(selection => {
                    if (selection === 'Edit Filter') {
                        vscode.commands.executeCommand('logmagnifier.editFilter', filter);
                    } else if (selection === 'Disable Filter') {
                        this.filterManager.toggleFilter(groupId, filter.id);
                    }
                });
            }
        }
    }

    private applyDecorations(editor: vscode.TextEditor, rangesByDeco: Map<string, vscode.Range[]>) {
        rangesByDeco.forEach((ranges, key) => {
            const decoInfo = this.decorationTypes.get(key);
            if (!decoInfo) {
                return;
            }

            // Deduplicate ranges to improve rendering performance
            let uniqueRanges: vscode.Range[] = [];
            if (decoInfo.config.isFullLine) {
                const lines = new Set<number>();
                uniqueRanges = ranges.filter(r => {
                    if (lines.has(r.start.line)) {
                        return false;
                    }
                    lines.add(r.start.line);
                    return true;
                });
            } else {
                const seen = new Set<string>();
                uniqueRanges = ranges.filter(r => {
                    const rkey = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
                    if (seen.has(rkey)) {
                        return false;
                    }
                    seen.add(rkey);
                    return true;
                });
            }
            editor.setDecorations(decoInfo.decoration, uniqueRanges);
        });
    }

    private getEffectiveLineColor(text: string): string | undefined {
        const activeGroups = this.filterManager.getGroups().filter(g => g.isEnabled);
        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const enableRegexHighlight = config.get<boolean>(Constants.Configuration.Regex.EnableHighlight) || false;
        const defaultColor = config.get<string | { light: string, dark: string }>(Constants.Configuration.Regex.HighlightColor) || Constants.Configuration.Regex.DefaultHighlightColor;

        // Check all filters to find a match
        for (const group of activeGroups) {
            for (const filter of group.filters) {
                if (!filter.isEnabled || !filter.keyword) {
                    continue;
                }
                if (filter.isRegex && !enableRegexHighlight) {
                    continue;
                }

                try {
                    const regex = RegexUtils.create(filter.keyword, !!filter.isRegex, !!filter.caseSensitive);
                    if (regex.test(text)) {
                        return filter.color || (typeof defaultColor === 'string' ? defaultColor : undefined);
                    }
                } catch (e) { }
            }
        }
        return undefined;
    }

    public flashLine(editor: vscode.TextEditor, line: number, forceColor?: string | { light: string, dark: string }) {
        if (!editor || line < 0) {
            return;
        }

        // Cancel previous animation if active
        if (this.activeFlashTimeout) {
            clearTimeout(this.activeFlashTimeout);
            this.activeFlashTimeout = undefined;
        }
        if (this.activeFlashDecoration) {
            this.activeFlashDecoration.dispose();
            this.activeFlashDecoration = undefined;
        }

        const range = editor.document.lineAt(line).range;
        const lineText = editor.document.lineAt(line).text;

        // Resolve Color
        let colorToUse = forceColor;
        if (!colorToUse) {
            colorToUse = this.getEffectiveLineColor(lineText);
        }

        let decorationOptions: vscode.DecorationRenderOptions = {
            isWholeLine: true,
            fontWeight: 'bold'
        };

        if (colorToUse) {
            if (typeof colorToUse === 'string') {
                const preset = this.filterManager.getPresetById(colorToUse);
                if (preset) {
                    decorationOptions.light = { backgroundColor: preset.light };
                    decorationOptions.dark = { backgroundColor: preset.dark };
                } else {
                    decorationOptions.backgroundColor = colorToUse;
                }
            } else {
                // It is already { light, dark } object
                decorationOptions.light = { backgroundColor: colorToUse.light };
                decorationOptions.dark = { backgroundColor: colorToUse.dark };
            }
        } else {
            // Default match highlight
            const defaultColor = new vscode.ThemeColor('editor.findMatchHighlightBackground');
            decorationOptions.backgroundColor = defaultColor;
        }

        // Step 3: Background + Bold + Border
        this.activeFlashDecoration = vscode.window.createTextEditorDecorationType(decorationOptions);

        editor.setDecorations(this.activeFlashDecoration, [range]);

        this.activeFlashTimeout = setTimeout(() => {
            if (this.activeFlashDecoration) {
                this.activeFlashDecoration.dispose();
                this.activeFlashDecoration = undefined;
            }
            this.activeFlashTimeout = undefined;
        }, 500);
    }

    public dispose() {
        this.decorationTypes.forEach(val => val.decoration.dispose());
        this.decorationTypes.clear();
    }
}
