import * as vscode from 'vscode';

interface ExtractJsonInput {
    line?: number;
    startLine?: number;
    endLine?: number;
}

/** Extracts and parses JSON objects from log lines. */
export class ExtractJsonTool implements vscode.LanguageModelTool<ExtractJsonInput> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ExtractJsonInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const doc = editor.document;
        const { line, startLine, endLine } = options.input;

        let text: string;
        if (line !== undefined) {
            const zeroLine = line - 1;
            if (zeroLine < 0 || zeroLine >= doc.lineCount) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Line ${line} is out of range (1-${doc.lineCount}).`)
                ]);
            }
            text = doc.lineAt(zeroLine).text;
        } else if (startLine !== undefined && endLine !== undefined) {
            const start = Math.max(0, startLine - 1);
            const end = Math.min(doc.lineCount - 1, endLine - 1);
            const lines: string[] = [];
            for (let i = start; i <= end; i++) {
                lines.push(doc.lineAt(i).text);
            }
            text = lines.join('\n');
        } else {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Specify either "line" or both "startLine" and "endLine".')
            ]);
        }

        const jsons = this.extractJsons(text);

        if (jsons.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No JSON objects found in the specified line(s).')
            ]);
        }

        const results = jsons.map((j, idx) => {
            if (j.parsed !== undefined) {
                return `--- JSON ${idx + 1} ---\n${JSON.stringify(j.parsed, null, 2)}`;
            }
            return `--- JSON ${idx + 1} (parse error) ---\n${j.text}`;
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(results.join('\n\n'))
        ]);
    }

    /** Extracts JSON objects/arrays from text. Replicates JsonPrettyService logic. */
    private extractJsons(text: string): { text: string; parsed?: unknown }[] {
        const found: { text: string; parsed?: unknown }[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            const firstOpenObj = text.indexOf('{', startIndex);
            const firstOpenArr = text.indexOf('[', startIndex);

            let firstOpen = -1;
            if (firstOpenObj !== -1 && firstOpenArr !== -1) {
                firstOpen = Math.min(firstOpenObj, firstOpenArr);
            } else if (firstOpenObj !== -1) {
                firstOpen = firstOpenObj;
            } else {
                firstOpen = firstOpenArr;
            }

            if (firstOpen === -1) {
                break;
            }

            const bounded = this.findBoundedJson(text, firstOpen);
            if (bounded) {
                if (bounded.complete) {
                    try {
                        const parsed = JSON.parse(bounded.text);
                        found.push({ text: bounded.text, parsed });
                    } catch {
                        found.push({ text: bounded.text });
                    }
                }
                startIndex = bounded.endIndex + 1;
            } else {
                startIndex = firstOpen + 1;
            }
        }

        return found;
    }

    private findBoundedJson(text: string, start: number): { text: string; endIndex: number; complete: boolean } | null {
        let idx = start;
        let braceCount = 0;
        let inString = false;
        let escape = false;

        for (; idx < text.length; idx++) {
            const char = text[idx];

            if (inString) {
                if (escape) { escape = false; continue; }
                if (char === '\\') { escape = true; continue; }
                if (char === '"') { inString = false; }
                continue;
            }

            if (char === '"') { inString = true; continue; }
            if (char === '{' || char === '[') { braceCount++; }
            if (char === '}' || char === ']') {
                braceCount--;
                if (braceCount === 0) {
                    return {
                        text: text.substring(start, idx + 1),
                        endIndex: idx,
                        complete: true,
                    };
                }
            }
        }

        if (braceCount > 0) {
            return {
                text: text.substring(start),
                endIndex: text.length - 1,
                complete: false,
            };
        }

        return null;
    }
}
