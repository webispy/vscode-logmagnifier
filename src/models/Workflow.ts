import { FilterGroup } from './Filter';

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
     * - 'sequential': Apply ONLY this step's filters. (Independent Analysis)
     * - 'cumulative': Apply this step's filters + ALL descendant steps' filters. (Deep Dive/Preview)
     */
    executionMode: 'sequential' | 'cumulative';
}

export interface Workflow {
    id: string;
    name: string;
    description?: string;
    steps: WorkflowStep[];
    lastRunFile?: string;
}

export interface SimulationResult {
    workflowId: string;
    startTime: number;
    steps: SimulationStepResult[];
}

export interface SimulationStepResult {
    stepIndex: number;
    profileName: string;
    outputFilePath: string;
    matchedCount: number;
    effectiveGroups: FilterGroup[]; // Cumulative groups
}

export interface WorkflowPackage {
    version: string;
    workflow: Workflow;
    profiles: {
        name: string;
        groups: FilterGroup[];
    }[];
}
