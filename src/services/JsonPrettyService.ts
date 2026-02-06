import * as vscode from 'vscode';
import { Logger } from './Logger';
import { SourceMapService } from './SourceMapService';
import { Constants } from '../constants';
import { HighlightService } from './HighlightService';
import { JsonTreeWebview } from '../views/JsonTreeWebview';
import { LenientJsonParser } from './LenientJsonParser';
import { EditorUtils } from '../utils/EditorUtils';

interface ExtractedJson {
    type: 'valid' | 'invalid' | 'incomplete';
    text: string;
    parsed?: any;
    error?: string;
}

export class JsonPrettyService implements vscode.Disposable {
    private _lastActiveEditor: vscode.TextEditor | undefined;
    private _disposables: vscode.Disposable[] = [];

    constructor(
        private logger: Logger,
        private sourceMapService: SourceMapService,
        private jsonTreeWebview: JsonTreeWebview,
        private highlightService: HighlightService
    ) {
        // Track active editor
        this._disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this._lastActiveEditor = editor;
            }
        }));

        // Initialize with current if available
        if (vscode.window.activeTextEditor) {
            this._lastActiveEditor = vscode.window.activeTextEditor;
        }

        this._disposables.push(this.jsonTreeWebview.onDidRevealLine(async event => {
            try {
                const targetUriStr = event.uri;
                let targetViewColumn: vscode.ViewColumn | undefined;

                // Search for the tab in all groups
                const tabGroups = vscode.window.tabGroups.all;

                for (const group of tabGroups) {
                    // Check active tab first (optimization & user preference)
                    if (group.activeTab && group.activeTab.input instanceof vscode.TabInputText) {
                        if (group.activeTab.input.uri.toString() === targetUriStr) {
                            targetViewColumn = group.viewColumn;
                            break;
                        }
                    }

                    // Check other tabs in the group
                    const matchingTab = group.tabs.find(tab => {
                        return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === targetUriStr;
                    });

                    if (matchingTab) {
                        targetViewColumn = group.viewColumn;
                        break;
                    }
                }

                if (targetViewColumn !== undefined) {
                    // Document is open in a tab. Reveal it in that column.
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(targetUriStr));
                    const editor = await vscode.window.showTextDocument(doc, {
                        selection: new vscode.Range(event.line, 0, event.line, 0),
                        preview: true,
                        viewColumn: targetViewColumn
                    });
                    // Flash the line
                    this.highlightService.flashLine(editor, event.line);
                } else {
                    vscode.window.showWarningMessage(Constants.Messages.Warn.OriginalFileClosed);
                }
            } catch (e) {
                this.logger.error('Failed to reveal line: ' + e);
            }
        }));
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    public async execute(silent: boolean = false, targetEditor?: vscode.TextEditor) {
        try {
            let editor = targetEditor || vscode.window.activeTextEditor;

            if (!silent && !editor) {
                editor = EditorUtils.getActiveEditor(this._lastActiveEditor, 'open JSON Preview');

                if (!editor) {
                    return;
                }
            }

            if (!editor) {
                return;
            }

            const selection = editor.selection;
            let text = '';

            if (!selection.isEmpty) {
                text = editor.document.getText(selection);

                // Fallback to full line check if selection (e.g. from Find Widget) is not JSON
                if (silent && !text.includes('{') && !text.includes('[')) {
                    text = editor.document.lineAt(selection.active.line).text;
                }
            } else {
                text = editor.document.lineAt(selection.active.line).text;
            }

            if (!text || text.trim().length === 0) {
                if (!silent) {
                    vscode.window.showInformationMessage(Constants.Messages.Info.NoTextToProcess);
                }

                if (silent) {
                    this.clearWebview(editor);
                }
                return;
            }

            // Check for line limit
            const config = vscode.workspace.getConfiguration(Constants.Configuration.Section);
            const maxLines = config.get<number>(Constants.Configuration.JsonPreviewMaxLines, 10);
            const selectionLineCount = selection.end.line - selection.start.line + 1;

            if (selectionLineCount > maxLines) {
                const limitedRange = new vscode.Range(selection.start.line, 0, selection.start.line + maxLines, 0);
                text = editor.document.getText(limitedRange);

                // Show warning
                vscode.window.showWarningMessage(Constants.Messages.Warn.JsonPreviewLimited.replace('{0}', maxLines.toString()));
            }

            const jsons = this.extractJsons(text);

            if (jsons.length === 0) {
                if (!silent) {
                    vscode.window.showInformationMessage(Constants.Messages.Info.NoJsonFound);
                }

                // Clear the webview to reflect the current state (avoid showing stale data)
                this.clearWebview(editor);
                return;
            }

            // Update Tree View (Webview)
            // Prioritize valid JSONs, but fallback to lenient parsing for invalid ones
            // JSON Webview is now always enabled for this command
            // Process all extracted JSONs for the Webview
            const results = jsons.map(json => {
                if (json.type === 'valid') {
                    return {
                        data: LenientJsonParser.toParsedNode(json.parsed),
                        status: 'valid' as const,
                        text: JSON.stringify(json.parsed, null, 2),
                        raw: json.parsed // Pass raw object for correct re-stringification
                    };
                } else {
                    const parser = new LenientJsonParser();
                    return {
                        data: parser.parse(json.text),
                        status: 'invalid' as const,
                        text: this.bestEffortFormat(json.text)
                    };
                }
            });

            if (results.length > 0) {
                // Pass array of results. We update the signature of show later.
                // TypeScript might complain until we update the interface.
                const options = editor.options;
                const tabSize = typeof options.tabSize === 'number' ? options.tabSize : 2;

                // Extract source info
                const sourceUri = editor.document.uri.toString();
                // If selection is single line, use that.
                // However, logProcessor extracted based on selection.active.line usually, or current line.
                // Since this command uses active selection:
                const sourceLine = selection.active.line;

                this.jsonTreeWebview.show(results, 'JSON Preview', 'valid', tabSize, sourceUri, sourceLine, silent);
            }

        } catch (error) {
            this.logger.error(`JsonPrettyService error: ${error}`);
            if (!silent) {
                vscode.window.showErrorMessage(Constants.Messages.Error.JsonProcessError);
            }
        }
    }

    private extractJsons(text: string): ExtractedJson[] {
        const found: ExtractedJson[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            // Find both object start '{' and array start '['
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

            if (inString) {
                if (escape) {
                    escape = false;
                    continue;
                }
                if (char === '\\') {
                    escape = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                    continue;
                }
            } else {
                if (char === '"') {
                    inString = true;
                    continue;
                }

                if (char === '{' || char === '[') {
                    braceCount++;
                } else if (char === '}' || char === ']') {
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

    private clearWebview(editor: vscode.TextEditor) {
        const sourceUri = editor.document.uri.toString();
        const sourceLine = editor.selection.active.line;
        const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 2;

        this.jsonTreeWebview.show(
            [{ status: 'no-json', data: {}, text: '' }],
            'JSON Preview',
            'no-json',
            tabSize,
            sourceUri,
            sourceLine,
            true
        );
    }
}
