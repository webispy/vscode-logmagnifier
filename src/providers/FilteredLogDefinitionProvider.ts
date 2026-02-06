import * as vscode from 'vscode';
import { SourceMapService } from '../services/SourceMapService';

export class FilteredLogDefinitionProvider implements vscode.DefinitionProvider {
    // Cache the last result to avoid redundant calculations when moving mouse along the same line
    private lastResult: {
        uri: string;
        version: number;
        line: number;
        result: vscode.DefinitionLink[] | undefined;
    } | undefined;

    constructor(private sourceMapService: SourceMapService) { }

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {

        // Check cache first
        if (this.lastResult &&
            this.lastResult.uri === document.uri.toString() &&
            this.lastResult.version === document.version &&
            this.lastResult.line === position.line) {

            // Optimization: Do NOT refresh timestamp on every mouse move.
            // The 10s window in SourceMapService is sufficient for the user to click after hovering.
            return this.lastResult.result;
        }

        // Check if there's a mapping for this document
        if (!this.sourceMapService.hasMapping(document.uri)) {
            return undefined;
        }

        let result: vscode.DefinitionLink[] | undefined;

        // Retrieve original location
        const location = this.sourceMapService.getOriginalLocation(document.uri, position.line);
        if (location) {
            // Set pending navigation so the destination editor knows to flash the line
            this.sourceMapService.setPendingNavigation(location.uri, location.range.start.line);

            // Return a DefinitionLink to allow customizing the origin selection range
            // enabling the entire line to be a clickable link
            const lineRange = document.lineAt(position.line).range;

            result = [{
                originSelectionRange: lineRange,
                targetUri: location.uri,
                targetRange: location.range,
                targetSelectionRange: location.range
            }];
        }

        // Update cache (cache both hits and misses)
        this.lastResult = {
            uri: document.uri.toString(),
            version: document.version,
            line: position.line,
            result: result
        };

        return result;
    }
}
