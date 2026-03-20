import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem, HighlightMode } from '../models/Filter';

import { Logger } from './Logger';

export class FilterStateService {
    constructor(private context: vscode.ExtensionContext, private logger: Logger) { }

    /** Persists filter groups to VS Code global state. */
    public saveToState(groups: FilterGroup[]) {
        this.context.globalState.update(Constants.GlobalState.FilterGroups, groups);
    }

    /** Loads filter groups from global state, applying any necessary schema migrations. */
    public loadFromState(): FilterGroup[] {
        const saved = this.context.globalState.get<FilterGroup[]>(Constants.GlobalState.FilterGroups);
        if (saved) {
            // Apply migrations if needed on load
            saved.forEach(g => {
                g.filters.forEach(f => this.ensureFilterMigration(f));
            });
            return saved;
        }
        return [];
    }

    /** Creates a deep copy of the given object using structuredClone with a JSON fallback. */
    public deepCopy<T>(obj: T): T {
        try {
            return structuredClone(obj);
        } catch (e: unknown) {
            this.logger.warn(`[FilterStateService] structuredClone failed, falling back to JSON: ${e instanceof Error ? e.message : String(e)}`);
            return JSON.parse(JSON.stringify(obj));
        }
    }

    private ensureFilterMigration(filter: FilterItem): void {
        if (filter.highlightMode === undefined) {
            interface LegacyFilterItem {
                enableFullLineHighlight?: boolean;
            }
            const legacy = filter as unknown as LegacyFilterItem;
            filter.highlightMode = legacy.enableFullLineHighlight ? HighlightMode.Line : HighlightMode.Word;
            delete legacy.enableFullLineHighlight;
        }
    }
}
