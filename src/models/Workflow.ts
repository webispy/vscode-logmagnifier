import { FilterGroup } from './Filter';

export interface WorkflowStep {
    id: string;
    profileName: string;
    description?: string;
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
