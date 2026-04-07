import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';
import { Logger } from '../services/Logger';
import { LogProcessor } from '../services/LogProcessor';
import { LineMappingService } from '../services/LineMappingService';

interface ApplyFilterInput {
    filterType?: 'word' | 'regex' | 'all';
    groupName?: string;
}

/** Applies filters to the active log file and creates a filtered document. */
export class ApplyFilterTool implements vscode.LanguageModelTool<ApplyFilterInput> {
    constructor(
        private readonly filterManager: FilterManager,
        private readonly logProcessor: LogProcessor,
        private readonly lineMappingService: LineMappingService,
        private readonly logger: Logger
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ApplyFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filterType, groupName } = options.input;
        const typeStr = filterType && filterType !== 'all' ? ` ${filterType}` : '';
        const groupStr = groupName ? ` from group "${groupName}"` : '';
        return {
            invocationMessage: `Applying${typeStr} filters${groupStr} to the active log file`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ApplyFilterInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active editor.')
            ]);
        }

        const { filterType, groupName } = options.input;
        const resolvedType = filterType === 'all' ? undefined : filterType;

        // Select groups
        let candidateGroups = this.filterManager.getGroups();

        if (groupName) {
            candidateGroups = candidateGroups.filter(g => g.name === groupName);
            if (candidateGroups.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Group "${groupName}" not found.`)
                ]);
            }
        } else {
            candidateGroups = candidateGroups.filter(g => g.isEnabled);
        }

        if (resolvedType) {
            candidateGroups = candidateGroups.filter(g =>
                resolvedType === 'word' ? !g.isRegex : g.isRegex
            );
        }

        // Keep only groups with at least one enabled filter
        const activeGroups = candidateGroups.filter(g =>
            g.filters.some(f => f.isEnabled)
        );

        if (activeGroups.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No active filter groups to apply.')
            ]);
        }

        try {
            const doc = editor.document;
            const targetPath = doc.uri.fsPath;

            const result = await this.logProcessor.processFile(targetPath, activeGroups, {
                prependLineNumbers: false,
                totalLineCount: doc.lineCount,
                content: doc.getText(),
            });

            // Register line mapping for navigation
            if (result.lineMapping) {
                const outputUri = vscode.Uri.file(result.outputPath);
                this.lineMappingService.register(outputUri, doc.uri, result.lineMapping);
            }

            // Open filtered document
            if (result.matched > 0) {
                const newDoc = await vscode.workspace.openTextDocument(result.outputPath);
                await vscode.window.showTextDocument(newDoc, { preview: false });
                if (newDoc.languageId !== 'log') {
                    try {
                        await vscode.languages.setTextDocumentLanguage(newDoc, 'log');
                    } catch (e: unknown) {
                        this.logger.info(`[ApplyFilterTool] Set language failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Filter applied. Processed: ${result.processed.toLocaleString()} lines. Matched: ${result.matched.toLocaleString()} lines.`
                )
            ]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[ApplyFilterTool] Failed: ${msg}`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to apply filters: ${msg}`)
            ]);
        }
    }
}
