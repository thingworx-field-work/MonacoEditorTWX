import { ServiceEditor } from "../serviceEditor/serviceEditor";
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { WorkerScriptManager } from "../workerScriptManager";
import { loadSnippets, spotlightSearch, sanitizeEntityName, getEntityMetadata, getThingPropertyValues } from '../../utilities';
import { DISALLOWED_ENTITY_CHARS, ENTITY_TYPES, Languages } from "../../constants";
import { ThingworxToTypescriptGenerator } from "./thingworxTypescriptGenerator";


const ENTITY_TYPINGS_TTL_MS = 5 * 60 * 1000;

export class TypescriptCodeEditor extends ServiceEditor {
    /** Entity typings by sanitized name, shared by all editors of the session. The property values go stale, hence the TTL */
    // entities that returned no metadata (missing or forbidden), so they are not requested again on every edit pause
    private static missingEntityCache = new Map<string, number>();
    private static entityTypingsCache = new Map<string, { definition: string; time: number }>();
    public workerManager: WorkerScriptManager;
    public codeTranslator: ThingworxToTypescriptGenerator;

    private languageSwitchAction: monaco.IDisposable;
    private metadataInFlight = new Set<string>();
    private transpileTimer?: ReturnType<typeof setTimeout>;
    private transpileInFlight?: Promise<void>;
    private metadataTimer?: ReturnType<typeof setTimeout>;

    javascriptCode: string;
    oldTypescriptCode: string;
    private onTranspileFinished?: (javascriptCode: string) => void;
    private onLanguageChangedCallback?: (language: string) => void;

    constructor(container, initialSettings, actionCallbacks, instanceSettings) {
        super(container, initialSettings, actionCallbacks, instanceSettings);
        this.initialize();
        this.monacoEditor.updateOptions({
            glyphMargin: true,
        });

        this.monacoEditor.onDidChangeModelContent((e) => {
            if (this._instanceSettings.language === Languages.TwxTypescript) {
                // transpiling on every keystroke is wasteful and results could arrive out of order
                clearTimeout(this.transpileTimer);
                this.transpileTimer = setTimeout(() => {
                    this.transpileTimer = undefined;
                    this.runTranspile();
                }, 150);
            }
            if (this._instanceSettings.language == Languages.TwxTypescript || this._instanceSettings.language == Languages.TwxJavascript) {
                // a "." or "]" is the moment the user needs typings, so look immediately
                if (e.changes && e.changes[0] && (e.changes[0].text == "." || e.changes[0].text == "]")) {
                    clearTimeout(this.metadataTimer);
                    this.addMetadataForReferencedEntities();
                } else {
                    // pasted code, undo/redo or edits elsewhere also change the referenced entities
                    clearTimeout(this.metadataTimer);
                    this.metadataTimer = setTimeout(() => this.addMetadataForReferencedEntities(), 500);
                }
            }
        });
        this.addMetadataForReferencedEntities();
        if (this._instanceSettings.language === Languages.TwxTypescript) {
            this.transpileTypeScript();
        }

        this.addEditorSwitchLanguageAction();
    }

    private addEditorSwitchLanguageAction() {
        if(this._instanceSettings.language == Languages.TwxJavascript) {
            this.languageSwitchAction = this.monacoEditor.addAction({
                id: "toggleTypescript",
                label: "Switch to TypeScript",
                run: () => {
                    this.languageSwitchAction.dispose();
                    this.changeLanguage(Languages.TwxTypescript, this.oldTypescriptCode ? this.oldTypescriptCode : this.monacoEditor.getModel().getValue());
                    this.addEditorSwitchLanguageAction();
                }
            });
        } else if(this._instanceSettings.language == Languages.TwxTypescript) {
            this.languageSwitchAction = this.monacoEditor.addAction({
                id: "toggleJavascript",
                label: "Switch to JavaScript",
                run: async () => {
                    await this.transpileTypeScript();
                    this.languageSwitchAction.dispose();
                    this.changeLanguage(Languages.TwxJavascript, this.javascriptCode);
                    this.addEditorSwitchLanguageAction();
                    this.showNotice("ThingWorx does not keep the TypeScript source once the service is saved as JavaScript. Switching back only works until you press Done or Save.");
                }
            });
        }
        if(this.onLanguageChangedCallback) {
            this.onLanguageChangedCallback(this._instanceSettings.language);
        }
    }

    private inlayHintsTimer?: ReturnType<typeof setTimeout>;

    /**
     * Monaco asks the language service for inlay hints on edits only, not when new typings are added. Switching the option
     * off and on makes it ask again.
     */
    private refreshInlayHints() {
        clearTimeout(this.inlayHintsTimer);
        this.inlayHintsTimer = setTimeout(() => {
            try {
                const editor = this.monacoEditor;
                if (!editor || !editor.getModel() || editor.getModel().isDisposed()) {
                    return;
                }
                const current = editor.getOption(monaco.editor.EditorOption.inlayHints);
                if (current.enabled === "off") {
                    return;
                }
                editor.updateOptions({ inlayHints: { enabled: "off" } });
                setTimeout(() => {
                    if (editor.getModel() && !editor.getModel().isDisposed()) {
                        editor.updateOptions({ inlayHints: { enabled: current.enabled } });
                    }
                }, 0);
            } catch (e) {
                // hints are cosmetic
            }
        }, 200);
    }

    /** Shows a short message at the cursor (Monaco's message bubble), falling back to the console */
    private showNotice(message: string) {
        try {
            const controller: any = this.monacoEditor.getContribution("editor.contrib.messageController");
            const position = this.monacoEditor.getPosition();
            if (controller && position) {
                controller.showMessage(message, position);
                return;
            }
        } catch (e) {
            // fall through to the console
        }
        console.warn("Monaco: " + message);
    }

    private runTranspile(): Promise<void> {
        const run = this.transpileTypeScript().finally(() => {
            if (this.transpileInFlight === run) {
                this.transpileInFlight = undefined;
            }
        });
        this.transpileInFlight = run;
        return run;
    }

    /**
     * Makes sure the JavaScript matches the latest TypeScript: runs a debounced transpile now and waits for one in progress.
     * Returns undefined when there is nothing to wait for, so callers can stay synchronous in that case.
     * Call before the editor is saved or closed, because dispose() drops a pending transpile.
     */
    public flushTranspile(): Promise<void> | undefined {
        if (this.transpileTimer !== undefined) {
            clearTimeout(this.transpileTimer);
            this.transpileTimer = undefined;
            return this.runTranspile();
        }
        return this.transpileInFlight;
    }

    private async transpileTypeScript() {
        // the editor can be disposed while we await the worker (e.g. the user pressed Done), so never re-read the model afterwards
        const model = this.monacoEditor.getModel();
        if (model == undefined) return;
        this.oldTypescriptCode = model.getValue(monaco.editor.EndOfLinePreference.LF);
        const versionId = model.getVersionId();
        const worker = await monaco.languages.typescript.getTypeScriptWorker();
        // if there is an uri available
        if(!model.uri || model.isDisposed()) {
            return;
        }
        const client = await worker(model.uri);
        if (model.isDisposed()) {
            return;
        }
        const emitOutput = await client.getEmitOutput(model.uri.toString());
        if (model.isDisposed() || model.getVersionId() !== versionId) {
            // the code changed while the worker was busy; a newer transpile owns the result
            return;
        }
        this.javascriptCode = emitOutput.outputFiles[0].text;
        if(this.onTranspileFinished) {
            this.onTranspileFinished(this.javascriptCode);
        }
    };

    /**
     * getValue - Get the latest value. This is either the written code or the transpiled one
     */
    public getValue(): string {
        if(this._instanceSettings.language == Languages.TwxTypescript) {
            return this.javascriptCode;
        } else {
            return super.getValue();
        }
    }

    /**
     * Listen to results of transpilation of typescript to javascript
     * @param callback Action to execute when the transpilation is finished
     */
    public onLanguageChanged(callback: (javascriptCode: string) => void) {
        this.onLanguageChangedCallback = callback;
    }

    /**
     * Listen to results of transpilation of typescript to javascript
     * @param callback Action to execute when the transpilation is finished
     */
    public onEditorTranspileFinished(callback: (javascriptCode: string) => void) {
        this.onTranspileFinished = callback;
    }

    public async addMetadataForReferencedEntities() {
        let referencedEntities = await this.getEntitiesInCode(this._instanceSettings.language);
        const libsBefore = Object.keys(this.workerManager.libNames).length;
        try {
            await this.loadEntityTypings(referencedEntities);
        } finally {
            // hints computed before the typings arrived (e.g. for Things["X"]) would stay wrong until the next edit
            if (Object.keys(this.workerManager.libNames).length !== libsBefore) {
                this.refreshInlayHints();
            }
        }
    }

    private async loadEntityTypings(referencedEntities) {
        for (let collection in referencedEntities) {
            for (let entity in referencedEntities[collection]) {
                let entityName = collection + sanitizeEntityName(entity);
                if (!this.workerManager.containsLib("thingworx/" + entityName + ".d.ts") && !this.metadataInFlight.has(entityName)) {
                    this.metadataInFlight.add(entityName);
                    try {
                        // the typings are thrown away when the editor closes, so reuse them for a few minutes
                        const cached = TypescriptCodeEditor.entityTypingsCache.get(entityName);
                        if (cached && Date.now() - cached.time < ENTITY_TYPINGS_TTL_MS) {
                            this.registerEntityDefinitionLibrary(cached.definition, collection, entity);
                            continue;
                        }
                        const missingSince = TypescriptCodeEditor.missingEntityCache.get(entityName);
                        if (missingSince !== undefined && Date.now() - missingSince < ENTITY_TYPINGS_TTL_MS) {
                            continue;
                        }
                        // add the metadata only if it does not exist
                        let metadata = await getEntityMetadata(collection, entity);
                        let propertyData: any = {};
                        if(metadata && collection == "Things") {
                            propertyData = await getThingPropertyValues(entity);
                        }
                        if (metadata) {
                            // generate the typescript definition
                            let entityTypescriptDef = this.codeTranslator.generateTypeScriptDefinitions(metadata, propertyData, entityName, true, true);
                            TypescriptCodeEditor.entityTypingsCache.set(entityName, { definition: entityTypescriptDef, time: Date.now() });
                            // add the typescript definition for this entity
                            this.registerEntityDefinitionLibrary(entityTypescriptDef, collection, entity);
                        } else {
                            TypescriptCodeEditor.missingEntityCache.set(entityName, Date.now());
                            console.warn(`Monaco: Failed getting metadata for entity ${collection}[${entity}]. Maybe it does not exist?`);
                        }
                    } catch (e) {
                        // one failing entity must not stop the typings of the entities after it
                        console.warn(`Monaco: Failed loading typings for entity ${collection}[${entity}]`, e);
                    } finally {
                        this.metadataInFlight.delete(entityName);
                    }
                }
            }
        }
    }

    /**
     * Registers a typescript definition in the extra serviceLibs
     * If it already exists, updates it
     */
    public registerEntityDefinitionLibrary(typescriptMetadata, entityType, entityId) {
        let entityName = entityType + sanitizeEntityName(entityId);
        // declare the entity under its collection
        typescriptMetadata += "\ndeclare namespace twx {\n";
        typescriptMetadata += `\texport interface ${entityType}Collection {\n`;
        typescriptMetadata += `\t'${entityId}': twx.${entityName};\n`;
        if(entityType == "Things") {
            typescriptMetadata += `\t [entityName: string]: twx.GenericThing;\n`;
        }
        // close the class declaration
        typescriptMetadata += "}\n";
        // close the namespace declaration
        typescriptMetadata += "}\n";

        this.workerManager.addExtraLib(typescriptMetadata, "thingworx/" + entityName + ".d.ts");
    }


    /**
     * Refreshes the definitions related to the me context
     * @param serviceModel the thingworx service model
     */
    public refreshMeDefinitions(meThingModel: {id: string, entityType: string, effectiveShape: any, propertyData: any, serviceDefinition: any, events?: { [alias: string]: any[] }}) {
        // if we have a valid entity name and the effectiveShape is set
        if (meThingModel.id && meThingModel.effectiveShape) {
            var entityName = meThingModel.entityType + "" + sanitizeEntityName(meThingModel.id);
            // we append an me in here, just in case the definition is already added by the autocomplete in another service
            var fileName = "thingworx/" + entityName + "Me.d.ts";
            this.workerManager.addExtraLib(this.codeTranslator.generateTypeScriptDefinitions(
                meThingModel.effectiveShape, meThingModel.propertyData, entityName, false, true), fileName);
            // in the current globals we have me declarations as well as input parameters
            this.workerManager.addExtraLib(this.codeTranslator.generateServiceGlobals(
                meThingModel.serviceDefinition, entityName, meThingModel.events), "thingworx/currentGlobals.d.ts");
        }
    }

      /**
     * Uses the typescript compiler API to generate a list of all the entities referenced in a
     * file and their types
     * @param {*} code Javascript/Typescript code to analyze
     */
    private async getEntitiesInCode(mode) {
        const model = this.monacoEditor.getModel();
        if (model) {
            let worker = mode == Languages.TwxJavascript ?
                await monaco.languages.typescript.getJavaScriptWorker() :
                await monaco.languages.typescript.getTypeScriptWorker();
            if (model.isDisposed()) {
                return {};
            }
            let client = await worker(model.uri);
            return await (client as any).getPropertiesOrAttributesOf(model.uri.toString(), ENTITY_TYPES);
        } else {
            return {};
        }
    }

    public dispose() {
        clearTimeout(this.transpileTimer);
        clearTimeout(this.metadataTimer);
        clearTimeout(this.inlayHintsTimer);
        super.dispose();
        this.workerManager.disposeAllLibs();
    }

    private async initialize() {
        this.workerManager = new WorkerScriptManager(monaco.languages.typescript.typescriptDefaults,
            monaco.languages.typescript.javascriptDefaults);
        // set the compiler options
        this.workerManager.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES5,
            allowNonTsExtensions: true,
            noLib: true,
            newLine: monaco.languages.typescript.NewLineKind.LineFeed
        });
        this.codeTranslator = new ThingworxToTypescriptGenerator(this.workerManager);
        // generate the completion for language snippets
        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxJavascript, {
            provideCompletionItems: async function (model, position) {
                const wordUntil = model.getWordUntilPosition(position);
                const defaultRange = new monaco.Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);
                return loadSnippets((await import("../../configs/javascriptSnippets.json")).default, defaultRange);
            }
        }));

        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxTypescript, {
            provideCompletionItems: async  function (model, position) {
                const wordUntil = model.getWordUntilPosition(position);
                const defaultRange = new monaco.Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);
                return loadSnippets((await import("../../configs/typescriptSnippets.json")).default, defaultRange);
            }
        }));

        // generate the completion for twx snippets
        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxJavascript, {
            provideCompletionItems: async function (model, position) {
                const wordUntil = model.getWordUntilPosition(position);
                const defaultRange = new monaco.Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);
                return loadSnippets((await import("../../configs/thingworxJavascriptSnippets.json")).default, defaultRange);
            }
        }));
        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxTypescript, {
            provideCompletionItems: async function (model, position) {
                const wordUntil = model.getWordUntilPosition(position);
                const defaultRange = new monaco.Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);
                return loadSnippets((await import("../../configs/thingworxTypescriptSnippets.json")).default, defaultRange);
            }
        }));
        // generate the regex that matches the autocomplete for the entity collection for element access
        // for example Things["test
        let entityElementAccessRegex = new RegExp("(?:^|[^\\w$.])(" + ENTITY_TYPES.join("|") + ")\\[['\"]([^'\"\\]]*)$");
        // generate the regex that matches the autocomplete for the entity collection for property access
        // for example Things.test
        let entityPropertyAccessRegex = new RegExp("(?:^|[^\\w$.])(" + ENTITY_TYPES.join("|") + ")\\.([^\\.]*)$");
        // this handles on demand code completion for Thingworx entity names
        const completionProvider = {
            triggerCharacters: ["[", "[\"", "."],
            provideCompletionItems: async (model, position, _context, token) => {
                const wordUntil = model.getWordUntilPosition(position);
                const defaultRange = new monaco.Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);

                // find out if we are completing on a entity collection. Get the line until the current position
                let textUntilPosition = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column));
                let isPropertyCompletion = false;
                // matches if we have at the end of our line an entity definition. example: Things["gg"]
                let match = textUntilPosition.match(entityElementAccessRegex);
                // if that did not match, then test if it's property access. example: Things.gg
                if (!match) {
                    match = textUntilPosition.match(entityPropertyAccessRegex);
                    isPropertyCompletion = true;
                }
                if (match) {
                    // get metadata for this
                    let entityType = match[1];
                    let entitySearch = match[2];
                    // wait a little so a burst of keystrokes sends one search, and abort it when Monaco cancels the request
                    await new Promise((resolve) => setTimeout(resolve, 150));
                    if (token.isCancellationRequested) {
                        return { suggestions: [] };
                    }
                    const abortController = new AbortController();
                    token.onCancellationRequested(() => abortController.abort());
                    return spotlightSearch(entityType, entitySearch, abortController.signal).then((infotable) => {
                        let result: monaco.languages.CompletionItem[] = [];
                        for (let row of infotable.rows) {
                            // look in the entity collection libs and skip the elements already in there
                            let entityName = entityType + sanitizeEntityName(row.name);
                            if (this.workerManager.containsLib("thingworx/" + entityName + ".d.ts")) {
                                continue;
                            }
                            // also filter out the entities with dots or are not valid if auto-completing
                            // using property completion
                            if (isPropertyCompletion && row.name.match(DISALLOWED_ENTITY_CHARS)) {
                                continue;
                            }
                            // add to the result list
                            result.push({
                                label: row.name,
                                kind: monaco.languages.CompletionItemKind.Field,
                                documentation: row.description,
                                detail: "Entity type: " + row.type,
                                insertText: row.name,
                                range: defaultRange
                            });
                        }
                        return { suggestions: result };
                    }).catch((error) => {
                        // an aborted search is expected; anything else must not break the other completion providers
                        if (error?.name !== "AbortError") {
                            console.warn("Monaco: entity name search failed", error);
                        }
                        return { suggestions: [] };
                    });
                }
                return { suggestions: [] };
            }
        };
        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxJavascript, completionProvider));
        this.disposables.push(monaco.languages.registerCompletionItemProvider(Languages.TwxTypescript, completionProvider));
        // register the rhino es5 library
        this.workerManager.addExtraLib((await import("../../configs/lib.rhino.es5.d.ts?raw")).default, "lib.rhino.es5.d.ts");
        // register the thingworx base types and the logger class
        this.workerManager.addExtraLib((await import("../../configs/declarations/ThingworxBaseTypes.d.ts?raw")).default, "ThingworxBaseTypes.d.ts");
        // register the thingworx datashape library
        this.workerManager.addExtraLib((await import("../../configs/declarations/ThingworxDataShape.d.ts?raw")).default, "ThingworxDataShape.d.ts");

        // register the thingworx generic thing
        this.codeTranslator.generateGenericThingDefinition();
        // we regenerate all the datashape definitions when a new editor loads
        this.codeTranslator.generateDataShapeCode();
        this.codeTranslator.generateScriptFunctionLibraries();
        this.codeTranslator.registerEntityCollectionDefs();
    }

}
