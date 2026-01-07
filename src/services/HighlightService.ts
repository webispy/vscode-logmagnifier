import * as vscode from 'vscode';
import { Constants } from '../constants';

import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';
import { Logger } from './Logger';
import { RegexUtils } from '../utils/RegexUtils';

export class HighlightService {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, { decoration: vscode.TextEditorDecorationType, config: any }> = new Map();

    constructor(
        private filterManager: FilterManager,
        private logger: Logger
    ) { }

    private getDecorationKey(colorNameOrValue: string | { light: string, dark: string } | undefined, isFullLine: boolean, textDecoration?: string, fontWeight?: string): string {
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

        return `${colorKey}_${isFullLine}_${textDecoration || ''}_${fontWeight || 'auto'}`;
    }

    private getDecorationInfo(colorNameOrValue: string | { light: string, dark: string } | undefined, isFullLine: boolean = false, textDecoration?: string, fontWeight?: string): { decoration: vscode.TextEditorDecorationType, config: any } {
        const key = this.getDecorationKey(colorNameOrValue, isFullLine, textDecoration, fontWeight);

        if (!this.decorationTypes.has(key)) {
            let decorationOptions: vscode.DecorationRenderOptions;

            const config = { colorNameOrValue, isFullLine, textDecoration, fontWeight };

            if (typeof colorNameOrValue === 'string') {
                const preset = this.filterManager.getPresetById(colorNameOrValue);
                if (preset) {
                    decorationOptions = {
                        light: { backgroundColor: preset.light },
                        dark: { backgroundColor: preset.dark },
                        fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration
                    };
                } else {
                    decorationOptions = {
                        backgroundColor: colorNameOrValue,
                        fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration
                    };
                }
            } else if (colorNameOrValue) {
                decorationOptions = {
                    light: { backgroundColor: colorNameOrValue.light },
                    dark: { backgroundColor: colorNameOrValue.dark },
                    fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration
                };
            } else {
                decorationOptions = {
                    fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration,
                    opacity: '0.6'
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
            const decoRequests: { color: any, isFullLine: boolean, textDecoration?: string, fontWeight?: string, useLineRange: boolean }[] = [];

            if (isExclude) {
                decoRequests.push({
                    color: undefined,
                    isFullLine: true,
                    textDecoration: 'line-through',
                    fontWeight: undefined,
                    useLineRange: true
                });
                decoRequests.push({
                    color: filter.color,
                    isFullLine: false,
                    textDecoration: undefined,
                    fontWeight: 'bold',
                    useLineRange: false
                });
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
                const key = this.getDecorationKey(req.color, req.isFullLine, req.textDecoration, req.fontWeight);
                if (!rangesByDeco.has(key)) {
                    rangesByDeco.set(key, []);
                }
                const info = this.getDecorationInfo(req.color, req.isFullLine, req.textDecoration, req.fontWeight);
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
            } catch (e) { /* ignore */ }
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

    public dispose() {
        this.decorationTypes.forEach(val => val.decoration.dispose());
        this.decorationTypes.clear();
    }
}
