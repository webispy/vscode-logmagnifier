import * as vscode from 'vscode';

import { FilterManager } from './FilterManager';
import { FilterItem } from '../models/Filter';
import { Logger } from './Logger';
import { RegexUtils } from '../utils/RegexUtils';

export class HighlightService {
    // Map of color string -> DecorationType
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

    constructor(
        private filterManager: FilterManager,
        private logger: Logger
    ) {
        // Initial setup if needed
    }

    private getDecorationType(colorNameOrValue: string | { light: string, dark: string } | undefined, isFullLine: boolean = false, textDecoration?: string, fontWeight?: string): vscode.TextEditorDecorationType {
        const colorKey = typeof colorNameOrValue === 'string' ? colorNameOrValue : (colorNameOrValue ? JSON.stringify(colorNameOrValue) : 'undefined');
        // Use 'auto' for key if fontWeight is undefined to distinguish from explicit values
        const key = `${colorKey}_${isFullLine}_${textDecoration || ''}_${fontWeight || 'auto'}`;

        if (!this.decorationTypes.has(key)) {
            let decorationOptions: vscode.DecorationRenderOptions;

            if (typeof colorNameOrValue === 'string') {
                const preset = this.filterManager.getPresetById(colorNameOrValue);
                if (preset) {
                    decorationOptions = {
                        light: {
                            backgroundColor: preset.light
                        },
                        dark: {
                            backgroundColor: preset.dark
                        },
                        fontWeight: fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration: textDecoration
                    };
                } else {
                    // Fallback for custom color string
                    decorationOptions = {
                        backgroundColor: colorNameOrValue,
                        fontWeight: fontWeight,
                        isWholeLine: isFullLine,
                        textDecoration: textDecoration
                    };
                }
            } else if (colorNameOrValue) {
                // Object with light/dark values
                decorationOptions = {
                    light: {
                        backgroundColor: colorNameOrValue.light
                    },
                    dark: {
                        backgroundColor: colorNameOrValue.dark
                    },
                    fontWeight: fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration: textDecoration
                };
            } else {
                // No color, just text decoration (e.g. strike-through)
                decorationOptions = {
                    fontWeight: fontWeight,
                    isWholeLine: isFullLine,
                    textDecoration: textDecoration,
                    opacity: '0.6' // Dim excluded items slightly
                };
            }

            const decoration = vscode.window.createTextEditorDecorationType(decorationOptions);
            this.decorationTypes.set(key, decoration);
        }
        return this.decorationTypes.get(key)!;
    }

    public refreshDecorationType() {
        this.dispose();
        this.decorationTypes.clear();
    }

    public updateHighlights(editor: vscode.TextEditor): Map<string, number> {
        const matchCounts = new Map<string, number>();

        if (!editor) {
            return matchCounts;
        }

        const activeGroups = this.filterManager.getGroups().filter(g => g.isEnabled);
        const activeFilters: FilterItem[] = [];

        const enableRegexHighlight = vscode.workspace.getConfiguration('logmagnifier').get<boolean>('enableRegexHighlight') || false;

        activeGroups.forEach(g => {
            g.filters.forEach(f => {
                if (f.isEnabled) {
                    if (f.isRegex && !enableRegexHighlight) {
                        return;
                    }
                    activeFilters.push(f);
                }
            });
        });

        if (activeFilters.length === 0) {
            this.decorationTypes.forEach(dt => editor.setDecorations(dt, []));
            return matchCounts;
        }

        this.logger.info(`Highlighting started (Items: ${activeFilters.length})`);
        const startTime = Date.now();

        const text = editor.document.getText();

        // Group ranges by decoration type key (color + fullLine + textDecoration + fontWeight)
        const rangesByDeco: Map<string, vscode.Range[]> = new Map();

        // Initialize ranges for all currently known decoration types to empty to clear old highlights
        this.decorationTypes.forEach((_, key) => rangesByDeco.set(key, []));

        // Default highlight color from config if filter has no specific color (backward compatibility)
        const defaultColor = vscode.workspace.getConfiguration('logmagnifier').get<string | { light: string, dark: string }>('regexHighlightColor') || 'rgba(255, 255, 0, 0.3)';

        activeFilters.forEach(filter => {
            if (!filter.keyword) {
                return;
            }

            const isExclude = filter.type === 'exclude';

            // Define decorators logic
            // Exclude: 
            // 1. Line strike-through (no color, bold=undefined (inherit), full decoration)
            // 2. Word highlight (color (if set), bold weight, word range)

            // Include:
            // 1. Highlight (color, bold, word/line/full based on mode)

            let decoConfigs: { color: string | { light: string, dark: string } | undefined, isFullLine: boolean, textDecoration?: string, fontWeight?: string, useLineRange: boolean }[] = [];

            if (isExclude) {
                // Config 1: Strike-through Line
                decoConfigs.push({
                    color: undefined,
                    isFullLine: true,
                    textDecoration: 'line-through',
                    fontWeight: undefined, // Inherit (don't force normal, allowing word bold to show)
                    useLineRange: true // Strike through the whole line
                });

                // Config 2: Bold Word (with color if set)
                // Note: We always bold the word for exclude items as per request, regardless of color presence
                decoConfigs.push({
                    color: filter.color,
                    isFullLine: false,
                    textDecoration: undefined,
                    fontWeight: 'bold',     // Bold the word
                    useLineRange: false // Only bold the word
                });
            } else {
                // Include logic
                const mode = filter.highlightMode ?? 0;
                const isFullLine = mode === 2;
                const color = filter.color || defaultColor;

                decoConfigs.push({
                    color: color,
                    isFullLine: isFullLine,
                    textDecoration: undefined,
                    fontWeight: 'bold',
                    useLineRange: (mode === 1 || mode === 2) // Line or Full Line mode
                });
            }

            // Prepare keys
            const keys = decoConfigs.map(config => {
                const colorKey = typeof config.color === 'string' ? config.color : (config.color ? JSON.stringify(config.color) : 'undefined');
                // Use 'auto' for key if fontWeight is undefined
                const key = `${colorKey}_${config.isFullLine}_${config.textDecoration || ''}_${config.fontWeight || 'auto'}`;

                if (!rangesByDeco.has(key)) {
                    rangesByDeco.set(key, []);
                }

                // Ensure decoration exists
                this.getDecorationType(config.color, config.isFullLine, config.textDecoration, config.fontWeight);

                return { key, config };
            });

            let regex: RegExp;
            let count = 0;

            try {
                regex = RegexUtils.create(filter.keyword, !!filter.isRegex, !!filter.caseSensitive);

                let match;
                while ((match = regex.exec(text))) {
                    count++;
                    const startPos = editor.document.positionAt(match.index);
                    const endPos = editor.document.positionAt(match.index + match[0].length);

                    keys.forEach(({ key, config }) => {
                        if (config.useLineRange) {
                            const line = editor.document.lineAt(startPos.line);
                            rangesByDeco.get(key)!.push(line.range);
                        } else {
                            rangesByDeco.get(key)!.push(new vscode.Range(startPos, endPos));
                        }
                    });
                }
                matchCounts.set(filter.id, count);
            } catch (e) {
                // Ignore
            }
        });

        // Apply decorations
        rangesByDeco.forEach((ranges, decoKey) => {
            // Reconstruct keys: color_isFullLine_textDecoration_fontWeight
            const parts = decoKey.split('_');

            const fontWeightStr = parts.pop();
            const textDecoration = parts.pop() || undefined;
            const isFullLineStr = parts.pop();
            const colorStr = parts.join('_');

            let fontWeight: string | undefined = fontWeightStr;
            if (fontWeight === 'auto') {
                fontWeight = undefined;
            }

            let color: string | { light: string, dark: string } | undefined;
            if (colorStr !== 'undefined') {
                try {
                    if (colorStr.startsWith('{')) {
                        color = JSON.parse(colorStr);
                    } else {
                        color = colorStr;
                    }
                } catch (e) {
                    color = colorStr;
                }
            } else {
                color = undefined;
            }

            const isFullLine = isFullLineStr === 'true';

            // Deduplicate ranges to avoid opacity stacking
            let uniqueRanges: vscode.Range[] = [];
            if (isFullLine) {
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
                    const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            }

            const activeDecoration = textDecoration === '' ? undefined : textDecoration;
            const decorationType = this.getDecorationType(color, isFullLine, activeDecoration, fontWeight);
            editor.setDecorations(decorationType, uniqueRanges);
        });

        const duration = Date.now() - startTime;
        this.logger.info(`Highlighting finished (${duration}ms)`);

        return matchCounts;
    }

    public dispose() {
        this.decorationTypes.forEach(dt => dt.dispose());
        this.decorationTypes.clear();
    }
}
