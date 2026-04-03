import * as vscode from 'vscode';

import { FilterManager } from '../services/FilterManager';
import { LogBookmarkService } from '../services/LogBookmarkService';
import { Logger } from '../services/Logger';
import { LogProcessor } from '../services/LogProcessor';
import { SourceMapService } from '../services/SourceMapService';
import { TimestampService } from '../services/TimestampService';
import { WorkflowManager } from '../services/WorkflowManager';
import { AddBookmarkTool } from './AddBookmarkTool';
import { AddFilterTool } from './AddFilterTool';
import { ApplyFilterTool } from './ApplyFilterTool';
import { CreateProfileTool } from './CreateProfileTool';
import { ExtractJsonTool } from './ExtractJsonTool';
import { FilterByTimeRangeTool } from './FilterByTimeRangeTool';
import { GetBookmarksTool } from './GetBookmarksTool';
import { GetFiltersTool } from './GetFiltersTool';
import { GetLogSummaryTool } from './GetLogSummaryTool';
import { ListProfilesTool } from './ListProfilesTool';
import { ListWorkflowsTool } from './ListWorkflowsTool';
import { RemoveFilterTool } from './RemoveFilterTool';
import { RunWorkflowTool } from './RunWorkflowTool';
import { SearchLogTool } from './SearchLogTool';
import { SwitchProfileTool } from './SwitchProfileTool';

/** Registers all LogMagnifier tools for the VS Code Language Model Tools API. */
export class LmToolManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(
        filterManager: FilterManager,
        logProcessor: LogProcessor,
        timestampService: TimestampService,
        sourceMapService: SourceMapService,
        workflowManager: WorkflowManager,
        bookmarkService: LogBookmarkService,
        logger: Logger
    ) {
        this.registerTools(
            filterManager, logProcessor,
            timestampService, sourceMapService,
            workflowManager, bookmarkService, logger
        );
    }

    private registerTools(
        filterManager: FilterManager,
        logProcessor: LogProcessor,
        timestampService: TimestampService,
        sourceMapService: SourceMapService,
        workflowManager: WorkflowManager,
        bookmarkService: LogBookmarkService,
        logger: Logger
    ): void {
        // Filter tools
        this.disposables.push(
            vscode.lm.registerTool('logmagnifier-getFilters', new GetFiltersTool(filterManager)),
            vscode.lm.registerTool('logmagnifier-addFilter', new AddFilterTool(filterManager)),
            vscode.lm.registerTool('logmagnifier-removeFilter', new RemoveFilterTool(filterManager)),
            vscode.lm.registerTool('logmagnifier-applyFilter', new ApplyFilterTool(
                filterManager, logProcessor, sourceMapService, logger
            )),
            vscode.lm.registerTool('logmagnifier-getLogSummary', new GetLogSummaryTool(
                filterManager, timestampService
            )),
            vscode.lm.registerTool('logmagnifier-searchLog', new SearchLogTool(logger)),
            vscode.lm.registerTool('logmagnifier-filterByTimeRange', new FilterByTimeRangeTool(
                timestampService, sourceMapService, logger
            )),
        );

        // Profile tools
        this.disposables.push(
            vscode.lm.registerTool('logmagnifier-listProfiles', new ListProfilesTool(filterManager)),
            vscode.lm.registerTool('logmagnifier-switchProfile', new SwitchProfileTool(filterManager)),
            vscode.lm.registerTool('logmagnifier-createProfile', new CreateProfileTool(filterManager)),
        );

        // Workflow tools
        this.disposables.push(
            vscode.lm.registerTool('logmagnifier-listWorkflows', new ListWorkflowsTool(workflowManager)),
            vscode.lm.registerTool('logmagnifier-runWorkflow', new RunWorkflowTool(workflowManager, logger)),
        );

        // Bookmark tools
        this.disposables.push(
            vscode.lm.registerTool('logmagnifier-getBookmarks', new GetBookmarksTool(bookmarkService)),
            vscode.lm.registerTool('logmagnifier-addBookmark', new AddBookmarkTool(bookmarkService)),
        );

        // JSON tool
        this.disposables.push(
            vscode.lm.registerTool('logmagnifier-extractJson', new ExtractJsonTool()),
        );
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
