import * as vscode from 'vscode';
import { Logger } from './Logger';
import { SourceMapService } from './SourceMapService';

interface ExtractedJson {
    type: 'valid' | 'invalid' | 'incomplete';
    text: string;
    parsed?: any;
    error?: string;
}

export class JsonPrettyService {
    constructor(private logger: Logger, private sourceMapService: SourceMapService) { }

    public async execute() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const selection = editor.selection;
            let text = '';

            if (!selection.isEmpty) {
                text = editor.document.getText(selection);
            } else {
                text = editor.document.lineAt(selection.active.line).text;
            }

            if (!text || text.trim().length === 0) {
                vscode.window.showInformationMessage('LogMagnifier: No text to process.');
                return;
            }

            const jsons = this.extractJsons(text);
            if (jsons.length === 0) {
                vscode.window.showInformationMessage('LogMagnifier: No JSON-like content found in the selection.');
                return;
            }

            const formattedContent = this.formatOutput(text, jsons);
            const doc = await vscode.workspace.openTextDocument({
                content: formattedContent,
                language: 'jsonc'
            });
            await vscode.window.showTextDocument(doc);

            // Register Source Mapping for navigation
            const lineCount = doc.lineCount;
            const sourceLine = selection.active.line;
            const lineMapping = new Array(lineCount).fill(sourceLine);

            // We need to use the uri of the newly created document. 
            // Note: Untitled documents have a specific URI scheme.
            this.sourceMapService.register(doc.uri, editor.document.uri, lineMapping);
            this.sourceMapService.updateContextKey(vscode.window.activeTextEditor);

            this.logger.info(`JsonPrettyService: Processed ${jsons.length} objects.`);

        } catch (error) {
            this.logger.error(`JsonPrettyService error: ${error}`);
            vscode.window.showErrorMessage('LogMagnifier: Error processing JSON.');
        }
    }

    private extractJsons(text: string): ExtractedJson[] {
        const found: ExtractedJson[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            const firstOpen = text.indexOf('{', startIndex);
            if (firstOpen === -1) {
                break;
            }

            const jsonCandidate = this.findBoundedJson(text, firstOpen);
            if (jsonCandidate) {
                if (!jsonCandidate.complete) {
                    // Incomplete case
                    found.push({
                        type: 'incomplete',
                        text: jsonCandidate.text
                    });
                    // Move past this block
                    startIndex = jsonCandidate.endIndex + 1;
                } else {
                    // Potential complete block
                    try {
                        const parsed = JSON.parse(jsonCandidate.text);
                        found.push({
                            type: 'valid',
                            text: jsonCandidate.text,
                            parsed: parsed
                        });
                        startIndex = jsonCandidate.endIndex + 1;
                    } catch (e) {
                        // Invalid syntax case (but bounded)
                        found.push({
                            type: 'invalid',
                            text: jsonCandidate.text,
                            error: String(e)
                        });
                        startIndex = jsonCandidate.endIndex + 1;
                    }
                }
            } else {
                // Should not happen with new logic, but safe fallback
                startIndex = firstOpen + 1;
            }
        }
        return found;
    }

    private findBoundedJson(text: string, start: number): { text: string, endIndex: number, complete: boolean } | null {
        let textIndex = start;
        let braceCount = 0;
        let inString = false;
        let escape = false;

        for (; textIndex < text.length; textIndex++) {
            const char = text[textIndex];

            if (escape) {
                escape = false;
                continue;
            }

            if (char === '\\') {
                escape = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        return { text: text.substring(start, textIndex + 1), endIndex: textIndex, complete: true };
                    }
                }
            }
        }

        // If we reach here, we have an incomplete JSON (braceCount > 0)
        if (braceCount > 0) {
            return { text: text.substring(start), endIndex: text.length, complete: false };
        }

        return null;
    }

    private formatOutput(original: string, jsons: ExtractedJson[]): string {
        let output = original.trimRight() + '\n\n\n';

        for (const item of jsons) {
            if (item.type === 'valid') {
                output += JSON.stringify(item.parsed, null, 2) + '\n\n';
            } else if (item.type === 'invalid') {
                output += '// [INVALID JSON]\n';
                output += this.bestEffortFormat(item.text) + '\n\n';
            } else if (item.type === 'incomplete') {
                output += '// [INCOMPLETE JSON]\n';
                output += this.bestEffortFormat(item.text) + '\n\n';
            }
        }
        return output;
    }

    private bestEffortFormat(text: string): string {
        let indent = 0;
        let output = '';
        let inString = false;
        let quoteChar = '';
        let escape = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (escape) {
                output += char;
                escape = false;
                continue;
            }

            if (char === '\\') {
                output += char;
                escape = true;
                continue;
            }

            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                quoteChar = char;
                output += char;
                continue;
            }

            if (char === quoteChar && inString) {
                inString = false;
                output += char;
                continue;
            }

            if (inString) {
                output += char;
                continue;
            }

            // Not in string
            if (char === '{' || char === '[') {
                indent++;
                output += char + '\n' + '  '.repeat(indent);
            } else if (char === '}' || char === ']') {
                indent = Math.max(0, indent - 1);
                output += '\n' + '  '.repeat(indent) + char;
            } else if (char === ',') {
                output += char + '\n' + '  '.repeat(indent);
            } else if (char === ':') {
                output += ': ';
            } else if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
                // Skip existing whitespace
                continue;
            } else {
                output += char;
            }
        }
        return output;
    }
}
