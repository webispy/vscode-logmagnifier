import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterItem, HighlightMode } from '../models/Filter';
import { GapInfo } from '../models/Timestamp';

import { FilterManager } from './FilterManager';
import { Logger } from './Logger';
import { IconUtils } from '../utils/IconUtils';
import { RegexUtils } from '../utils/RegexUtils';

export type HighlightColor = string | { light: string; dark: string };

export interface DecorationConfig {
    colorNameOrValue: HighlightColor | undefined;
    isFullLine: boolean;
    textDecoration?: string;
    fontWeight?: string;
    textColor?: string;
}

export class HighlightService implements vscode.Disposable {
    private static readonly maxDecorationCache = Constants.Defaults.DecorationCacheSize;

    private documentFilters: Map<string, { filter: FilterItem, groupId: string }[]> = new Map();
    private decorationTypes: Map<string, { decoration: vscode.TextEditorDecorationType, config: DecorationConfig }> = new Map();
    private activeFlashDecoration: vscode.TextEditorDecorationType | undefined;
    private activeFlashTimeout: NodeJS.Timeout | undefined;
    private gapDecorationType: vscode.TextEditorDecorationType | undefined;
    private shownErrorFilterIds: Set<string> = new Set();
    private cachedEnableRegexHighlight: boolean = false;
    private cachedDefaultColor: HighlightColor = Constants.Configuration.Regex.DefaultHighlightColor;

    constructor(
        private readonly filterManager: FilterManager,
        private readonly logger: Logger
    ) {
        this.invalidateConfigCache();
    }

    /** Registers document-specific filters that override global filters for the given URI. */
    public registerDocumentFilters(uri: vscode.Uri, filters: { filter: FilterItem, groupId: string }[]) {
        this.documentFilters.set(uri.toString(), filters);
    }

    /** Removes document-specific filters for the given URI. */
    public unregisterDocumentFilters(uri: vscode.Uri) {
        this.documentFilters.delete(uri.toString());
    }

    private getDecorationKey(colorNameOrValue: HighlightColor | undefined, isFullLine: boolean, textDecoration?: string, fontWeight?: string, textColor?: string): string {
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

    private getDecorationInfo(colorNameOrValue: HighlightColor | undefined, isFullLine: boolean = false, textDecoration?: string, fontWeight?: string, textColor?: string): { decoration: vscode.TextEditorDecorationType, config: DecorationConfig } {
        const key = this.getDecorationKey(colorNameOrValue, isFullLine, textDecoration, fontWeight, textColor);

        const existing = this.decorationTypes.get(key);
        if (existing) {
            // LRU: promote to most-recently-used by delete-and-reinsert
            this.decorationTypes.delete(key);
            this.decorationTypes.set(key, existing);
            return existing;
        } else {
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

            // Evict oldest entry if cache is full
            if (this.decorationTypes.size >= HighlightService.maxDecorationCache) {
                const oldestKey = this.decorationTypes.keys().next().value;
                if (oldestKey) {
                    this.decorationTypes.get(oldestKey)?.decoration.dispose();
                    this.decorationTypes.delete(oldestKey);
                }
            }

            const decoration = vscode.window.createTextEditorDecorationType(decorationOptions);
            const entry = { decoration, config };
            this.decorationTypes.set(key, entry);
            return entry;
        }
    }

    /** Re-reads highlight-related configuration values and updates the internal cache. */
    public invalidateConfigCache() {
        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        this.cachedEnableRegexHighlight = config.get<boolean>(Constants.Configuration.Regex.EnableHighlight) ?? false;
        this.cachedDefaultColor = config.get<string | { light: string, dark: string }>(Constants.Configuration.Regex.HighlightColor) ?? Constants.Configuration.Regex.DefaultHighlightColor;
    }

    /** Clears all active decorations from visible editors and resets the decoration cache. */
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
        this.invalidateConfigCache();
    }

    /** Applies highlight decorations to the editor based on active filters, returning per-filter match counts. */
    public async updateHighlights(editor: vscode.TextEditor, token?: vscode.CancellationToken): Promise<Map<string, number>> {
        if (!editor) {
            return new Map();
        }

        const lineCount = editor.document.lineCount;
        // Use chunked processing for large files to maintain responsiveness
        if (lineCount > Constants.Defaults.ChunkedProcessingThreshold) {
            return this.updateHighlightsChunked(editor, token);
        } else {
            return this.updateHighlightsSync(editor);
        }
    }

    private prepareHighlight(editor: vscode.TextEditor): {
        filtersToRun: { filter: FilterItem, groupId: string }[];
        rangesByDeco: Map<string, vscode.Range[]>;
        matchCounts: Map<string, number>;
    } | undefined {
        const matchCounts = new Map<string, number>();

        const docFilters = this.documentFilters.get(editor.document.uri.toString());
        const activeFilters = docFilters ?? this.filterManager.getActiveFilters();

        const filtersToRun = activeFilters.filter(item => {
            return item.filter.isRegex ? this.cachedEnableRegexHighlight : true;
        });

        if (filtersToRun.length === 0) {
            this.decorationTypes.forEach(val => editor.setDecorations(val.decoration, []));
            return undefined;
        }

        const rangesByDeco: Map<string, vscode.Range[]> = new Map();
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        return { filtersToRun, rangesByDeco, matchCounts };
    }

    private updateHighlightsSync(editor: vscode.TextEditor): Map<string, number> {
        const prepared = this.prepareHighlight(editor);
        if (!prepared) { return new Map(); }
        const { filtersToRun, rangesByDeco, matchCounts } = prepared;

        this.logger.info(`[HighlightService] Highlighting started (Sync, Items: ${filtersToRun.length})`);
        const startTime = Date.now();
        const text = editor.document.getText();

        filtersToRun.forEach(({ filter, groupId }) => {
            this.processFilter(editor, text, filter, groupId, this.cachedDefaultColor, rangesByDeco, matchCounts, 0);
        });

        this.applyDecorations(editor, rangesByDeco);

        const duration = Date.now() - startTime;
        this.logger.info(`[HighlightService] Highlighting finished (Sync, ${duration}ms)`);
        return matchCounts;
    }

    private async updateHighlightsChunked(editor: vscode.TextEditor, token?: vscode.CancellationToken): Promise<Map<string, number>> {
        const CHUNK_SIZE = 2000;
        const YIELD_INTERVAL = 50; // ms

        const prepared = this.prepareHighlight(editor);
        if (!prepared) { return new Map(); }
        const { filtersToRun, rangesByDeco, matchCounts } = prepared;

        this.logger.info(`[HighlightService] Highlighting started (Chunked, Items: ${filtersToRun.length}, Lines: ${editor.document.lineCount})`);
        const startTime = Date.now();

        let lastYield = Date.now();

        for (let startLine = 0; startLine < editor.document.lineCount; startLine += CHUNK_SIZE) {
            const endLine = Math.min(startLine + CHUNK_SIZE, editor.document.lineCount);
            const range = new vscode.Range(startLine, 0, endLine, 0);
            const chunkText = editor.document.getText(range);
            const chunkOffset = editor.document.offsetAt(new vscode.Position(startLine, 0));

            for (const { filter, groupId } of filtersToRun) {
                this.processFilter(editor, chunkText, filter, groupId, this.cachedDefaultColor, rangesByDeco, matchCounts, chunkOffset);
            }

            // Yield to UI thread if needed
            if (Date.now() - lastYield > YIELD_INTERVAL) {
                await new Promise(resolve => setTimeout(resolve, 0));
                lastYield = Date.now();
            }

            if (token?.isCancellationRequested) {
                this.logger.info('[HighlightService] Highlighting cancelled');
                return matchCounts;
            }
        }

        this.applyDecorations(editor, rangesByDeco);

        const elapsed = Date.now() - startTime;
        this.logger.info(`[HighlightService] Highlighting finished (Chunked, ${elapsed}ms)`);
        return matchCounts;
    }

    private processFilter(
        editor: vscode.TextEditor,
        text: string,
        filter: FilterItem,
        groupId: string,
        defaultColor: HighlightColor,
        rangesByDeco: Map<string, vscode.Range[]>,
        matchCounts: Map<string, number>,
        offset: number
    ) {
        if (!filter.pattern) {
            return;
        }

        const isExclude = filter.type === 'exclude';
        const decoRequests: { color: HighlightColor | undefined, isFullLine: boolean, textDecoration?: string, fontWeight?: string, useLineRange: boolean, textColor?: string }[] = [];

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
            const mode = filter.highlightMode ?? HighlightMode.Word;
            decoRequests.push({
                color: filter.color || defaultColor,
                isFullLine: mode === HighlightMode.FullLine,
                textDecoration: undefined,
                fontWeight: 'bold',
                useLineRange: (mode === HighlightMode.Line || mode === HighlightMode.FullLine)
            });
        }

        const decoContexts = decoRequests.map(req => {
            // Ensure decoration exists
            this.getDecorationInfo(req.color, req.isFullLine, req.textDecoration, req.fontWeight, req.textColor);
            const key = this.getDecorationKey(req.color, req.isFullLine, req.textDecoration, req.fontWeight, req.textColor);
            if (!rangesByDeco.has(key)) {
                rangesByDeco.set(key, []);
            }
            return { key, useLineRange: req.useLineRange };
        });

        try {
            const regex = RegexUtils.create(filter.pattern, !!filter.isRegex, !!filter.caseSensitive);
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
                        rangesByDeco.get(ctx.key)?.push(editor.document.lineAt(startPos.line).range);
                    } else {
                        const endIndex = startIndex + match![0].length;
                        const absEndIndex = offset + endIndex;
                        const endPos = editor.document.positionAt(absEndIndex);
                        rangesByDeco.get(ctx.key)?.push(new vscode.Range(startPos, endPos));
                    }
                });
            }

            // Accumulate counts (important for chunked processing)
            const currentCount = matchCounts.get(filter.id) ?? 0;
            matchCounts.set(filter.id, currentCount + count);

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`[HighlightService] Failed to apply filter '${filter.pattern}': ${msg}`);

            // Show error message once per filter to avoid spam during chunked processing
            if (filter.isRegex && !this.shownErrorFilterIds.has(filter.id)) {
                this.shownErrorFilterIds.add(filter.id);
                (async () => {
                    const selection = await vscode.window.showErrorMessage(
                        Constants.Messages.Error.InvalidFilterPattern.replace('{0}', filter.pattern),
                        'Edit Filter',
                        'Disable Filter'
                    );
                    if (selection === 'Edit Filter') {
                        vscode.commands.executeCommand('logmagnifier.editFilter', filter);
                    } else if (selection === 'Disable Filter') {
                        this.filterManager.toggleFilter(groupId, filter.id);
                    }
                })().catch(() => { /* error already logged above */ }).finally(() => {
                    this.shownErrorFilterIds.delete(filter.id);
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

        for (const group of activeGroups) {
            for (const filter of group.filters) {
                if (!filter.isEnabled || !filter.pattern) {
                    continue;
                }
                if (filter.isRegex && !this.cachedEnableRegexHighlight) {
                    continue;
                }

                try {
                    const regex = RegexUtils.create(filter.pattern, !!filter.isRegex, !!filter.caseSensitive);
                    if (regex.test(text)) {
                        return filter.color || (typeof this.cachedDefaultColor === 'string' ? this.cachedDefaultColor : undefined);
                    }
                } catch (e: unknown) {
                    this.logger.info(`[HighlightService] Invalid highlight regex: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
        return undefined;
    }

    /** Briefly highlights a line with a flash animation to draw user attention. */
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

        const decorationOptions: vscode.DecorationRenderOptions = {
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
        }, Constants.Defaults.FlashDurationMs);
    }

    /** Show gap gutter icons on the afterLine of each gap, with hover tooltips. */
    public showGapDecorations(editor: vscode.TextEditor, gaps: GapInfo[]): void {
        if (!this.gapDecorationType) {
            const svg = IconUtils.generateGapSvg('#f0a020');
            const iconUri = vscode.Uri.parse(
                `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
            );
            this.gapDecorationType = vscode.window.createTextEditorDecorationType({
                gutterIconPath: iconUri,
                gutterIconSize: 'contain',
            });
        }

        const pad = (n: number) => String(n).padStart(2, '0');
        const formatTime = (d: Date) =>
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const formatDuration = (ms: number): string => {
            if (ms < 1000) { return `${ms}ms`; }
            if (ms < 60_000) { return `${(ms / 1000).toFixed(1)}s`; }
            return `${(ms / 60_000).toFixed(1)}m`;
        };

        const decorations: vscode.DecorationOptions[] = gaps.map(gap => {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(
                `**+${formatDuration(gap.durationMs)}** &nbsp; (${formatTime(gap.beforeTime)} → ${formatTime(gap.afterTime)})`,
            );
            const lineRange = editor.document.lineAt(gap.afterLine).range;
            return {
                range: lineRange,
                hoverMessage: md,
            };
        });

        editor.setDecorations(this.gapDecorationType, decorations);
    }

    /** Clear gap gutter icons from the editor. */
    public clearGapDecorations(editor: vscode.TextEditor): void {
        if (this.gapDecorationType) {
            editor.setDecorations(this.gapDecorationType, []);
        }
    }

    public dispose() {
        if (this.activeFlashTimeout) {
            clearTimeout(this.activeFlashTimeout);
            this.activeFlashTimeout = undefined;
        }
        if (this.activeFlashDecoration) {
            this.activeFlashDecoration.dispose();
            this.activeFlashDecoration = undefined;
        }
        if (this.gapDecorationType) {
            this.gapDecorationType.dispose();
            this.gapDecorationType = undefined;
        }
        this.decorationTypes.forEach(val => val.decoration.dispose());
        this.decorationTypes.clear();
    }
}
