import { FilterGroup } from './Filter';

/** A single step in a workflow, referencing a filter profile to apply. */
export interface WorkflowStep {
    id: string;
    profileName: string;
    description?: string;

    /**
     * Tree Structure Support
     * - undefined/null: Root node (Input source is Original Log)
     * - string: Child node (Input source is Parent Step's Output Log)
     */
    parentId?: string;

    /**
     * Execution Strategy
     * - 'independent': Apply ONLY this step's filters. (Independent Analysis)
     * - 'aggregated': Apply this step's filters + ALL descendant steps' filters. (Deep Dive/Preview)
     */
    executionMode: 'independent' | 'aggregated';
}

/** A named sequence of filter steps that can be executed against a log file. */
export interface Workflow {
    id: string;
    name: string;
    description?: string;
    steps: WorkflowStep[];
    lastRunFile?: string;
}

/** Aggregated results of a workflow execution run. */
export interface ExecutionResult {
    workflowId: string;
    startTime: number;
    steps: StepExecutionResult[];
}

/** Output of a single workflow step after execution. */
export interface StepExecutionResult {
    stepIndex: number;
    profileName: string;
    outputFilePath: string;
    matchedCount: number;
    effectiveGroups: FilterGroup[]; // Aggregated groups
}

/** Portable bundle for importing/exporting a workflow with its profiles. */
export interface WorkflowPackage {
    version: string;
    workflow: Workflow;
    profiles: {
        name: string;
        groups: FilterGroup[];
    }[];
}

/** View model for rendering a workflow in the webview panel. */
export interface WorkflowViewModel {
    id: string;
    name: string;
    isExpanded: boolean;
    lastRunFile?: string;
    profiles: ProfileViewModel[];
}

/** View model for a single profile step within the workflow tree. */
export interface ProfileViewModel {
    id: string;
    name: string;
    filterCount: number;
    groups: FilterGroup[];
    isMissing?: boolean;
    parentId?: string;
    executionMode?: 'independent' | 'aggregated';
    depth?: number;
    isLastChild?: boolean;
    connectionType?: 'branch' | 'continuous';
    hasChildren?: boolean;
    nodeType?: 'ind-complex' | 'ind-simple' | 'aggregated';
}
