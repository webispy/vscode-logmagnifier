import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Constants } from '../Constants';
import { Workflow, WorkflowStep, WorkflowPackage, SimulationResult, SimulationStepResult } from '../models/Workflow';
import { LogProcessor } from './LogProcessor';
import { ProfileManager } from './ProfileManager';
import { Logger } from './Logger';
import { FilterGroup } from '../models/Filter';
import { HighlightService } from './HighlightService';
import { SourceMapService } from './SourceMapService';

export class WorkflowManager implements vscode.Disposable {
    private _onDidChangeWorkflow: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeWorkflow: vscode.Event<void> = this._onDidChangeWorkflow.event;

    private _onDidRunWorkflow: vscode.EventEmitter<SimulationResult> = new vscode.EventEmitter<SimulationResult>();
    readonly onDidRunWorkflow: vscode.Event<SimulationResult> = this._onDidRunWorkflow.event;
    private _disposables: vscode.Disposable[] = [];

    private workflows: Workflow[] = [];
    private lastRunResults: Map<string, SimulationResult> = new Map();
    private lastExecutionId: string | undefined;
    private sessionFiles: Set<string> = new Set(); // Track files created in session for cleanup on exit
    private _activeStepId: string | undefined;
    private _expandedWorkflowIds: Set<string> = new Set();
    public stepDelay: number = 200;

    constructor(
        private context: vscode.ExtensionContext,
        private profileManager: ProfileManager,
        private logProcessor: LogProcessor,
        private logger: Logger,
        private highlightService: HighlightService,
        private sourceMapService: SourceMapService
    ) {
        this.workflows = this.loadFromState();

        // Subscribe to profile changes to update workflow UI when profiles are deleted
        this._disposables.push(
            this.profileManager.onDidChangeProfile(() => {
                this._onDidChangeWorkflow.fire();
            })
        );
    }

    private loadFromState(): Workflow[] {
        const workflows = this.context.globalState.get<Workflow[]>(Constants.GlobalState.Workflows) || [];
        // Migration: Ensure new fields exist
        workflows.forEach(w => {
            if (w.steps) {
                w.steps.forEach(s => {
                    if (!s.executionMode) {
                        s.executionMode = 'sequential';
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

    public getLastRunResult(workflowId?: string): SimulationResult | undefined {
        const id = workflowId || this.getActiveWorkflow() || this.lastExecutionId;
        if (id) {
            return this.lastRunResults.get(id);
        }
        return undefined;
    }

    // --- Workflow Interaction ---

    public async handleWorkflowClick(id: string): Promise<void> {
        const activeId = this.getActiveWorkflow();
        const activeStepId = this.getActiveStep();

        if (activeId !== id) {
            // Activate if inactive (different workflow)
            await this.setActiveWorkflow(id);
            // Exclusive Expansion: Collapse others, expand this one
            this._expandedWorkflowIds.clear();
            this._expandedWorkflowIds.add(id);
            this._onDidChangeWorkflow.fire();
        } else {
            // Same workflow clicked
            if (activeStepId) {
                // If a step is currently active, switch focus to the workflow itself
                // This clears the active step but keeps the workflow active and expanded
                await this.setActiveWorkflow(id);
            } else {
                // If workflow is already the distinct focus, toggle expansion
                if (this._expandedWorkflowIds.has(id)) {
                    this._expandedWorkflowIds.delete(id);
                } else {
                    this._expandedWorkflowIds.add(id);
                }
                this._onDidChangeWorkflow.fire();
            }
        }
    }

    public async expandWorkflow(id: string) {
        this._expandedWorkflowIds.add(id);
        this._onDidChangeWorkflow.fire();
    }

    public async collapseWorkflow(id: string) {
        this._expandedWorkflowIds.delete(id);
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
        return this._activeStepId;
    }

    public async setActiveWorkflow(id: string | undefined): Promise<void> {
        await this.context.globalState.update(Constants.GlobalState.ActiveWorkflow, id);
        this._activeStepId = undefined; // Reset step when workflow is explicitly selected
        this._onDidChangeWorkflow.fire();
    }

    // ViewModel for UI
    public async getWorkflowViewModels(): Promise<WorkflowViewModel[]> {
        return Promise.all(this.workflows.map(async workflow => {
            // Build Tree
            const stepMap = new Map<string, WorkflowStep & { children: string[] }>();
            const roots: string[] = [];

            // 1. Initialize Map
            workflow.steps.forEach(step => {
                stepMap.set(step.id, { ...step, children: [] });
            });

            // 2. Build Hierarchy
            workflow.steps.forEach(step => {
                if (step.parentId && stepMap.has(step.parentId)) {
                    stepMap.get(step.parentId)!.children.push(step.id);
                } else {
                    roots.push(step.id);
                }
            });

            // 3. DFS Flattening
            const flattenedSteps: (WorkflowStep & { depth: number; isLastChild: boolean; connectionType: 'branch' | 'continuous' })[] = [];

            const traverse = (stepId: string, depth: number, isLast: boolean, type: 'branch' | 'continuous') => {
                const step = stepMap.get(stepId);
                if (!step) { return; }

                flattenedSteps.push({
                    ...step,
                    depth,
                    isLastChild: isLast,
                    connectionType: type
                });

                step.children.forEach((childId: string, index: number) => {
                    const childStep = stepMap.get(childId);
                    if (childStep) {
                        const childType = childStep.executionMode === 'sequential' ? 'branch' : 'continuous';
                        traverse(childId, depth + 1, index === step.children.length - 1, childType);
                    }
                });
            };

            roots.forEach((rootId, index) => {
                // Root steps start at depth 1 (depth 0 is reserved for "All Logs" node in UI)
                // Roots are always "Sequential", so they should be branches.
                traverse(rootId, 1, index === roots.length - 1, 'branch');
            });

            const profiles = await Promise.all(flattenedSteps.map(async step => {
                const groups = await this.profileManager.getProfileGroups(step.profileName);
                const isMissing = !this.profileManager.getProfileNames().includes(step.profileName);
                let filterCount = 0;
                if (groups) {
                    filterCount = groups.reduce((acc, g) => acc + g.filters.length, 0);
                }

                const stepNode = stepMap.get(step.id);
                const hasChildren = stepNode && stepNode.children.length > 0;
                let nodeType: 'seq-complex' | 'seq-simple' | 'cumulative' = 'seq-simple';

                if (step.depth === 1) {
                    nodeType = hasChildren ? 'seq-complex' : 'seq-simple';
                } else {
                    nodeType = 'cumulative';
                }

                return {
                    id: step.id,
                    name: step.profileName,
                    filterCount: filterCount,
                    groups: groups ? groups : [],
                    isMissing: isMissing,
                    parentId: step.parentId,
                    executionMode: step.executionMode,
                    depth: step.depth,
                    isLastChild: step.isLastChild,
                    connectionType: step.connectionType,
                    hasChildren: hasChildren,
                    nodeType: nodeType
                };
            }));
            const lastRunResult = this.lastRunResults.get(workflow.id);
            return {

                id: workflow.id,
                name: workflow.name,
                isExpanded: this._expandedWorkflowIds.has(workflow.id),
                lastRunFile: lastRunResult ? workflow.lastRunFile : undefined,
                profiles: profiles
            };
        }));
    }

    private getUniqueProfileName(baseName: string): string {
        const existingNames = this.profileManager.getProfileNames();
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

    private getUniqueWorkflowName(baseName: string): string {
        const existingNames = this.workflows.map(w => w.name);
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

    public getProfileNames(): string[] {
        return this.profileManager.getProfileNames();
    }
    public async loadProfile(name: string): Promise<void> {
        await this.profileManager.loadProfile(name);
    }

    public async createWorkflow(name: string): Promise<Workflow> {
        const newSim: Workflow = {
            id: crypto.randomUUID(),
            name,
            steps: []
        };
        this.workflows.push(newSim);
        await this.saveToState();
        this.logger.info(`Workflow created: ${name}`);
        return newSim;
    }

    public async deleteWorkflow(id: string): Promise<void> {
        this.workflows = this.workflows.filter(s => s.id !== id);
        await this.saveToState();

        if (this.getActiveWorkflow() === id) {
            await this.setActiveWorkflow(undefined);
        }
        this.logger.info(`Workflow deleted: ${id}`);
    }

    public async saveWorkflow(workflow: Workflow): Promise<void> {
        const index = this.workflows.findIndex(s => s.id === workflow.id);
        if (index !== -1) {
            this.workflows[index] = workflow;
            await this.saveToState();
            this.logger.info(`Workflow updated: ${workflow.name}`);
        }
    }

    public async renameWorkflow(id: string, newName: string): Promise<void> {
        const workflow = this.getWorkflow(id);
        if (workflow) {
            workflow.name = newName;
            await this.saveWorkflow(workflow);
            this._onDidChangeWorkflow.fire();
        }
    }

    public async addProfileToWorkflow(workflowId: string, profileName: string, parentId?: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            workflow.steps.push({
                id: crypto.randomUUID(),
                profileName: profileName,
                parentId: parentId,
                executionMode: parentId ? 'cumulative' : 'sequential'
            });
            await this.saveWorkflow(workflow);
            await this.expandWorkflow(workflowId);
        }
    }

    public async removeStepFromWorkflow(workflowId: string, stepId: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            workflow.steps = workflow.steps.filter(s => s.id !== stepId);
            await this.saveWorkflow(workflow);
        }
    }

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

    public async duplicateWorkflow(id: string): Promise<Workflow | undefined> {
        const original = this.getWorkflow(id);
        if (!original) { return undefined; }

        const newSim: Workflow = {
            ...original,
            id: crypto.randomUUID(),
            name: `${original.name} (Copy)`,
            steps: original.steps ? original.steps.map(s => ({
                ...s,
                id: crypto.randomUUID(),
                // parentId needs remapping if we were to support deep copy of tree,
                // but for now, if IDs change, parentIds break.
                // TODO: Remap parentIds. For now, flat copy is safer or simple re-id.
                // Actually, if we just re-generate IDs, the parent links break.
                // We must maintain the structure.
            })) : []
        };

        // Fix parentIds for duplicated steps
        if (original.steps) {
            const idMap = new Map<string, string>();
            // 1. Create new IDs and map old->new
            const newSteps = original.steps.map(s => {
                const newId = crypto.randomUUID();
                idMap.set(s.id, newId);
                return { ...s, id: newId };
            });
            // 2. Update parentIds
            for (const step of newSteps) {
                if (step.parentId && idMap.has(step.parentId)) {
                    step.parentId = idMap.get(step.parentId);
                }
            }
            newSim.steps = newSteps;
        }

        this.workflows.push(newSim);
        await this.saveToState();
        await this.expandWorkflow(newSim.id);
        this.logger.info(`Workflow duplicated: ${original.name} -> ${newSim.name}`);
        return newSim;
    }

    public async exportWorkflow(id: string): Promise<string | undefined> {
        const sim = this.getWorkflow(id);
        if (!sim) { return undefined; }

        const profilesData: { name: string, groups: FilterGroup[] }[] = [];

        // Migration check
        if (!sim.steps && 'profileNames' in sim) {
            sim.steps = ((sim as { profileNames: string[] }).profileNames).map(p => ({
                id: crypto.randomUUID(),
                profileName: p,
                executionMode: 'sequential' // Migration default
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

    public async importWorkflow(
        json: string,
        conflictResolver?: (name: string) => Promise<'overwrite' | 'copy' | 'cancel'>
    ): Promise<boolean> {
        try {
            const pkg = JSON.parse(json) as WorkflowPackage;
            if (!pkg.workflow || !pkg.profiles) {
                throw new Error("Invalid Workflow Package format");
            }

            const profileNameMapping: Map<string, string> = new Map();

            // 1. Resolve Profile Conflicts
            for (const pData of pkg.profiles) {
                const existingNames = this.profileManager.getProfileNames();
                if (existingNames.includes(pData.name)) {
                    if (conflictResolver) {
                        const resolution = await conflictResolver(pData.name);
                        if (resolution === 'cancel') {
                            this.logger.info(`Import cancelled by user during profile conflict resolution: ${pData.name}`);
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

            // 4. Save Workflow
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
            this.logger.info(`Workflow imported: ${pkg.workflow.name}`);
            return true;

        } catch (e) {
            this.logger.error(`Import Workflow failed: ${e}`);
            return false;
        }
    }

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
            const randomSuffix = Math.random().toString(36).substring(7);
            const tempInputPath = path.join(tmpDir, `${scanPrefix}_source_${randomSuffix}.log`);

            try {
                fs.writeFileSync(tempInputPath, documentContent, 'utf8');
                currentFilePath = tempInputPath;
                this.sessionFiles.add(currentFilePath);
                this.logger.info(`Created temp source file for simulation (dirty/untitled): ${currentFilePath}`);
            } catch (e) {
                this.logger.error(`Failed to create temp file for document: ${e}`);
                this.logger.error(`[WorkflowManager] Error creating temp file: ${e}`);
                if (isUntitled) {
                    throw new Error("Failed to process untitled file");
                }
            }
        } else {
            this.logger.info(`Using existing source file for simulation: ${currentFilePath}`);
        }

        // Persistent Last Run File
        sim.lastRunFile = currentFilePath;
        await this.saveWorkflow(sim);

        const stepResults: SimulationStepResult[] = [];
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
                    const currentIdx = queue.shift()!;
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
                    for (let i = 0; i < totalSteps; i++) {
                        if (!processingOrder.includes(i)) {
                            processingOrder.push(i);
                        }
                    }
                }

                const stepIdToResult = new Map<string, SimulationStepResult>();

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
                    if (step.parentId && stepIdToResult.has(step.parentId)) {
                        inputFile = stepIdToResult.get(step.parentId)!.outputFilePath;
                    }

                    // Calculate Filters based on Mode
                    const effectiveGroups: FilterGroup[] = [];

                    // Always include current step's groups
                    if (profileData.groups) {
                        effectiveGroups.push(...this.cloneGroupsWithSuffix(profileData.groups, `_s${stepIndex}`));
                    }

                    // Determine if we need to include descendants (Cumulative Logic)
                    // Rule: If explicit 'cumulative' mode OR if this step is a Parent (has children)
                    const hasChildren = sim.steps.some(s => s.parentId === step.id);
                    if (step.executionMode === 'cumulative' || hasChildren) {
                        // Gather descendants
                        const descendants = this.getDescendants(sim.steps, step.id);
                        for (const desc of descendants) {
                            // Find desc index
                            const descIndex = sim.steps.indexOf(desc);
                            if (descIndex !== -1 && resolvedProfiles[descIndex].groups) {
                                effectiveGroups.push(...this.cloneGroupsWithSuffix(resolvedProfiles[descIndex].groups!, `_s${descIndex}`));
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
                    const stepResult: SimulationStepResult = {
                        stepIndex: stepIndex,
                        profileName: step.profileName,
                        outputFilePath: result.outputPath,
                        matchedCount: result.matched,
                        effectiveGroups: effectiveGroups
                    };
                    stepResults.push(stepResult);
                    stepIdToResult.set(step.id, stepResult);

                    if (result.matched > 0) {
                        this.sourceMapService.register(
                            vscode.Uri.file(result.outputPath),
                            vscode.Uri.file(inputFile),
                            result.lineMapping
                        );
                        // Delay opening slightly to prevent UI flicker or race conditions
                        await new Promise(resolve => setTimeout(resolve, 50));
                        // Optional: auto-open? Maybe just store result.
                        // Keeping existing behavior:
                        await this.openStepResult(stepResult);

                    }
                }
            });

            // Store Simulation Result
            const runResult: SimulationResult = {
                workflowId: workflowId,
                startTime: Date.now(),
                steps: stepResults
            };
            this.lastRunResults.set(workflowId, runResult);
            this.lastExecutionId = workflowId;

            // Notify UI
            this._onDidRunWorkflow.fire(runResult);
            this._onDidChangeWorkflow.fire();

        } catch (e) {
            this.logger.error(`Workflow execution failed: ${e}`);
            vscode.window.showErrorMessage(`Workflow failed: ${e}`);
        }
    }

    public async openStepResult(step: SimulationStepResult) {
        if (!fs.existsSync(step.outputFilePath)) {
            vscode.window.showErrorMessage("File not found (might be deleted): " + step.outputFilePath);
            return;
        }

        const uri = vscode.Uri.file(step.outputFilePath);

        const flatFilters = step.effectiveGroups.flatMap(g =>
            g.filters
                .filter(f => f.isEnabled)
                .map(f => {
                    const originalF = { ...f, id: (f as import('../models/Filter').FilterItem & { originalId?: string }).originalId || f.id };
                    return { filter: originalF, groupId: (g as import('../models/Filter').FilterGroup & { originalId?: string }).originalId || g.id };
                })
        );
        this.highlightService.registerDocumentFilters(uri, flatFilters);

        try {
            // Check file size before opening
            const stats = await vscode.workspace.fs.stat(uri);
            const fileSizeMB = stats.size / (1024 * 1024);
            if (fileSizeMB > 50) {
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
        } catch (e) {
            this.logger.error(`Failed to open result file: ${step.outputFilePath}. Error: ${e}`);
            vscode.window.showErrorMessage(`Failed to open result file: ${step.outputFilePath}. It might be too large.`);
        }
    }

    public async activateStep(workflowId: string, stepId: string) {
        const workflow = this.getWorkflow(workflowId);
        if (!workflow) { return; }

        await this.setActiveWorkflow(workflowId);
        this._activeStepId = stepId;
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

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._onDidChangeWorkflow.dispose();
        this._onDidRunWorkflow.dispose();
    }
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
    private getDescendants(steps: import('../models/Workflow').WorkflowStep[], parentId: string): import('../models/Workflow').WorkflowStep[] {
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
}

export interface WorkflowViewModel {
    id: string;
    name: string;
    isExpanded: boolean;
    lastRunFile?: string;
    profiles: ProfileViewModel[];
}

export interface ProfileViewModel {
    id: string;
    name: string;
    filterCount: number;
    groups: FilterGroup[];
    isMissing?: boolean;
    parentId?: string;
    executionMode?: 'sequential' | 'cumulative';
    depth?: number;
    isLastChild?: boolean;
    connectionType?: 'branch' | 'continuous';
    hasChildren?: boolean;
    nodeType?: 'seq-complex' | 'seq-simple' | 'cumulative';
}
