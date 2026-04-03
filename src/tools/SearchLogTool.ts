import * as vscode from 'vscode';

import { Logger } from '../services/Logger';

interface SearchLogInput {
    pattern: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    maxResults?: number;
    contextLines?: number;
}

/** Searches the active log file for lines matching a pattern. */
export class SearchLogTool implements vscode.LanguageModelTool<SearchLogInput> {
    constructor(private readonly logger: Logger) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SearchLogInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const { pattern, isRegex, caseSensitive, contextLines } = options.input;
        const maxResults = options.input.maxResults ?? 50;
        const ctx = contextLines ?? 0;

        let regex: RegExp;
        try {
            const flags = caseSensitive ? 'g' : 'gi';
            regex = isRegex ? new RegExp(pattern, flags) : new RegExp(this.escapeRegex(pattern), flags);
        } catch (e: unknown) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Invalid pattern: ${e instanceof Error ? e.message : String(e)}`)
            ]);
        }

        const doc = editor.document;
        const matches: { line: number; text: string; context?: string[] }[] = [];
        const matchedLines = new Set<number>();

        // Find matching lines
        for (let i = 0; i < doc.lineCount && !token.isCancellationRequested; i++) {
            const lineText = doc.lineAt(i).text;
            regex.lastIndex = 0;
            if (regex.test(lineText)) {
                matchedLines.add(i);
                if (matchedLines.size > maxResults) {
                    break;
                }
            }
        }

        // Build results with context
        for (const lineNum of matchedLines) {
            const entry: { line: number; text: string; context?: string[] } = {
                line: lineNum + 1,
                text: doc.lineAt(lineNum).text,
            };

            if (ctx > 0) {
                const contextArr: string[] = [];
                const start = Math.max(0, lineNum - ctx);
                const end = Math.min(doc.lineCount - 1, lineNum + ctx);
                for (let j = start; j <= end; j++) {
                    if (j !== lineNum) {
                        contextArr.push(`${j + 1}: ${doc.lineAt(j).text}`);
                    }
                }
                entry.context = contextArr;
            }

            matches.push(entry);
        }

        const totalMatches = matchedLines.size;
        const truncated = totalMatches > maxResults;

        const result = {
            totalMatches: truncated ? `${maxResults}+ (truncated)` : totalMatches,
            pattern,
            isRegex: isRegex ?? false,
            matches: matches.slice(0, maxResults),
        };

        this.logger.info(`[SearchLogTool] Found ${totalMatches} matches for "${pattern}"`);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
        ]);
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
