import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Constants } from '../Constants';
import { Workflow, WorkflowPackage, SimulationResult, SimulationStepResult } from '../models/Workflow';
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
        return this.context.globalState.get<Workflow[]>(Constants.GlobalState.Workflows) || [];
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
            const profiles = await Promise.all(workflow.steps.map(async step => {
                const groups = await this.profileManager.getProfileGroups(step.profileName);
                const isMissing = !this.profileManager.getProfileNames().includes(step.profileName);
                let filterCount = 0;
                if (groups) {
                    filterCount = groups.reduce((acc, g) => acc + g.filters.length, 0);
                }
                return {
                    id: step.id,
                    name: step.profileName,
                    filterCount: filterCount,
                    groups: groups ? groups : [],
                    isMissing: isMissing
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

    public async addProfileToWorkflow(workflowId: string, profileName: string): Promise<void> {
        const workflow = this.getWorkflow(workflowId);
        if (workflow) {
            workflow.steps.push({
                id: crypto.randomUUID(),
                profileName: profileName
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
            steps: original.steps ? original.steps.map(s => ({ ...s, id: crypto.randomUUID() })) : []
        };

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
                profileName: p
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
                for (let i = 0; i < totalSteps; i++) {
                    if (token.isCancellationRequested) { break; }

                    const step = sim.steps[i];
                    const profileData = resolvedProfiles[i];

                    if (!profileData.groups) {
                        this.logger.warn(`[WorkflowManager] Skipping step ${i} ('${step.profileName}') because profile is missing.`);
                        progress.report({ message: `Step ${i + 1}/${totalSteps}: Skipping '${step.profileName}' (Missing)...`, increment });
                        continue;
                    }

                    this.logger.info(`[WorkflowManager] Processing step ${i}: ${step.profileName}`);
                    progress.report({ message: `Step ${i + 1}/${totalSteps}: Applying '${step.profileName}'...`, increment });

                    const effectiveGroups: FilterGroup[] = [];
                    // Cumulative Filter Logic (Look-Ahead):
                    for (let j = i; j < totalSteps; j++) {
                        const pData = resolvedProfiles[j];
                        if (pData && pData.groups) {
                            const deepCopiedGroups = pData.groups.map(g => {
                                const newGroup = JSON.parse(JSON.stringify(g)) as FilterGroup;
                                newGroup.id = `${newGroup.id}_step${j}`;
                                newGroup.filters = newGroup.filters.map((f, fIndex) => ({
                                    ...f,
                                    id: `${f.id}_s${j}_f${fIndex}`
                                }));
                                return newGroup;
                            });
                            effectiveGroups.push(...deepCopiedGroups);
                        }
                    }

                    // Run LogProcessor
                    const result = await this.logProcessor.processFile(currentFilePath, effectiveGroups, {
                        prependLineNumbers: false,
                        totalLineCount: lineCount // pass 0 or real count
                    });

                    // Track file
                    this.sessionFiles.add(result.outputPath);

                    // Store Result
                    const stepResult: SimulationStepResult = {
                        stepIndex: i,
                        profileName: step.profileName,
                        outputFilePath: result.outputPath,
                        matchedCount: result.matched,
                        effectiveGroups: effectiveGroups
                    };
                    stepResults.push(stepResult);

                    if (result.matched > 0) {
                        this.sourceMapService.register(
                            vscode.Uri.file(result.outputPath),
                            vscode.Uri.file(currentFilePath),
                            result.lineMapping
                        );
                        await this.openStepResult(stepResult);
                        if (this.stepDelay > 0) {
                            await new Promise(resolve => setTimeout(resolve, this.stepDelay));
                        }
                    }

                    // Always update currentFilePath for next step
                    currentFilePath = result.outputPath;
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
                .map(f => ({ filter: f, groupId: g.id }))
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
}
