import * as vscode from 'vscode';

import { Logger } from '../services/Logger';
import { RegexUtils } from '../utils/RegexUtils';

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

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SearchLogInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { pattern, isRegex, caseSensitive, maxResults, contextLines } = options.input;
        const parts: string[] = [];
        parts.push(isRegex ? `regex /${pattern}/` : `"${pattern}"`);
        if (caseSensitive) { parts.push('case-sensitive'); }
        if (typeof maxResults === 'number') { parts.push(`max ${maxResults}`); }
        if (typeof contextLines === 'number' && contextLines > 0) { parts.push(`±${contextLines} ctx`); }
        return {
            invocationMessage: `Searching logs: ${parts.join(', ')}`,
        };
    }

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

        const regex = RegexUtils.create(pattern, isRegex ?? false, caseSensitive ?? false);

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
}
