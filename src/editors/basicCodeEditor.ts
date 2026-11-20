import * as monaco from "monaco-editor";
import { FormattingConflicts } from "monaco-editor/esm/vs/editor/contrib/format/browser/format";
import tingle from "tingle.js";
import { Options as PrettierOptions } from "prettier";
import { MonacoPrettier } from "./prettier";
import { applyScriptIndentationRules } from "./languageConfiguration";
import { MONACO_EDITOR_CONFIGURATION_MODEL, PRETTIER_LANGUAGES, diffFromDefaultSettings, modelUriParts } from "../constants";

require("tingle.js/src/tingle.css");
require("../styles/editorStyle.css");

export interface ActionCallbacks {
    onPreferencesChanged: (newPreferences: any) => void;
}

export interface MonacoEditorSettings {
    editor: monaco.editor.IStandaloneEditorConstructionOptions;
    diffEditor: monaco.editor.IDiffEditorConstructionOptions;
    thingworx: any;
    prettier: {
        enabled: boolean;
        options: PrettierOptions;
    };
}

export interface MonacoInstanceSettings {
    code: string;
    language: string;
    readonly: boolean;
    modelName: string;
}

export interface EditorPosition {
    line: number;
    ch: number;
}

export class MonacoCodeEditor {
    private modals = [];
    disposables: monaco.IDisposable[] = [];
    monacoEditor: monaco.editor.IStandaloneCodeEditor;
    _currentEditorSettings: MonacoEditorSettings;
    _instanceSettings: MonacoInstanceSettings;

    public state = {
        msg: {
            gutterId: "",
            hasGutter: true,
            marked: [],
            messages: [],
        },
    };

    /**
     * Creates a new monaco editor in the given container
     * @param container HTMLElement where to initialize the new editor
     * @param initialSettings The initial options that the editor should be initialized with
     */
    constructor(
        container: HTMLElement,
        initialSettings: MonacoEditorSettings,
        actionCallbacks: ActionCallbacks,
        instanceSettings: MonacoInstanceSettings
    ) {
        applyScriptIndentationRules();
        this._currentEditorSettings = initialSettings;
        this._instanceSettings = instanceSettings;
        // clone the settings and store them
        const editorSettings: MonacoEditorSettings = JSON.parse(JSON.stringify(initialSettings));
        editorSettings.editor.automaticLayout = true;
        editorSettings.editor.value = instanceSettings.code;
        editorSettings.editor.readOnly = instanceSettings.readonly;
        editorSettings.editor.language = instanceSettings.language;
        const modelUri = MonacoCodeEditor.getModelUri(instanceSettings.modelName);
        // a leftover model from an editor that was not disposed in time would make createModel throw
        monaco.editor.getModel(modelUri)?.dispose();
        editorSettings.editor.model = monaco.editor.createModel(
            instanceSettings.code,
            instanceSettings.language,
            modelUri
        );
        this.applyIndentationOptions(editorSettings.editor.model, editorSettings.editor);

        // The providers must exist BEFORE the editor is created: Monaco's formatOnPaste contribution only attaches its
        // paste listener if a range formatter is already registered when it is constructed.
        this.registerPrettierProviders(this._instanceSettings.language);

        this.monacoEditor = monaco.editor.create(container, editorSettings.editor);
        // Monaco's own formatOnPaste contribution ends up without a paste listener in this setup (it only evaluates
        // it on model/config events), so format the pasted range ourselves.
        this.disposables.push(
            this.monacoEditor.onDidPaste(async ({ range }) => {
                if (
                    !this._currentEditorSettings.editor?.formatOnPaste ||
                    this.monacoEditor.getOption(monaco.editor.EditorOption.readOnly) ||
                    range.startLineNumber === range.endLineNumber ||
                    !this.monacoEditor.getAction("editor.action.formatSelection")?.isSupported()
                ) {
                    return;
                }
                this.monacoEditor.setSelection(range);
                await this.monacoEditor.getAction("editor.action.formatSelection").run();
                const selection = this.monacoEditor.getModel() && this.monacoEditor.getSelection();
                if (selection) {
                    // like a normal paste, leave the cursor at the end of the pasted text
                    this.monacoEditor.setPosition(selection.getEndPosition());
                }
            })
        );
        this.initializePreferenceEditor(actionCallbacks.onPreferencesChanged);
        this.initializeDiffEditor();
        this.monacoEditor.layout();
        this.monacoEditor.focus();
    }

    /**
     * Inserts the given text at the current cursor position.
     */
    public insertText(code: string, keepSelection = false) {
        // Keep track of cursor position to highlight the code after inserting it
        const currentSelection = this.monacoEditor.getSelection();
        const op = {
            range: currentSelection,
            text: code,
            forceMoveMarkers: true,
        };
        this.monacoEditor.pushUndoStop();
        this.monacoEditor.executeEdits("insertSnippet", [op]);
        if (keepSelection) {
            // Highlight the code after inserting it
            this.monacoEditor.setSelection(
                monaco.Selection.fromPositions(currentSelection.getStartPosition(), this.monacoEditor.getPosition())
            );
        }
        this.monacoEditor.pushUndoStop();
    }

    /**
     * Bring focus onto the text editor
     */
    public focus() {
        this.monacoEditor.focus();
    }

    public undo() {
        this.monacoEditor.trigger("external", "undo", undefined);
    }

    public redo() {
        this.monacoEditor.trigger("external", "redo", undefined);
    }

    /**
     * Indents the current selection by 1 tab
     */
    public indentSelection() {
        this.monacoEditor.trigger("external", "editor.action.indentLines", undefined);
    }

    /**
     * Outdent the current selection by 1 tab
     */
    public outdentSelection() {
        this.monacoEditor.trigger("external", "editor.action.outdentLines", undefined);
    }

    /**
     * Comment the current selection
     */
    public commentSelection() {
        this.monacoEditor.trigger("external", "editor.action.addCommentLine", undefined);
    }

    /**
     * Uncomment the current selection
     */
    public uncommentSelection() {
        this.monacoEditor.trigger("external", "editor.action.removeCommentLine", undefined);
    }

    /**
     * Format the current selected code
     */
    public autoFormatSelection() {
        this.monacoEditor.trigger("external", "editor.action.formatSelection", undefined);
    }

    /**
     * Format the current selected code
     */
    public autoFormatDocument() {
        this.monacoEditor.trigger("external", "editor.action.formatDocument", undefined);
    }

    /**
     * Fold all the current folding indicators
     */
    public foldAll() {
        this.monacoEditor.trigger("external", "editor.foldAll", undefined);
    }

    /**
     * Unfold all the folding indicators
     */
    public unfoldAll() {
        this.monacoEditor.trigger("external", "editor.unfoldAll", undefined);
    }

    /**
     * Indentation is a model option in Monaco, `editor.updateOptions` doesn't change it for an existing model.
     * Explicit tabSize/insertSpaces from the settings disable indentation detection, unless the user
     * explicitly asked for detection.
     */
    private applyIndentationOptions(model: monaco.editor.ITextModel | undefined, options?: monaco.editor.IGlobalEditorOptions) {
        if (!model || !options) {
            return;
        }
        const modelOptions: monaco.editor.ITextModelUpdateOptions = {};
        if (options.tabSize != null) {
            modelOptions.tabSize = options.tabSize;
        }
        if (options.insertSpaces != null) {
            modelOptions.insertSpaces = options.insertSpaces;
        }
        if (Object.keys(modelOptions).length > 0 && options.detectIndentation !== true) {
            model.updateOptions(modelOptions);
        } else if (options.detectIndentation === true) {
            model.detectIndentation(options.insertSpaces ?? true, options.tabSize ?? 4);
        }
    }

    /**
     * Set the editor as read-only or not
     */
    public setReadOnlyStatus(readOnly: boolean) {
        this.monacoEditor.updateOptions({
            readOnly: readOnly,
        });
    }

    /**
     * Set the editor settings externally
     */
    public setEditorSettings(settings: monaco.editor.IEditorConstructionOptions) {
        this.monacoEditor.updateOptions(settings);
    }

    /**
     * Builds the model URI without parsing, so a name containing "#" or "?" is not cut off as a fragment or query
     * (which would make two different subscriptions or services share a URI).
     */
    public static getModelUri(modelName: string): monaco.Uri {
        return monaco.Uri.from(modelUriParts(modelName));
    }

    /**
     * Dispose of the given editor, and release all models and used resources
     */
    public dispose() {
        if (this.monacoEditor.getModel()) {
            this.monacoEditor.getModel().dispose();
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const modal of this.modals) {
            modal.destroy();
        }
        this.monacoEditor.dispose();
    }

    /**
     * Opens the editor configuration panel
     */
    public openConfiguration() {
        this.monacoEditor.trigger("external", "viewConfAction", undefined);
    }

    /**
     * Instructs the editor to remeasure its container. This method should
     * be called when the container of the editor gets resized.
     */
    public containerWasResized() {
        this.monacoEditor.layout();
    }

    /**
     * Scroll vertically or horizontally as necessary and reveal a position centered vertically.
     */
    public scrollCodeTo(lineNumber: number, column: number) {
        const position = {
            lineNumber: lineNumber || 0,
            column: column || 0,
        };
        this.monacoEditor.revealPositionInCenter(position);
        this.monacoEditor.setPosition(position);
    }

    public setViewState(viewState: monaco.editor.ICodeEditorViewState) {
        this.monacoEditor.restoreViewState(viewState);
    }

    /**
     * Get the monaco editor view state as a serialized JSON
     */
    public getViewState() {
        return this.monacoEditor.saveViewState();
    }

    /**
     * Changes the language of the editor to the given language.
     * @param language Language to set
     */
    /**
     * Registers the Prettier formatters for a language. Called for the initial language and again when the
     * language switches (JS <-> TS), otherwise Format Document would use the built-in formatter after a switch.
     */
    private registerPrettierProviders(language: string) {
        if (
            this._currentEditorSettings.prettier?.enabled &&
            PRETTIER_LANGUAGES.includes(language)
        ) {
            const monacoPrettier = new MonacoPrettier(() => this._currentEditorSettings.prettier.options);
            this.disposables.push(monaco.languages.registerDocumentFormattingEditProvider(language, monacoPrettier));
            this.disposables.push(monaco.languages.registerDocumentRangeFormattingEditProvider(language, monacoPrettier));
            // Because of https://github.com/microsoft/vscode/blob/main/src/vs/editor/editor.api.ts#L19-L21
            // The first formatter is selected, which is the builtin worker one
            // We must always select the "prettier" formatter, so overwrite it here
            FormattingConflicts.setFormatterSelector((formatters) => {
                const prettierFormatter = formatters.find((f) => f instanceof MonacoPrettier);
                if (prettierFormatter) {
                    return Promise.resolve(prettierFormatter);
                }
                // otherwise just select the first one
                return Promise.resolve(formatters[0]);
            });
        }
    }

    public changeLanguage(language: string, code: string) {
        if (this._instanceSettings.language != language) {
            this.monacoEditor.getModel().dispose();
            let model = monaco.editor.createModel(
                code,
                language,
                MonacoCodeEditor.getModelUri(this._instanceSettings.modelName)
            );
            this.applyIndentationOptions(model, this._currentEditorSettings.editor);
            this.monacoEditor.setModel(model);
            this._instanceSettings.language = language;
            this.registerPrettierProviders(language);
        }
    }

    /**
     * Called whenever the contents of the code editor have been changed.
     */
    public onEditorContentChange(callback: (code: string) => void) {
        this.monacoEditor.onDidChangeModelContent(() => {
            callback(this.monacoEditor.getModel().getValue(monaco.editor.EndOfLinePreference.LF));
        });
    }

    /**
     * Called whenever the editor is focused
     */
    public onEditorFocused(callback: () => void) {
        this.monacoEditor.onDidFocusEditorText(() => {
            callback();
        });
    }

    /**
     * Gets the current text in the monaco editor
     */
    public getValue(): string {
        // This may get called when no model is initialized. In that case, return an empty string
        return this.monacoEditor.getModel()?.getValue(monaco.editor.EndOfLinePreference.LF) || "";
    }

    /**
     * Sets some code in the editor
     * @param code Code to set in the editor
     */
    public setValue(code: string): void {
        const model = this.monacoEditor.getModel();
        if (!model) {
            this.monacoEditor.setValue(code);
            return;
        }
        if (model.getValue() === code) {
            return;
        }
        // an edit instead of setValue keeps the undo history (setValue wipes it)
        this.monacoEditor.pushUndoStop();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
        this.monacoEditor.pushUndoStop();
    }

    /**
     * Perform global initialization of the monaco json
     */
    public static async performGlobalInitialization() {
        const workerPaths = {
            json: "json.worker.bundle.js",
            css: "./css.worker.bundle.js",
            typescript: "ts.worker.bundle.js",
            javascript: "ts.worker.bundle.js",
            editorWorkerService: "editor.worker.bundle.js",
        };

        function stripTrailingSlash(str) {
            return str.replace(/\/$/, "");
        }

        function stripUrlCredentials(str: string) {
            try {
                // a relative path (the runtime widget uses "../Common/extensions/...") is relative to the page, not to the origin
                const url = new URL(str, str ? window.location.href : window.location.origin);
                url.username = "";
                url.password = "";
                return url.toString();
            } catch (e) {
                return str;
            }
        }

        const publicPath = stripUrlCredentials(typeof __webpack_public_path__ === "string" ? __webpack_public_path__ : "");

        (window as any).MonacoEnvironment = {
            globalAPI: true,
            getWorkerUrl: function (moduleId, label) {
                const pathPrefix = publicPath;
                const result = (pathPrefix ? stripTrailingSlash(pathPrefix) + "/" : "") + workerPaths[label];
                if (/^((http:)|(https:)|(file:)|(\/\/))/.test(result)) {
                    const currentOrigin = window.location.origin;
                    if (result.substring(0, currentOrigin.length) !== currentOrigin) {
                        const js = "/*" + label + '*/importScripts("' + result + '");';
                        const blob = new Blob([js], { type: "application/javascript" });
                        return URL.createObjectURL(blob);
                    }
                }
                return result;
            },
        };

        // Apply the editor configuration json schema
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            schemas: [
                {
                    uri: "http://monaco-editor/schema.json",
                    schema: (await import("../configs/confSchema.json")).default,
                    fileMatch: [MONACO_EDITOR_CONFIGURATION_MODEL],
                },
            ],
            allowComments: false,
            validate: true,
            enableSchemaRequest: true,
        });

        // Customize the typescript worker to add the methods needed by the script editor as well as CodeHost
        monaco.languages.typescript.typescriptDefaults.setWorkerOptions({
            customWorkerPath: publicPath + "tsCustomWorker.bundle.js",
        });
        monaco.languages.typescript.javascriptDefaults.setWorkerOptions({
            customWorkerPath: publicPath + "tsCustomWorker.bundle.js",
        });
    }

    /**
     * markText - creates an text decoration at the given position
     */
    public markText(
        from: EditorPosition,
        to: EditorPosition,
        options: {
            className: string;
            __annotation: { severity: string; message: any };
        }
    ) {
        if (from.ch + to.ch + from.line + to.line == 0) {
            from.line = from.ch = to.line = 1;
            to.ch = 1000;
        } else {
            // just increment everything
            from.line++;
            from.ch++;
            to.line++;
            to.ch++;
        }
        const decorations = this.monacoEditor.deltaDecorations(
            [],
            [
                {
                    range: new monaco.Range(from.line, from.ch, to.line, to.ch),
                    options: {
                        className: options.className,
                        isWholeLine: from.line == to.line && to.ch == 1000,
                        glyphMarginClassName: "CodeMirror-twxmsg-marker-" + options.__annotation.severity,
                        overviewRuler: <any>{
                            color: "red",
                        },
                        hoverMessage: [
                            {
                                value: options.__annotation.message,
                            },
                        ],
                        glyphMarginHoverMessage: {
                            value: options.__annotation.message,
                        },
                    },
                },
            ]
        );
        return {
            clear: () => this.monacoEditor.deltaDecorations(decorations, []),
        };
    }

    public clearGutter() {}

    public setGutterMarker() {}

    public hasFocus() {
        return this.monacoEditor.hasTextFocus();
    }

    // --- CodeMirror compatibility: Composer 10.x calls these on `this.codeMirror` ---

    /** Text of the current selection (CodeMirror: getSelectedText) */
    public getSelectedText(): string {
        const model = this.monacoEditor.getModel();
        const selection = this.monacoEditor.getSelection();
        return model && selection ? model.getValueInRange(selection) : "";
    }

    /** Cursor position in CodeMirror's 0-based {line, ch} form */
    public getCursor(start?: boolean | string): { line: number; ch: number } {
        const selection = this.monacoEditor.getSelection();
        const position = !selection
            ? this.monacoEditor.getPosition()
            : start === true || start === "from" || start === "start"
              ? selection.getStartPosition()
              : selection.getEndPosition();
        return { line: (position?.lineNumber ?? 1) - 1, ch: (position?.column ?? 1) - 1 };
    }

    /** Scrolls to a 0-based line and briefly highlights it (used by "go to line" from test output) */
    public highlightLine(line: number | { line: number }) {
        const lineNumber = (typeof line === "number" ? line : line?.line ?? 0) + 1;
        const model = this.monacoEditor.getModel();
        if (!model || lineNumber < 1 || lineNumber > model.getLineCount()) {
            return;
        }
        if (!document.getElementById("monaco-twx-highlight-style")) {
            const style = document.createElement("style");
            style.id = "monaco-twx-highlight-style";
            style.textContent = ".monaco-twx-highlight-line { background: rgba(255, 213, 0, 0.35); }";
            document.head.appendChild(style);
        }
        this.monacoEditor.revealLineInCenter(lineNumber);
        this.monacoEditor.setPosition({ lineNumber, column: 1 });
        const collection = this.monacoEditor.createDecorationsCollection([
            {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: { isWholeLine: true, className: "monaco-twx-highlight-line" },
            },
        ]);
        setTimeout(() => collection.clear(), 1500);
    }

    public openSearchPanel() {
        this.monacoEditor.trigger("external", "actions.find", undefined);
    }

    public closeSearchPanel() {
        this.monacoEditor.trigger("external", "closeFindWidget", undefined);
    }

    public getWrapperElement(): HTMLElement {
        return this.monacoEditor.getContainerDomNode();
    }

    public requestMeasure() {
        this.monacoEditor.layout();
    }

    public getCurrentState() {
        return this.monacoEditor.saveViewState();
    }

    /** CodeMirror 6 `dispatch` is not supported; ignore it instead of throwing */
    public dispatch(..._args: unknown[]) {
        console.warn("MonacoScriptEditor: codeMirror.dispatch is not supported");
    }

    public setCursor() {
        // ignored since it would trigger bad artifacts when editing css
    }

    private initializePreferenceEditor(onPreferencesChanged: (newPreferences: any) => void) {
        const self = this;

        let confEditor: monaco.editor.IStandaloneCodeEditor;
        let settingsModel: monaco.editor.ITextModel;
        let settingsAtOpen: string;
        let modal = new tingle.modal({
            cssClass: ["tingle-popup-container"],
            onOpen: function () {
                settingsAtOpen = JSON.stringify(self._currentEditorSettings);
                settingsModel = monaco.editor.createModel(
                    JSON.stringify(self._currentEditorSettings, undefined, 4),
                    "json",
                    monaco.Uri.parse(MONACO_EDITOR_CONFIGURATION_MODEL)
                );

                const contentElement = this.modalBoxContent.getElementsByClassName("content")[0];
                // The settings of the configuration editor are inherited from the current editor
                confEditor = monaco.editor.create(contentElement, {
                    ...self._currentEditorSettings.editor,
                    model: settingsModel,
                });
                contentElement.onkeydown =
                    contentElement.onkeypress =
                    contentElement.onkeyup =
                        (e) => e.stopPropagation();
                confEditor.focus();
                // whenever the model changes, we need to also update the current editor, as well as other editors
                confEditor.onDidChangeModelContent((e) => {
                    try {
                        // if the json is valid, then set it on this editor as well as the editor behind
                        const expandedOptions = JSON.parse(confEditor.getModel().getValue());
                        confEditor.updateOptions(expandedOptions.editor);
                        // theme has to be updated separately
                        if (
                            expandedOptions.editor &&
                            self._currentEditorSettings.editor.theme != expandedOptions.editor.theme
                        ) {
                            monaco.editor.setTheme(expandedOptions.editor.theme);
                        }
                        self.monacoEditor.updateOptions(expandedOptions.editor);
                        // indentation is a model option, so it has to be pushed to the model too
                        self.applyIndentationOptions(self.monacoEditor.getModel(), expandedOptions.editor);
                        self._currentEditorSettings = expandedOptions;
                    } catch (e) {
                        return false;
                    }
                    return true;
                });
            },
            onClose: function () {
                // propagate the preference changed to the parent for storage, etc
                // only when something changed, and only the values that differ from the defaults
                if (JSON.stringify(self._currentEditorSettings) !== settingsAtOpen) {
                    onPreferencesChanged(diffFromDefaultSettings(self._currentEditorSettings));
                }
                confEditor.dispose();
                settingsModel.dispose();
            },
        });
        this.modals.push(modal);
        // action triggered by CTRL+~
        // shows a popup with a json configuration for the editor
        this.monacoEditor.addAction({
            id: "viewConfAction",
            label: "View Configuration",
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Backquote],
            run: () => {
                modal.setContent(`<h2>Config Editor. Use Intellisense or check
                                    <a href='https://code.visualstudio.com/docs/getstarted/settings#_default-settings'>here</a> for available options.</h2>
                                <div class="content" style="height: 30vw"/>`);
                modal.open();
            },
        });
    }

    /**
     * Initialize the diff editor triggered by ctrl+k
     */
    private initializeDiffEditor(): void {
        let self = this;

        let diffEditor: monaco.editor.IStandaloneDiffEditor;
        let originalModel: monaco.editor.ITextModel;

        let modal = new tingle.modal({
            cssClass: ["tingle-popup-container"],
            onOpen: function () {
                originalModel = monaco.editor.createModel(
                    self._instanceSettings.code,
                    self._instanceSettings.language
                );
                let modifiedModel = self.monacoEditor.getModel();

                const editorSettings = Object.assign(
                    {},
                    self._currentEditorSettings.editor,
                    self._currentEditorSettings.diffEditor
                );
                // create the diff editor
                const contentElement = this.modalBoxContent.getElementsByClassName("content")[0];
                diffEditor = monaco.editor.createDiffEditor(contentElement, editorSettings);
                contentElement.onkeydown =
                    contentElement.onkeypress =
                    contentElement.onkeyup =
                        (e) => e.stopPropagation();

                diffEditor.setModel({
                    original: originalModel,
                    modified: modifiedModel,
                });
                diffEditor.focus();
            },
            onClose: function () {
                diffEditor.dispose();
                // the original model was created on open and would otherwise leak on every diff
                originalModel?.dispose();
            },
        });
        this.modals.push(modal);
        // action triggered by CTRL+K
        // shows a popup with a diff editor with the initial state of the editor
        // reuse the current model, so changes can be made directly in the diff editor
        this.monacoEditor.addAction({
            id: "viewDiffAction",
            label: "View Diff",
            contextMenuGroupId: "service",
            contextMenuOrder: 1.4,
            // a chord (Ctrl+K, D) so Monaco's other Ctrl+K chords (comment, fold, ...) keep working
            keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyD)],
            keybindingContext: null,
            run: (ed) => {
                modal.setContent(`<h2>Diff Editor</h2>
                            <div class="content" style="height: 30vw"/>`);
                modal.open();
            },
        });
    }
}

// perform the global initialization
MonacoCodeEditor.performGlobalInitialization();
