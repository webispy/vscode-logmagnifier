import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem } from '../models/Filter';
import { Workflow, WorkflowStep, WorkflowPackage, ExecutionResult, StepExecutionResult, WorkflowViewModel } from '../models/Workflow';

import { FilterStateService } from './FilterStateService';
import { HighlightService } from './HighlightService';
import { Logger } from './Logger';
import { LogProcessor } from './LogProcessor';
import { ProfileManager } from './ProfileManager';
import { LineMappingService } from './LineMappingService';

export class WorkflowManager implements vscode.Disposable {
    private _onDidChangeWorkflow: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeWorkflow: vscode.Event<void> = this._onDidChangeWorkflow.event;

    private _onDidRunWorkflow: vscode.EventEmitter<ExecutionResult> = new vscode.EventEmitter<ExecutionResult>();
    readonly onDidRunWorkflow: vscode.Event<ExecutionResult> = this._onDidRunWorkflow.event;

    private disposables: vscode.Disposable[] = [];
    private workflows: Workflow[] = [];
    private lastRunResults: Map<string, ExecutionResult> = new Map();
    private lastExecutionId: string | undefined;
    private sessionFiles: Set<string> = new Set();
    private activeStepId: string | undefined;
    private expandedWorkflowIds: Set<string> = new Set();
    public stepDelay: number = 200;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly profileManager: ProfileManager,
        private readonly logProcessor: LogProcessor,
        private readonly logger: Logger,
        private readonly highlightService: HighlightService,
        private readonly lineMappingService: LineMappingService,
        private readonly filterStateService?: FilterStateService
    ) {
        this.workflows = this.loadFromState();
        this.cleanupStaleTempFiles();

        // Subscribe to profile changes to update workflow UI when profiles are deleted
        this.disposables.push(
            this.profileManager.onDidChangeProfile(() => {
                this._onDidChangeWorkflow.fire();
            })
        );
    }

    /**
     * Cleans up stale LM_ temp files from previous sessions (e.g. after a crash).
     * Removes files with the LM_ prefix that are older than 24 hours.
     */
    private async cleanupStaleTempFiles(): Promise<void> {
        try {
            const tmpDir = os.tmpdir();
            const prefix = Constants.Defaults.TempFilePrefix.replace(/[^a-zA-Z0-9]/g, '');
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            const files = await fsp.readdir(tmpDir);
            for (const file of files) {
                if (!file.startsWith(prefix)) { continue; }
                const filePath = path.join(tmpDir, file);
                try {
                    const stat = await fsp.stat(filePath);
                    if (stat.isFile() && (now - stat.mtimeMs) > maxAge) {
                        await fsp.unlink(filePath);
                        this.logger.info(`[Workflow] Cleaned up stale temp file: ${file}`);
                    }
                } catch (e: unknown) {
                    // Non-critical — best-effort cleanup of individual temp files
                    this.logger.info(`[Workflow] Could not clean up ${file}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        } catch (e: unknown) {
            // Non-critical — don't block startup if temp dir scan fails
            this.logger.info(`[Workflow] Stale temp cleanup skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private loadFromState(): Workflow[] {
        const workflows = this.context.globalState.get<Workflow[]>(Constants.GlobalState.Workflows) ?? [];
        // Migration: Ensure new fields exist and rename legacy values
        workflows.forEach(w => {
            if (w.steps) {
                w.steps.forEach(s => {
                    // Migrate legacy 'sequential' → 'independent', 'cumulative' → 'aggregated'
                    const mode = s.executionMode as string;
                    if (mode === 'sequential' || !mode) {
                        s.executionMode = 'independent';
                    } else if (mode === 'cumulative') {
                        s.executionMode = 'aggregated';
                    }
                    // parentId is optional, so undefined is fine
                });
            }
        });
        return workflows;
    }

    private async saveToState() {
        await this.context.globalState.update(Constants.GlobalState.Workflows, this.workflows);
        this._onDidChangeWorkflow.fire();
    }

    /** Returns the last run result for the given workflow, the active workflow, or the most recent execution. */
    public getLastRunResult(workflowId?: string): ExecutionResult | undefined {
        const id = workflowId || this.getActiveWorkflow() || this.lastExecutionId;
        if (id) {
            return this.lastRunResults.get(id);
        }
        return undefined;
    }

    // --- Workflow Interaction ---

    /** Handles a workflow click by toggling activation and expansion state. */
    public async handleWorkflowClick(id: string): Promise<void> {
        const activeId = this.getActiveWorkflow();
        const activeStepId = this.getActiveStep();

        if (activeId !== id) {
            // Activate if inactive (different workflow)
            await this.setActiveWorkflow(id);
            // Exclusive Expansion: Collapse others, expand this one
            this.expandedWorkflowIds.clear();
            this.expandedWorkflowIds.add(id);
            this._onDidChangeWorkflow.fire();
        } else {
            // Same workflow clicked
            if (activeStepId) {
                // If a step is currently active, switch focus to the workflow itself
                // This clears the active step but keeps the workflow active and expanded
                await this.setActiveWorkflow(id);
            } else {
                // If workflow is already the distinct focus, toggle expansion
                if (this.expandedWorkflowIds.has(id)) {
                    this.expandedWorkflowIds.delete(id);
                } else {
                    this.expandedWorkflowIds.add(id);
                }
                this._onDidChangeWorkflow.fire();
            }
        }
    }

    /** Expands the workflow tree node in the UI. */
    public expandWorkflow(id: string) {
        this.expandedWorkflowIds.add(id);
        this._onDidChangeWorkflow.fire();
    }

    /** Collapses the workflow tree node in the UI. */
    public collapseWorkflow(id: string) {
        this.expandedWorkflowIds.delete(id);
        this._onDidChangeWorkflow.fire();
    }

    // --- Workflow CRUD ---

    public getWorkflows(): Workflow[] {
        return this.workflows;
    }

    public getWorkflow(id: string): Workflow | undefined {
        return this.workflows.find(s => s.id === id);
    }

    public getActiveWorkflow(): string | undefined {
        return this.context.globalState.get<string>(Constants.GlobalState.ActiveWorkflow);
    }

    public getActiveStep(): string | undefined {
        return this.activeStepId;
    }

    /** Sets the active workflow and resets the active step selection. */
    public async setActiveWorkflow(id: string | undefined): Promise<void> {
        await this.context.globalState.update(Constants.GlobalState.ActiveWorkflow, id);
        this.activeStepId = undefined; // Reset step when workflow is explicitly selected
        this._onDidChangeWorkflow.fire();
    }

    /** Builds view models for all workflows, resolving profile data and step hierarchy for the UI. */
    public async getWorkflowViewModels(): Promise<WorkflowViewModel[]> {
        return Promise.all(this.workflows.map(async workflow => {
            const { stepMap, flattenedSteps } = this.buildStepHierarchy(workflow.steps);
            const profiles = await this.resolveStepProfiles(flattenedSteps, stepMap);

            const lastRunResult = this.lastRunResults.get(workflow.id);
            return {
                id: workflow.id,
                name: workflow.name,
                isExpanded: this.expandedWorkflowIds.has(workflow.id),
                lastRunFile: lastRunResult ? workflow.lastRunFile : undefined,
                profiles: profiles
            };
        }));
    }

    private buildStepHierarchy(steps: WorkflowStep[]) {
        const stepMap = new Map<string, WorkflowStep & { children: string[] }>();
        const roots: string[] = [];

        steps.forEach(step => {
            stepMap.set(step.id, { ...step, children: [] });
        });

        steps.forEach(step => {
            const parent = step.parentId ? stepMap.get(step.parentId) : undefined;
            if (parent) {
                parent.children.push(step.id);
            } else {
                roots.push(step.id);
            }
        });

        const flattenedSteps: (WorkflowStep & { depth: number; isLastChild: boolean; connectionType: 'branch' | 'continuous' })[] = [];

        const traverse = (stepId: string, depth: number, isLast: boolean, type: 'branch' | 'continuous') => {
            const step = stepMap.get(stepId);
            if (!step) { return; }

            flattenedSteps.push({ ...step, depth, isLastChild: isLast, connectionType: type });

            step.children.forEach((childId: string, index: number) => {
                const childStep = stepMap.get(childId);
                if (childStep) {
                    const childType = childStep.executionMode === 'independent' ? 'branch' : 'continuous';
                    traverse(childId, depth + 1, index === step.children.length - 1, childType);
                }
            });
        };

        roots.forEach((rootId, index) => {
            traverse(rootId, 1, index === roots.length - 1, 'branch');
        });

        return { stepMap, flattenedSteps };
    }

    private async resolveStepProfiles(
        flattenedSteps: (WorkflowStep & { depth: number; isLastChild: boolean; connectionType: 'branch' | 'continuous' })[],
        stepMap: Map<string, WorkflowStep & { children: string[] }>
    ) {
        const uniqueProfileNames = [...new Set(flattenedSteps.map(s => s.profileName))];
        const profileCache = new Map<string, FilterGroup[] | undefined>(
            await Promise.all(uniqueProfileNames.map(async n => [n, await this.profileManager.getProfileGroups(n)] as const))
        );
        const existingProfileNames = new Set(this.profileManager.getProfileNames());

        return flattenedSteps.map(step => {
            const groups = profileCache.get(step.profileName);
            const isMissing = !existingProfileNames.has(step.profileName);
            const filterCount = groups ? groups.reduce((acc, g) => acc + g.filters.length, 0) : 0;

            const stepNode = stepMap.get(step.id);
            const hasChildren = stepNode && stepNode.children.length > 0;
            const nodeType: 'ind-complex' | 'ind-simple' | 'aggregated' =
                step.depth === 1 ? (hasChildren ? 'ind-complex' : 'ind-simple') : 'aggregated';

            return {
                id: step.id,
                name: step.profileName,
                filterCount,
                groups: groups ?? [],
                isMissing,
                parentId: step.parentId,
                executionMode: step.executionMode,
                depth: step.depth,
                isLastChild: step.isLastChild,
                connectionType: step.connectionType,
                hasChildren,
                nodeType
            };
        });
    }

    private getUniqueName(baseName: string, existingNames: string[]): string {
        if (!existingNames.includes(baseName)) {
            return baseName;
        }
        let counter = 1;
        let newName = `${baseName} (${counter})`;
        while (existingNames.includes(newName)) {
            counter++;
            newName = `${baseName} (${counter})`;
        }
        return newName;
    }

    private getUniqueProfileName(baseName: string): string {
        return this.getUniqueName(baseName, this.profileManager.getProfileNames());
    }

    private getUniqueWorkflowName(baseName: string): string {
        return this.getUniqueName(baseName, this.workflows.map(w => w.name));
    }

    public getProfileNames(): string[] {
        return this.profileManager.getProfileNames();
    }
    public async loadProfile(name: string): Promise<void> {
        await this.profileManager.loadProfile(name);
    }

    public async createEmptyProfile(name: string): Promise<boolean> {
        return await this.profileManager.createProfile(name, []);
    }

    /** Renames a profile and updates all workflow steps that reference it. */
    public async renameProfile(oldName: string, newName: string): Promise<boolean> {
        const success = await this.profileManager.renameProfile(oldName, newName);
        if (success) {
            let updated = false;
            for (const workflow of this.workflows) {
                for (const step of workflow.steps) {
                    if (step.profileName === oldName) {
                        step.profileName = newName;
                        updated = true;
                    }
                }
            }
            if (updated) {
                await this.saveToState();
                this._onDidChangeWorkflow.fire();
            }
        }
        return success;
    }

    public async deleteProfile(name: string): Promise<boolean> {
        return await this.profileManager.deleteProfile(name);
    }

    /** Creates a new empty workflow with the given name and persists it. */
    public async createWorkflow(name: string): Promise<Workflow> {
        const newSim: Workflow = {
            id: crypto.randomUUID(),
            name,
            steps: []
        };
        this.workflows.push(newSim);
        await this.saveToState();
        this.logger.info(`[WorkflowManager] Workflow created: ${name}`);
        return newSim;
    }

    /** Deletes a workflow by ID and clears it as active if necessary. */
    public async deleteWorkflow(id: string): Promise<void> {
        this.workflows = this.workflows.filter(s => s.id !== id);
        await this.saveToState();

        if (this.getActiveWorkflow() === id) {
            await this.setActiveWorkflow(undefined);
        }
        this.logger.info(`[WorkflowManager] Workflow deleted: ${id}`);
    }

    /** Persists an updated workflow to global state. */
    public async saveWorkflow(workflow: Workflow): Promise<void> {
        const index = this.workflows.findIndex(s => s.id === workflow.id);
        if (index !== -1) {
            this.workflows[index] = workflow;
            await this.saveToState();
            this.logger.info(`[WorkflowManager] Workflow updated: ${workflow.name}`);
        }
    }

    /** Renames a workflow and persists the change. */
    public async renameWorkflow(id: string, newName: string): Promise<void> {
        const workflow = this.getWorkflow(id);
        if (workflow) {
            workflow.name = newName;
            await this.saveWorkflow(workflow);
            this._onDidChangeWorkflow.fire();
        }
    }

    /**
     * Detects whether setting parentId on stepId would create a cycle in the step tree.
     */
    private hasCycle(steps: WorkflowStep[], stepId: string, parentId: string): boolean {
        let current: string | undefined = parentId;
        const visited = new Set<string>();
        while (current !== undefined) {
            if (current === stepId) { return true; }
            if (visited.has(current)) { return true; }
            visited.add(current);
            current = steps.find(s => s.id === current)?.parentId;
        }
        return false;
    }

    /** Adds a profile as a new step to a workflow, optionally as a child of an existing step. */
    public async addProfileToWorkflow(workflowId: string, profileName: string, parentId?: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            const newId = crypto.randomUUID();
            if (parentId && this.hasCycle(workflow.steps, newId, parentId)) {
                this.logger.warn(`[Workflow] Cycle detected: cannot add step under ${parentId}`);
                return;
            }
            workflow.steps.push({
                id: newId,
                profileName: profileName,
                parentId: parentId,
                executionMode: parentId ? 'aggregated' : 'independent'
            });
            await this.saveWorkflow(workflow);
            await this.expandWorkflow(workflowId);
        }
    }

    /** Removes a step from a workflow by step ID. */
    public async removeStepFromWorkflow(workflowId: string, stepId: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            workflow.steps = workflow.steps.filter(s => s.id !== stepId);
            await this.saveWorkflow(workflow);
        }
    }

    /** Moves a step one position earlier in the workflow's step list. */
    public async moveStepUp(workflowId: string, stepId: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            const index = workflow.steps.findIndex(s => s.id === stepId);
            if (index > 0) {
                const temp = workflow.steps[index];
                workflow.steps[index] = workflow.steps[index - 1];
                workflow.steps[index - 1] = temp;
                await this.saveWorkflow(workflow);
            }
        }
    }

    /** Moves a step one position later in the workflow's step list. */
    public async moveStepDown(workflowId: string, stepId: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            const index = workflow.steps.findIndex(s => s.id === stepId);
            if (index !== -1 && index < workflow.steps.length - 1) {
                const temp = workflow.steps[index];
                workflow.steps[index] = workflow.steps[index + 1];
                workflow.steps[index + 1] = temp;
                await this.saveWorkflow(workflow);
            }
        }
    }

    /** Creates a deep copy of a workflow with new IDs and a "(Copy)" name suffix. */
    public async duplicateWorkflow(id: string): Promise<Workflow | undefined> {
        const original = this.getWorkflow(id);
        if (!original) { return undefined; }

        const idMap = new Map<string, string>();
        const newSteps = (original.steps ?? []).map(s => {
            const newId = crypto.randomUUID();
            idMap.set(s.id, newId);
            return { ...s, id: newId };
        });
        for (const step of newSteps) {
            if (step.parentId && idMap.has(step.parentId)) {
                step.parentId = idMap.get(step.parentId);
            }
        }

        const newSim: Workflow = {
            ...original,
            id: crypto.randomUUID(),
            name: `${original.name} (Copy)`,
            steps: newSteps
        };

        this.workflows.push(newSim);
        await this.saveToState();
        await this.expandWorkflow(newSim.id);
        this.logger.info(`[WorkflowManager] Workflow duplicated: ${original.name} -> ${newSim.name}`);
        return newSim;
    }

    /** Serializes a workflow and its referenced profiles to a JSON package string. */
    public async exportWorkflow(id: string): Promise<string | undefined> {
        const sim = this.getWorkflow(id);
        if (!sim) { return undefined; }

        const profilesData: { name: string, groups: FilterGroup[] }[] = [];

        // Migration check
        if (!sim.steps && 'profileNames' in sim) {
            sim.steps = ((sim as { profileNames: string[] }).profileNames).map(p => ({
                id: crypto.randomUUID(),
                profileName: p,
                executionMode: 'independent' // Migration default
            }));
        }

        for (const step of sim.steps) {
            const groups = await this.profileManager.getProfileGroups(step.profileName);
            if (groups) {
                // Check if already added
                if (!profilesData.find(pd => pd.name === step.profileName)) {
                    profilesData.push({ name: step.profileName, groups });
                }
            }
        }

        const pkg: WorkflowPackage = {
            version: this.context.extension.packageJSON.version,
            workflow: sim,
            profiles: profilesData
        };

        return JSON.stringify(pkg, null, 4);
    }

    /**
     * Imports a workflow from a JSON package string, resolving profile name conflicts.
     * @param json Serialized WorkflowPackage JSON string.
     * @param conflictResolver Optional callback invoked when an imported profile name already exists.
     * @returns Whether the import completed successfully.
     */
    public async importWorkflow(
        json: string,
        conflictResolver?: (name: string) => Promise<'overwrite' | 'copy' | 'cancel'>
    ): Promise<boolean> {
        try {
            const pkg = JSON.parse(json) as WorkflowPackage;
            if (!pkg.workflow || !pkg.profiles) {
                throw new Error("Invalid Workflow Package format");
            }

            // Validate workflow name
            if (typeof pkg.workflow.name !== 'string' || pkg.workflow.name.length === 0) {
                throw new Error("Invalid workflow name");
            }
            pkg.workflow.name = pkg.workflow.name.slice(0, 200).replace(/[\x00-\x1f]/g, '');

            // Validate workflow steps
            const MAX_NAME_LENGTH = 200;
            if (!Array.isArray(pkg.workflow.steps)) {
                throw new Error("Invalid workflow steps");
            }
            for (const step of pkg.workflow.steps) {
                if (typeof step.profileName !== 'string' || step.profileName.length === 0 || step.profileName.length > MAX_NAME_LENGTH) {
                    throw new Error('Invalid step profile name');
                }
                step.profileName = step.profileName.replace(/[\x00-\x1f]/g, '');
                // Migrate legacy values: 'cumulative' → 'aggregated', anything else → 'independent'
                const mode = step.executionMode as string;
                step.executionMode = (mode === 'aggregated' || mode === 'cumulative') ? 'aggregated' : 'independent';
            }

            // Validate profiles
            if (!Array.isArray(pkg.profiles)) {
                throw new Error("Invalid profiles data");
            }
            for (const pData of pkg.profiles) {
                if (typeof pData.name !== 'string' || pData.name.length === 0 || pData.name.length > MAX_NAME_LENGTH) {
                    throw new Error('Invalid profile name');
                }
                pData.name = pData.name.replace(/[\x00-\x1f]/g, '');
            }

            // Sanitize bundled profile filters for legacy exports (pre-1.7.1)
            const isLegacy = FilterStateService.isLegacyVersion(pkg.version);
            if (isLegacy) {
                this.logger.info(`[WorkflowManager] Legacy workflow package (version: ${pkg.version || 'unknown'}), applying filter migration.`);
            }
            if (this.filterStateService) {
                for (const pData of pkg.profiles) {
                    if (Array.isArray(pData.groups)) {
                        this.filterStateService.sanitizeFilterGroups(pData.groups);
                    }
                }
            }

            const profileNameMapping: Map<string, string> = new Map();

            // 1. Resolve Profile Conflicts
            for (const pData of pkg.profiles) {
                const existingNames = this.profileManager.getProfileNames();
                if (existingNames.includes(pData.name)) {
                    if (conflictResolver) {
                        const resolution = await conflictResolver(pData.name);
                        if (resolution === 'cancel') {
                            this.logger.info(`[WorkflowManager] Import cancelled by user during profile conflict resolution: ${pData.name}`);
                            return false;
                        } else if (resolution === 'overwrite') {
                            profileNameMapping.set(pData.name, pData.name);
                        } else {
                            // Create Copy
                            const newName = this.getUniqueProfileName(pData.name);
                            profileNameMapping.set(pData.name, newName);
                        }
                    } else {
                        // Default to copy if no resolver provided (safe fallback)
                        const newName = this.getUniqueProfileName(pData.name);
                        profileNameMapping.set(pData.name, newName);
                    }
                } else {
                    profileNameMapping.set(pData.name, pData.name);
                }
            }

            // 2. Adjust Workflow Pipeline if renaming happened
            for (const step of pkg.workflow.steps) {
                const mappedName = profileNameMapping.get(step.profileName);
                if (mappedName) {
                    step.profileName = mappedName;
                }
            }

            // 3. Save Profiles
            for (const pData of pkg.profiles) {
                const finalName = profileNameMapping.get(pData.name) || pData.name;
                await this.profileManager.importProfile(finalName, pData.groups, true); // true because we either decided to overwrite or we have a unique name
            }

            // 4. Validate imported steps for cycles
            for (const step of pkg.workflow.steps) {
                if (step.parentId && this.hasCycle(pkg.workflow.steps, step.id, step.parentId)) {
                    this.logger.warn(`[Workflow] Cycle detected in imported workflow step ${step.id}, clearing parentId`);
                    step.parentId = undefined;
                    step.executionMode = 'independent';
                }
            }

            // 5. Save Workflow
            // Check if workflow ID exists
            const existingIndex = this.workflows.findIndex(s => s.id === pkg.workflow.id);
            if (existingIndex !== -1) {
                // If ID matches, we generate a new ID and a unique name with (#) format
                pkg.workflow.id = crypto.randomUUID();
                pkg.workflow.name = this.getUniqueWorkflowName(pkg.workflow.name);
                this.workflows.push(pkg.workflow);
            } else {
                // Even if ID is new, name might conflict
                pkg.workflow.name = this.getUniqueWorkflowName(pkg.workflow.name);
                this.workflows.push(pkg.workflow);
            }

            await this.saveToState();
            await this.expandWorkflow(pkg.workflow.id);
            this.logger.info(`[WorkflowManager] Workflow imported: ${pkg.workflow.name}`);
            return true;

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[WorkflowManager] Import Workflow failed: ${msg}`);
            return false;
        }
    }

    /** Executes all steps of a workflow against the given source document or file URI. */
    public async run(workflowId: string, source: vscode.TextDocument | vscode.Uri): Promise<void> {
        const sim = this.getWorkflow(workflowId);
        if (!sim) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        await this.expandWorkflow(workflowId);

        if (sim.steps.length === 0) {
            vscode.window.showErrorMessage("Workflow is empty or invalid.");
            return;
        }

        let currentFilePath: string;
        let lineCount = 0;
        let isDirty = false;
        let isUntitled = false;
        let documentContent = '';

        if (source instanceof vscode.Uri) {
            currentFilePath = source.fsPath;
            // If we only have a Uri, we assume it's a file on disk (not dirty/untitled in the editor sense) unless checked otherwise.
            // For large files, we won't have a document, so we can't check isDirty easily.
            // We assume 'file' scheme Uris are effectively saved files.
        } else {
            // source is vscode.TextDocument
            currentFilePath = source.uri.fsPath;
            lineCount = source.lineCount;
            isDirty = source.isDirty;
            isUntitled = source.isUntitled;
            documentContent = source.getText();
        }

        // Create a temp file ONLY if the document is dirty or untitled
        if (isDirty || isUntitled) {
            const tmpDir = os.tmpdir();
            const scanPrefix = Constants.Defaults.TempFilePrefix.replace(/[^a-zA-Z0-9]/g, '');
            const randomSuffix = crypto.randomBytes(4).toString('hex');
            const tempInputPath = path.join(tmpDir, `${scanPrefix}_source_${randomSuffix}.log`);

            try {
                await fsp.writeFile(tempInputPath, documentContent, 'utf8');
                currentFilePath = tempInputPath;
                this.sessionFiles.add(currentFilePath);
                this.logger.info(`[WorkflowManager] Created temp source file for simulation (dirty/untitled): ${currentFilePath}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.error(`[WorkflowManager] Failed to create temp file for document: ${msg}`);
                if (isUntitled) {
                    throw new Error("Failed to process untitled file");
                }
            }
        } else {
            this.logger.info(`[WorkflowManager] Using existing source file for simulation: ${currentFilePath}`);
        }

        // Persistent Last Run File
        sim.lastRunFile = currentFilePath;
        await this.saveWorkflow(sim);

        const stepResults: StepExecutionResult[] = [];
        this.logger.info(`[WorkflowManager] Starting run execution loop for ${sim.name}`);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Running Workflow: ${sim.name}`,
                cancellable: true
            }, async (progress, token) => {

                // 1. Resolve all profiles first
                const existingNames = this.profileManager.getProfileNames();
                const resolvedProfiles: { name: string; groups: FilterGroup[] | undefined }[] = [];
                for (const step of sim.steps) {
                    const groups = existingNames.includes(step.profileName)
                        ? await this.profileManager.getProfileGroups(step.profileName)
                        : undefined;
                    resolvedProfiles.push({ name: step.profileName, groups });
                }

                const totalSteps = sim.steps.length;
                const increment = 100 / totalSteps;

                // 2. Execute Pipeline
                // 2. Build Execution Order (BFS / Topological)
                const processingOrder: number[] = []; // Indices of steps
                const stepIdToIndex = new Map<string, number>();
                sim.steps.forEach((s, idx) => stepIdToIndex.set(s.id, idx));

                const queue: number[] = [];
                // Find roots
                sim.steps.forEach((s, idx) => {
                    if (!s.parentId || !stepIdToIndex.has(s.parentId)) {
                        queue.push(idx);
                    }
                });

                while (queue.length > 0) {
                    const currentIdx = queue.shift();
                    if (currentIdx === undefined) { break; }
                    processingOrder.push(currentIdx);

                    // Find children
                    const currentId = sim.steps[currentIdx].id;
                    sim.steps.forEach((s, idx) => {
                        if (s.parentId === currentId) {
                            queue.push(idx);
                        }
                    });
                }

                // If disconnected cycles exist, they might be missed. Use remaining for safety?
                // For now, assume tree structure created by UI is valid.
                // Fallback: add remaining steps to end (linear)
                if (processingOrder.length < totalSteps) {
                    const ordered = new Set(processingOrder);
                    for (let i = 0; i < totalSteps; i++) {
                        if (!ordered.has(i)) {
                            processingOrder.push(i);
                        }
                    }
                }

                const stepIdToResult = new Map<string, StepExecutionResult>();

                // 3. Execute Pipeline
                for (let i = 0; i < processingOrder.length; i++) {
                    if (token.isCancellationRequested) { break; }

                    const stepIndex = processingOrder[i];
                    const step = sim.steps[stepIndex];
                    const profileData = resolvedProfiles[stepIndex];

                    if (!profileData.groups) {
                        this.logger.warn(`[WorkflowManager] Skipping step ${stepIndex} ('${step.profileName}') because profile is missing.`);
                        progress.report({ message: `Step ${i + 1}/${totalSteps}: Skipping '${step.profileName}' (Missing)...`, increment });
                        continue;
                    }

                    this.logger.info(`[WorkflowManager] Processing step ${stepIndex}: ${step.profileName} (Mode: ${step.executionMode})`);
                    progress.report({ message: `Step ${i + 1}/${totalSteps}: Applying '${step.profileName}'...`, increment });

                    // Determine Input File
                    let inputFile = currentFilePath; // Default to root source
                    if (step.parentId) {
                        const parentResult = stepIdToResult.get(step.parentId);
                        if (parentResult) {
                            inputFile = parentResult.outputFilePath;
                        }
                    }

                    // Calculate Filters based on Mode
                    const effectiveGroups: FilterGroup[] = [];

                    // Always include current step's groups
                    if (profileData.groups) {
                        effectiveGroups.push(...this.cloneGroupsWithSuffix(profileData.groups, `_s${stepIndex}`));
                    }

                    // Determine if we need to include descendants (Aggregated Logic)
                    // Rule: If explicit 'aggregated' mode OR if this step is a Parent (has children)
                    const hasChildren = sim.steps.some(s => s.parentId === step.id);
                    if (step.executionMode === 'aggregated' || hasChildren) {
                        // Gather descendants
                        const descendants = this.getDescendants(sim.steps, step.id);
                        for (const desc of descendants) {
                            // Find desc index
                            const descIndex = sim.steps.indexOf(desc);
                            const descGroups = descIndex !== -1 ? resolvedProfiles[descIndex].groups : undefined;
                    if (descGroups) {
                                effectiveGroups.push(...this.cloneGroupsWithSuffix(descGroups, `_s${descIndex}`));
                            }
                        }
                    }

                    // Run LogProcessor
                    const result = await this.logProcessor.processFile(inputFile, effectiveGroups, {
                        prependLineNumbers: false,
                        totalLineCount: lineCount, // pass 0 or real count
                        mergeGroups: true // Always use Union logic for multiple profiles/levels
                    });

                    // Track file
                    this.sessionFiles.add(result.outputPath);

                    // Store Result
                    const stepResult: StepExecutionResult = {
                        stepIndex: stepIndex,
                        profileName: step.profileName,
                        outputFilePath: result.outputPath,
                        matchedCount: result.matched,
                        effectiveGroups: effectiveGroups
                    };
                    stepResults.push(stepResult);
                    stepIdToResult.set(step.id, stepResult);

                    if (result.matched > 0) {
                        this.lineMappingService.register(
                            vscode.Uri.file(result.outputPath),
                            vscode.Uri.file(inputFile),
                            result.lineMapping
                        );
                        await this.openStepResult(stepResult);

                    }
                }
            });

            // Store Execution Result
            const runResult: ExecutionResult = {
                workflowId: workflowId,
                startTime: Date.now(),
                steps: stepResults
            };
            this.lastRunResults.set(workflowId, runResult);
            this.lastExecutionId = workflowId;

            // Notify UI
            this._onDidRunWorkflow.fire(runResult);
            this._onDidChangeWorkflow.fire();

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[WorkflowManager] Workflow execution failed: ${msg}`);
            vscode.window.showErrorMessage(`Workflow failed: ${msg}`);
        }
    }

    /** Opens the output file for a step result in the editor with highlight decorations applied. */
    public async openStepResult(step: StepExecutionResult) {
        try {
            await fsp.access(step.outputFilePath);
        } catch (e: unknown) {
            this.logger.warn(`[WorkflowManager] Step result file not found: ${e instanceof Error ? e.message : String(e)}`);
            vscode.window.showErrorMessage("File not found (might be deleted): " + step.outputFilePath);
            return;
        }

        const uri = vscode.Uri.file(step.outputFilePath);

        const flatFilters = step.effectiveGroups.flatMap(g =>
            g.filters
                .filter(f => f.isEnabled)
                .map(f => {
                    const originalF = { ...f, id: (f as FilterItem & { originalId?: string }).originalId ?? f.id };
                    return { filter: originalF, groupId: (g as FilterGroup & { originalId?: string }).originalId ?? g.id };
                })
        );
        this.highlightService.registerDocumentFilters(uri, flatFilters);

        try {
            // Check file size before opening
            const stats = await vscode.workspace.fs.stat(uri);
            const fileSizeMB = stats.size / (1024 * 1024);
            if (fileSizeMB > Constants.Defaults.LargeFileSizeLimitMB) {
                const open = 'Open Anyway';
                const choice = await vscode.window.showWarningMessage(
                    `Result file is large (${fileSizeMB.toFixed(2)}MB). VS Code may not display it correctly.`,
                    open
                );
                if (choice !== open) {
                    return;
                }
            }

            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.languages.setTextDocumentLanguage(doc, 'log');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[WorkflowManager] Failed to open result file: ${step.outputFilePath}. Error: ${msg}`);
            vscode.window.showErrorMessage(`Failed to open result file: ${step.outputFilePath}. It might be too large.`);
        }
    }

    /** Activates a step within a workflow, loading its profile and opening its last run result if available. */
    public async activateStep(workflowId: string, stepId: string) {
        const workflow = this.getWorkflow(workflowId);
        if (!workflow) { return; }

        await this.setActiveWorkflow(workflowId);
        this.activeStepId = stepId;
        this._onDidChangeWorkflow.fire();

        const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
        if (stepIndex === -1) { return; }

        const profileName = workflow.steps[stepIndex].profileName;

        const lastRunResult = this.lastRunResults.get(workflowId);
        if (lastRunResult && lastRunResult.workflowId === workflowId) {
            const stepResult = lastRunResult.steps.find(s => s.stepIndex === stepIndex);
            if (stepResult) {
                await this.profileManager.loadProfile(profileName);

                await this.openStepResult(stepResult);
                vscode.window.setStatusBarMessage(`Opened result for '${profileName}'`, 3000);
                return;
            }
        }

        await this.profileManager.loadProfile(profileName);
        vscode.window.setStatusBarMessage(`Loaded profile '${profileName}'`, 3000);
    }

    /** Opens all step result files from the last run of a workflow. */
    public async openAllResults(workflowId: string) {
        const lastRunResult = this.lastRunResults.get(workflowId);
        if (!lastRunResult || lastRunResult.workflowId !== workflowId) {
            vscode.window.setStatusBarMessage(`No recent run results for this workflow.`, 3000);
            return;
        }

        for (const step of lastRunResult.steps) {
            await this.openStepResult(step);
        }
        vscode.window.setStatusBarMessage(`Opened all results.`, 3000);
    }

    /** Closes all editor tabs associated with the last run results of a workflow. */
    public async closeAllResults(workflowId: string) {
        const lastRunResult = this.lastRunResults.get(workflowId);
        if (!lastRunResult || lastRunResult.workflowId !== workflowId) {
            return;
        }

        const filesToClose = new Set(lastRunResult.steps.map(s => s.outputFilePath));
        const tabsToClose: vscode.Tab[] = [];

        vscode.window.tabGroups.all.forEach(group => {
            group.tabs.forEach(tab => {
                if (tab.input instanceof vscode.TabInputText) {
                    const fsPath = tab.input.uri.fsPath;
                    if (filesToClose.has(fsPath)) {
                        tabsToClose.push(tab);
                    }
                }
            });
        });

        if (tabsToClose.length > 0) {
            await vscode.window.tabGroups.close(tabsToClose);
            vscode.window.setStatusBarMessage(`Closed ${tabsToClose.length} result files.`, 3000);
        }
    }

    private getDescendants(steps: WorkflowStep[], parentId: string): WorkflowStep[] {
        const children = steps.filter(s => s.parentId === parentId);
        let descendants = [...children];
        for (const child of children) {
            descendants = descendants.concat(this.getDescendants(steps, child.id));
        }
        return descendants;
    }

    private cloneGroupsWithSuffix(groups: FilterGroup[], suffix: string): FilterGroup[] {
        return groups.map(g => {
            const newGroup = JSON.parse(JSON.stringify(g)) as FilterGroup & { originalId?: string };
            newGroup.originalId = newGroup.id;
            newGroup.id = `${newGroup.id}${suffix}`;
            newGroup.filters = newGroup.filters.map((f, fIndex) => ({
                ...f,
                originalId: f.id,
                id: `${f.id}${suffix}_f${fIndex}`
            }));
            return newGroup;
        });
    }

    /** Deletes all session temp files and disposes event emitters and subscriptions. */
    public dispose() {
        for (const filePath of this.sessionFiles) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.info(`[WorkflowManager] Failed to delete session file on dispose: ${filePath}: ${msg}`);
            }
        }
        this.sessionFiles.clear();

        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this._onDidChangeWorkflow.dispose();
        this._onDidRunWorkflow.dispose();
    }
}

// Re-export view model interfaces from their canonical location
export { WorkflowViewModel, ProfileViewModel } from '../models/Workflow';
