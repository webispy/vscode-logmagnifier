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
        this.dispose();
    }

    public updateHighlights(editor: vscode.TextEditor): Map<string, number> {
        const matchCounts = new Map<string, number>();

        if (!editor) {
            return matchCounts;
        }

        const activeGroups = this.filterManager.getGroups().filter(g => g.isEnabled);
        const activeFilters: FilterItem[] = [];
        const enableRegexHighlight = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<boolean>(Constants.Configuration.Regex.EnableHighlight) || false;

        activeGroups.forEach(g => {
            g.filters.forEach(f => {
                if (f.isEnabled && (f.isRegex ? enableRegexHighlight : true)) {
                    activeFilters.push(f);
                }
            });
        });

        if (activeFilters.length === 0) {
            this.decorationTypes.forEach(val => editor.setDecorations(val.decoration, []));
            return matchCounts;
        }

        this.logger.info(`Highlighting started (Items: ${activeFilters.length})`);
        const startTime = Date.now();
        const text = editor.document.getText();
        const rangesByDeco: Map<string, vscode.Range[]> = new Map();

        // Clear existing decorations
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        const defaultColor = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string | { light: string, dark: string }>(Constants.Configuration.Regex.HighlightColor) || Constants.Configuration.Regex.DefaultHighlightColor;

        activeFilters.forEach(filter => {
            if (!filter.keyword) { return; }

            const isExclude = filter.type === 'exclude';
            const decoRequests: { color: any, isFullLine: boolean, textDecoration?: string, fontWeight?: string, useLineRange: boolean, textColor?: string }[] = [];

            if (isExclude) {
                const style = filter.excludeStyle || 'line-through';
                if (style === 'hidden') {
                    decoRequests.push({
                        color: undefined,
                        isFullLine: true, // Keep full line processing to "capture" the line
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
                return { key, useLineRange: req.useLineRange, decoration: info.decoration };
            });

            try {
                const regex = RegexUtils.create(filter.keyword, !!filter.isRegex, !!filter.caseSensitive);
                let count = 0;
                let match;
                while ((match = regex.exec(text))) {
                    count++;
                    const startPos = editor.document.positionAt(match.index);
                    const endPos = editor.document.positionAt(match.index + match[0].length);

                    decoContexts.forEach(ctx => {
                        if (ctx.useLineRange) {
                            rangesByDeco.get(ctx.key)!.push(editor.document.lineAt(startPos.line).range);
                        } else {
                            rangesByDeco.get(ctx.key)!.push(new vscode.Range(startPos, endPos));
                        }
                    });
                }
                matchCounts.set(filter.id, count);
            } catch (e) {
                this.logger.warn(`Failed to apply filter '${filter.keyword}': ${e}`);
            }
        });

        // Apply decorations
        rangesByDeco.forEach((ranges, key) => {
            const decoInfo = this.decorationTypes.get(key);
            if (!decoInfo) { return; }

            // Deduplicate
            let uniqueRanges: vscode.Range[] = [];
            if (decoInfo.config.isFullLine) {
                const lines = new Set<number>();
                uniqueRanges = ranges.filter(r => {
                    if (lines.has(r.start.line)) { return false; }
                    lines.add(r.start.line);
                    return true;
                });
            } else {
                const seen = new Set<string>();
                uniqueRanges = ranges.filter(r => {
                    const rkey = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
                    if (seen.has(rkey)) { return false; }
                    seen.add(rkey);
                    return true;
                });
            }
            editor.setDecorations(decoInfo.decoration, uniqueRanges);
        });

        const duration = Date.now() - startTime;
        this.logger.info(`Highlighting finished (${duration}ms)`);
        return matchCounts;
    }

    public flashLine(editor: vscode.TextEditor, line: number, color?: string | { light: string, dark: string }) {
        if (!editor || line < 0) { return; }

        const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
        const enableAnimation = config.get<boolean>(Constants.Configuration.Editor.NavigationAnimation) || false;

        if (!enableAnimation) { return; }

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

        // Resolve Color
        let decorationOptions: vscode.DecorationRenderOptions = {
            isWholeLine: true,
            fontWeight: 'bold'
        };

        if (color) {
            if (typeof color === 'string') {
                const preset = this.filterManager.getPresetById(color);
                if (preset) {
                    decorationOptions.light = { backgroundColor: preset.light };
                    decorationOptions.dark = { backgroundColor: preset.dark };
                } else {
                    decorationOptions.backgroundColor = color;
                }
            } else {
                // It is already { light, dark } object
                decorationOptions.light = { backgroundColor: color.light };
                decorationOptions.dark = { backgroundColor: color.dark };
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
