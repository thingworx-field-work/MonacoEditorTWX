import { Languages, MONACO_EDITOR_SETTINGS_KEY, mergeEditorSettings } from "./constants";
import { MonacoCodeEditor } from "./editors/basicCodeEditor";
import { ServiceEditor } from "./editors/serviceEditor/serviceEditor";
import { CssEditor } from "./editors/cssEditor/cssEditor";
import { TypescriptCodeEditor } from "./editors/typescript/typescriptCodeEditor";
import { getThingPropertyValues } from "./utilities";
import { hintErrorsToMarkers } from "./syntaxMarkers";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

enum EditorType {
    SERVICE_EDITOR = "service-editor",
    SUBSCRIPTION_EDITOR = "subscription-editor",
    EXPRESSION_EDITOR = "expression-editor",
    CSS_EDITOR = "css-editor",
    GENERIC_EDITOR = "generic-editor"
}

const SYNTAX_MARKER_OWNER = "twx-syntax-check";

const CODEMIRROR_GUTTER_MESSAGE_MANAGER =
    "thingworx-ui-platform/features/details/editor/codemirror-gutter-message-manager";

function getAmdContext() {
    const requirejs = window["requirejs"] || window["require"];
    return requirejs && requirejs.s && requirejs.s.contexts && requirejs.s.contexts._;
}

function getDefinedAmdModule(moduleName: string) {
    const context = getAmdContext();
    return context && context.defined ? context.defined[moduleName] : undefined;
}

function createNoopGutterMessageManager() {
    return {
        addByCategory() {},
        removeByCategory() {},
        clearByCategory() {},
        clear() {},
        add() {},
        remove() {},
    };
}

function resolveGutterMessageManager(container: any) {
    const moduleExport = getDefinedAmdModule(CODEMIRROR_GUTTER_MESSAGE_MANAGER);
    const gutterManagerClass = moduleExport && moduleExport.CodemirrorGutterMessageManager;
    if (gutterManagerClass) {
        try {
            return container.get(gutterManagerClass);
        } catch (e) {
            console.warn("Monaco: Failed to resolve CodemirrorGutterMessageManager. Using fallback...", e);
        }
    }

    return createNoopGutterMessageManager();
}

function load() {
    if (getDefinedAmdModule("thingworx-ui-platform/features/details/editor/abstract-editor")) {
        // Composer already created its own editor base class, a module that is defined twice keeps the first definition
        console.warn("Monaco: Composer loaded its own code editor before the Monaco bundle arrived, so Monaco cannot replace it on this page load. Reload the page; if this keeps happening the bundle is loading too slowly.");
    }
    window["define"](
      "thingworx-ui-platform/features/details/editor/abstract-editor",
      [
        "exports",
        "aurelia-i18n",
        "aurelia-dependency-injection",
        "lodash",
        "jquery",
        "thingworx-ui-platform/util/common-util",
        "thingworx-ui-platform/util/object-util",
        "thingworx-ui-platform/helpers/loader-helper",
        "thingworx-ui-platform/events/channel-events",
        "thingworx-ui-platform/events/event-helper",
        "thingworx-ui-platform/services/user-service",
        "thingworx-ui-platform/services/entity-service-base",
        "thingworx-ui-platform/helpers/hotkeys/hotkey-manager"
    ],
    function(exports, I18N, Container, _, $, CommonUtil, ObjectUtil, LoaderHelper, ChannelNames, EventHelper, u, EntityServiceBase, HotkeyManager) {
        var {UserSessionInfoKeys, UserPreferenceKeys} = u;
        I18N = I18N["I18N"];
        Container = Container["Container"];
        CommonUtil = CommonUtil["CommonUtil"];
        ObjectUtil = ObjectUtil["ObjectUtil"];
        LoaderHelper = LoaderHelper["LoaderHelper"];
        ChannelNames = ChannelNames["ChannelNames"];
        EventHelper = EventHelper["EventHelper"];
        EntityServiceBase = EntityServiceBase["EntityServiceBase"];
        HotkeyManager = Container.instance.get(HotkeyManager["HotkeyManager"]);

        LoaderHelper.importPlatformCss('/features/details/editor/codemirror-gutter-message.css');

        const SUPPORTED_LANG_MODES = [
            'javascript',
            'text/x-sql',
            'xml',
            'json',
            'css'
        ];

        // This class is presented as a ES5 class since it has to be extended by other ES5 classes
        // This is done because typescript does not support setting the compiler target for each individual file
        var AbstractEditor = /** @class */ (function () {
            function AbstractEditor(element, userService, _a) {
                var _this = this;
                var _b = _a === void 0 ? {} : _a, _c = _b.eventHelperGroupName, eventHelperGroupName = _c === void 0 ? undefined : _c, _d = _b.langMode, langMode = _d === void 0 ? undefined : _d, _e = _b.editorOptions, editorOptions = _e === void 0 ? undefined : _e, _f = _b.valueField, valueField = _f === void 0 ? 'value' : _f;
                this.TWX_MSG_GUTTER_ID = 'CodeMirror-twxmsg-markers';
                this.cursor = {
                    line: 0,
                    col: 0
                };
                this.action = '';
                this.actionHandler = this.editAction.bind(this);
                this._saveEditorViewState = (function () {
                    // wrapped in a try catch because if anything fails, the editor still needs to proceed
                    try {
                        var currentEditedModel = void 0;
                        if (_this.editorType == EditorType.SUBSCRIPTION_EDITOR) {
                            currentEditedModel = _this.entityModel.subscriptionsModel.edit;
                        }
                        else if (_this.editorType == EditorType.SERVICE_EDITOR) {
                            currentEditedModel = _this.entityModel.servicesModel?.editModel;
                        }
                        // The view state (cursor, scroll, folding) used to be written into the entity, which made exports and
                        // source control show a diff for every cursor move. Keep it in the browser instead.
                        var key = _this._getViewStateKey(currentEditedModel);
                        if (key && _this.codeMirror) {
                            localStorage.setItem(key, JSON.stringify(_this.codeMirror.getViewState()));
                            _this._trimStoredViewStates(key);
                        }
                    }
                    catch (ex) {
                        console.error("Error occurred while cleaning up monaco.", ex);
                    }
                });
                // Composer's server side syntax check reports errors through the CodeMirror 6 editor state. There is none here, and
                // reading it threw, so a real syntax error blocked Done with nothing shown but a console warning.
                this.editorState = {
                    addExtension: function (cm, name, extension) {
                        var hinter = [].concat(extension).find(function (item) { return item && typeof item.__twxHinter === "function"; });
                        if (hinter) {
                            _this._showSyntaxErrors(hinter.__twxHinter);
                        }
                    },
                    removeExtension: function () { _this._clearSyntaxErrors(); },
                    clearErrors: function () { _this._clearSyntaxErrors(); }
                };
                this.element = element;
                this.userService = userService;
                this.eventHelper = new EventHelper(eventHelperGroupName || 'AbstractCodeEditor');
                this.langMode = _.defaults(langMode, { name: 'javascript', globalVars: true });
                this.valueField = valueField;
                if (SUPPORTED_LANG_MODES.indexOf(this.langMode.name) === -1) {
                    throw new Error("Not supported language mode: ".concat(this.langMode.name || 'unknown'));
                }
                this._init(editorOptions);
            }

            //=======================================================================================================
            // == flowing can be used as protected methods in your subclasses =======================================
            AbstractEditor.prototype.attached = function() {
                $(this.element).find('.form-group').append($('<div class="editor-loading"></div>'));
                this.eventHelper.subscribe(ChannelNames.CODE_SYNTAX_CHECK, (opts) => {
                    // Composer validates before Save/Done, also for toolbar clicks; make sure the JavaScript is current first
                    let pending: Promise<void> | undefined;
                    try {
                        pending = this.codeMirror?.flushTranspile?.();
                    } catch (e) {
                        console.warn("Monaco: could not flush the pending transpile", e);
                    }
                    const check = () => this.checkSyntax(opts);
                    if (pending) {
                        pending.then(check, check);
                    } else {
                        check();
                    }
                });
                // when the JS_SYNTAX_CHECKED event is fired, it means we are close to saving
                this.eventHelper.subscribe(ChannelNames.JS_SYNTAX_CHECKED, this._saveEditorViewState.bind(this));
                this.eventHelper.subscribe(ChannelNames.PREFERENCE_CHANGED, this._preferenceChanged.bind(this));
                this._initCodeMirrorDebounced();
            }

            AbstractEditor.prototype._initCodeMirrorDebounced = function () {
                throw new Error("Method not implemented.");
            }

            AbstractEditor.prototype.detached = function() {
                // invalidate a running init (it awaits network calls) and drop a scheduled one
                this._monacoInitCounter = (this._monacoInitCounter || 0) + 1;
                this._initCodeMirrorDebounced?.cancel?.();
                this._cleanupCodeMirror();
                this.eventHelper.destroyAll();
                this.destroy();
            }

            AbstractEditor.prototype.readOnlyChanged = function(newVal, oldVal) {
                if (_.isUndefined(oldVal)) {
                    return;
                }
                this.readOnly = ObjectUtil.asBoolean(newVal) || false;
                if (this.codeMirror) {
                    // no need to rebuild the whole editor (and lose the undo history) just to toggle read-only
                    this.codeMirror.setReadOnlyStatus(this.readOnly);
                    return;
                }
                this._initCodeMirrorDebounced();
            }

            AbstractEditor.prototype.cursorChanged = function() {
                this._setCursor();
            }

            AbstractEditor.prototype.valueChanged = function() {
                this.refreshDisplay();
            }

            /**
             * Because the editor can initially be rendered inside a hidden div, this flag allows the editor to react when it becomes visible and
             * re-align all styles.
             *
             * @param newval {boolean}
             */
             AbstractEditor.prototype.visibleChanged = function(newval) {
                if (newval) {
                    this._initCodeMirrorDebounced();
                }
            }

            /**
             * Sometimes when setting the value programatically - codeMirror needs special processing
             * in order to refresh the display. There is a refresh method but it doesn't seem to be functioning.
             */
             AbstractEditor.prototype.refreshDisplay = function() {
                if (_.isNil(this._getValue())) {
                    return;
                }

                if (!this.codeMirror) {
                    this._initCodeMirrorDebounced();
                    return;
                }

                if (this.codeMirror.getValue() !== this._getValue()) {
                    if (this.langMode.name == Languages.TwxTypescript) {
                        // the editor holds TypeScript but the bound value is JavaScript (an external change such as a revert),
                        // so setting it would put JavaScript into the TypeScript model; rebuild from the service rows instead
                        this._initCodeMirrorDebounced();
                        return;
                    }
                    this.codeMirror.setValue(this._getValue());
                }
            }

            AbstractEditor.prototype.actionHandler = AbstractEditor.prototype.editAction = function (newVal) {
                if (!newVal) {
                    return;
                }

                let action = _.isString(newVal) ? newVal : newVal.action;
                switch (action) {
                    case 'UNDO':
                        this.undo();
                        break;

                    case 'REDO':
                        this.redo();
                        break;

                    case 'COMMENT':
                        this.codeMirror.commentSelection();
                        break;

                    case 'UNCOMMENT':
                        this.codeMirror.uncommentSelection();
                        break;

                    case 'INDENT-LEFT':
                        this.indentSelection(false);
                        break;

                    case 'INDENT-RIGHT':
                        this.indentSelection(true);
                        break;

                    case 'AUTO-FORMAT':
                        this.autoFormatSelection();
                        break;

                    case 'FIND':
                        //this.find(newVal.findString);
                        this.find();
                        break;

                    case 'REPLACE':
                        //this.replace(newVal.replaceString);
                        this.replace();
                        break;

                    //no longer called directly
                    case 'REPLACE-ALL':
                        this.replaceAll(newVal.findString, newVal.replaceString);
                        break;

                    case 'FOLD-ALL':
                        this._handleFolding('fold');
                        break;

                    case 'UNFOLD-ALL':
                        this._handleFolding('unfold');
                        break;

                    case 'CHECK-SYNTAX':
                        this.checkSyntax({closeEditorOnValid: false});
                        break;

                    case 'FONT-RESIZE':
                        this.showEditorConfiguration();
                        break;

                    case 'LINT':
                        this.setLinting(true);
                        this.lint(this.editorOptions);
                        break;

                    case 'NOLINT':
                        this.setLinting(false);
                        this.lint(this.editorOptions);
                        break;

                    default :
                        alert(action);
                        break;
                }
            }

            AbstractEditor.prototype.showEditorConfiguration = function(): any {
                if(this.codeMirror) {
                    this.codeMirror.openConfiguration();
                }
            }

            AbstractEditor.prototype.editorOptions = function(editorOptions: any): any {
                throw new Error("Method not implemented.");
            }

            AbstractEditor.prototype.initialized = function() {
                // override if you want this functionality;
            }

            AbstractEditor.prototype.destroy = function() {
                // override if you want this functionality;
            }

            AbstractEditor.prototype.undo = function() {
                this.codeMirror.undo();
            }

            AbstractEditor.prototype.redo = function() {
                this.codeMirror.redo();
            }

            AbstractEditor.prototype.commentSelection = function() {
                this.codeMirror.commentSelection();
            }

            AbstractEditor.prototype.unCommentSelection = function() {
                this.codeMirror.uncommentSelection();
            }

            AbstractEditor.prototype.checkSyntax = function(opts = {}) {
                console.assert(false, 'checkSyntax invoked by not implemented!');
            }

            AbstractEditor.prototype.lint = function(opts = {}) {
                // override if you want this functionality;
            };

            AbstractEditor.prototype.setLinting = function(lint) {
                // override if you want this functionality;
            }

            AbstractEditor.prototype.getLinting = function() {
                return false;
            }

            AbstractEditor.prototype.cursorActivity = function(cm, event) {
                // override if you want this functionality;
            }

            AbstractEditor.prototype.keydown = function(cm, event) {
                // override if you want this functionality;
                // _.get (not _.has): entityModel is an Aurelia getter on the prototype, which _.has doesn't see.
                // In the subscription editor servicesModel.editModel still names the last service, so only publish for services.
                const serviceName = this.editorType == EditorType.SERVICE_EDITOR
                    ? _.get(this, 'entityModel.servicesModel.editModel.name')
                    : undefined;
                if (serviceName) {
                    this.eventHelper.publish(ChannelNames.ENTITY_DETAIL_CHANGE, {
                        action:      'code updated',
                        category:    'services',
                        entityModel: this.entityModel,
                        objectName:  serviceName
                    });
                }
            }

            AbstractEditor.prototype.blur = function(cm, event) {
                // override if you want this functionality;
            }

            AbstractEditor.prototype.indentSelection = function(dir) {
                if(dir) {
                    this.codeMirror.indentSelection();
                } else {
                    this.codeMirror.outdentSelection();
                }
            }

            AbstractEditor.prototype.autoFormatSelection = function() {
                this.codeMirror.autoFormatSelection();
            }

            AbstractEditor.prototype.find = function() {
                alert("Use the editor shortcut! CTRL+F");
            }

            AbstractEditor.prototype.replace = function() {
                alert("Use the editor shortcut! CTRL+R");
            }

            AbstractEditor.prototype.replaceAll = function(findString, replaceString) {
                alert("Use the editor shortcut!");
            }

            AbstractEditor.prototype.insertTextIntoEditor = function({text, keepSelected = true}) {
                this.codeMirror.insertText(text, keepSelected);
                this.codeMirror.focus();
            }

            //================================================================================================================
            //== following should be treated as private methods and subject to change without notifiying =====================
            AbstractEditor.prototype._init = function(opts) {
                let container = Container.instance || new Container();
                this.gutterMsgManager = resolveGutterMessageManager(container);
                this.entityService = container.get(EntityServiceBase);
                this.i18n = container.get(I18N);
                this._setGuttersOption();
                this._initCodeMirrorDebounced = _.debounce(this._initCodeMirror.bind(this), 150);
            }

            AbstractEditor.prototype._setGuttersOption = function() {
            }

            AbstractEditor.prototype.convertHandlerToMonacoLanguage = function(language: string): string {
                let mapping = {
                    "text/x-sql": 'sql',
                    'javascript': Languages.TwxJavascript,
                    'typescript': Languages.TwxTypescript,
                    'xml': 'xml',
                    'css': 'css',
                    'expressionJs': 'javascript',
                    'json': 'json'
                }
                return mapping[language];
            }

            AbstractEditor.prototype.getEntityInformationForMeDefinitions = async function(currentEditedModel) {
                let serviceDefinition;
                if (this.editorType == EditorType.SERVICE_EDITOR) {
                    serviceDefinition = currentEditedModel.service;
                } else if (this.editorType == EditorType.SUBSCRIPTION_EDITOR) {
                    let subscriptionFields: any[];
                    // on ThingWorx 9.5, the data is coming from a different field, `selectedEvent`
                    // In 10.x selectedEvent.fieldsModel is filled asynchronously, so it can be missing at startup
                    subscriptionFields = currentEditedModel.fieldsModel?.all
                        ?? currentEditedModel.selectedEvent?.fieldsModel?.all
                        ?? [];
                    serviceDefinition = {
                        parameterDefinitions: subscriptionFields.reduce(function (map, obj) {
                            map[obj.name] = obj;
                            return map;
                        }, {})
                    };
                    // now also fill out the datashape for the eventData param.
                    if(serviceDefinition.parameterDefinitions["eventData"]) {
                        // v2 (multi-event) subscriptions keep the event name on selectedEvent
                        const eventName = currentEditedModel.eventName ?? currentEditedModel.selectedEvent?.eventName;
                        const allEvents = currentEditedModel.eventsModel?.all ?? currentEditedModel.selectedEvent?.eventsModel?.all ?? [];
                        // iterate through the event definitions
                        for(const event of allEvents) {
                            if(event.name == eventName) {
                                serviceDefinition.parameterDefinitions["eventData"].aspects = {
                                    dataShape: event.event?.dataShape
                                };
                            }
                        }
                    }
                }
                let events;
                if (this.editorType == EditorType.SUBSCRIPTION_EDITOR && currentEditedModel.version !== 1 && currentEditedModel.events) {
                    events = {};
                    for (const alias of Object.keys(currentEditedModel.events)) {
                        events[alias] = currentEditedModel.events[alias]?.fieldsModel?.all ?? [];
                    }
                }
                return {
                    events: events,
                    serviceDefinition: serviceDefinition,
                    effectiveShape: this.entityModel.entity.effectiveShape,
                    id: this.entityModel.name,
                    entityType: this.entityModel.entityType,
                    propertyData: this.entityModel.entityType == "Thing" && !currentEditedModel.isNew ? await getThingPropertyValues(this.entityModel.name) : {}
                }
            }

            AbstractEditor.prototype._initCodeMirror = async function() {
                // Several Composer events schedule an init within a few hundred ms and this function awaits network calls.
                // Only the most recent run may create the editor, otherwise two runs create a model with the same URI.
                const initId = (this._monacoInitCounter = (this._monacoInitCounter || 0) + 1);
                const isStale = () => initId !== this._monacoInitCounter;
                $(this.element).find('.editor-loading').css('display', 'block');
                this._cleanupCodeMirror();
                if (window['TWX'].debug) {
                    console.log('Monaco is starting initialization with options...', );
                }

                if (!this.element) {
                    return;
                }

                const container = this.cmTextarea ? this.cmTextarea.parentElement : this.element.querySelector(".script-control");
                if (!container) {
                    return;
                }

                const userPreferences = await this._getUserPreferences();
                if (isStale()) {
                    return;
                }
                this.userPreferences = userPreferences;

                try {
                    const editorPreferences = await this.userService.getUserPersistentValue(MONACO_EDITOR_SETTINGS_KEY);
                    if(Object.keys(editorPreferences).length == 0) {
                        throw "No saved preferences exist";
                    }
                    this.savedEditorPreferences = mergeEditorSettings(editorPreferences);
                } catch (e) {
                    console.warn("Monaco: Failed to load settings from preferences. Using defaults...", e);
                    this.savedEditorPreferences = mergeEditorSettings();
                }
                if (isStale()) {
                    return;
                }

                // depending on the context, we might need to change the language mode and decide on the editor type
                let currentEditedModel;
                if (this.langMode.name == 'css') {
                    this.editorType = EditorType.CSS_EDITOR;
                } else if (this.entityModel && this.entityModel.Area == "UI") {
                    this.langMode.name = "expressionJs";
                    this.editorType = EditorType.EXPRESSION_EDITOR;
                } else if (this.langMode.name == "javascript" && this.langMode.json) {
                    this.langMode.name = "json";
                    this.editorType = EditorType.GENERIC_EDITOR;
                } else if (this.entityModel && this.entityModel.current3rdNav?.startsWith("subscriptions")) {
                    this.editorType = EditorType.SUBSCRIPTION_EDITOR;
                    currentEditedModel = this.entityModel.subscriptionsModel.edit;
                } else if (this.entityModel && this.entityModel.current3rdNav?.startsWith("services")) {
                    this.editorType = EditorType.SERVICE_EDITOR;
                    currentEditedModel = this.entityModel.servicesModel.editModel;
                } else {
                    this.editorType = EditorType.GENERIC_EDITOR;
                }
                if ((this.editorType == EditorType.SERVICE_EDITOR || this.editorType == EditorType.SUBSCRIPTION_EDITOR) && !currentEditedModel) {
                    // the navigation already moved on (or the edit model isn't set yet); a later event schedules a new init
                    $(this.element).find('.editor-loading').css('display', 'none');
                    return;
                }
                // decide on the editor class to use based on the language
                let editorClass;
                if (this.editorType == EditorType.SERVICE_EDITOR || this.editorType == EditorType.SUBSCRIPTION_EDITOR) {
                    // a re-initialization sees "typescript" here (set by the first one), and must not fall back to the
                    // plain service editor, which has no typings and does not transpile the code
                    if (this.langMode.name == 'javascript' || this.langMode.name == Languages.TwxTypescript) {
                        editorClass = TypescriptCodeEditor;
                        if (currentEditedModel.serviceImplementation.configurationTables.Script.rows.length == 2) {
                            this.langMode.name = Languages.TwxTypescript;
                            this._setValue(currentEditedModel.serviceImplementation.configurationTables.Script.rows[1].code);
                        }
                    } else {
                        editorClass = ServiceEditor;
                    }
                } else {
                    if(this.editorType == EditorType.CSS_EDITOR) {
                        editorClass = CssEditor;
                    } else if (this._isInServiceToolbar()) {
                        // e.g. the SQL editor: it has no entity model, but sits next to the Save / Done / Cancel buttons, which
                        // is all the keyboard shortcuts need (they click those buttons)
                        editorClass = ServiceEditor;
                    } else {
                        editorClass = MonacoCodeEditor;
                    }
                }

                let modelName;
                if (this.editorType == EditorType.SERVICE_EDITOR || this.editorType == EditorType.SUBSCRIPTION_EDITOR) {
                    if(currentEditedModel) {
                        modelName = `${this.entityModel.entityType}/${this.entityModel.name}/${currentEditedModel.isNew ? Math.random().toString(36).substring(7) : currentEditedModel.name}`;
                    } else {
                        modelName =  Math.random().toString(36).substring(7);
                    }
                } else {
                    modelName =  Math.random().toString(36).substring(7);
                }
                // Hide the legacy textarea when present. ThingWorx 10.1 uses an empty .script-control mount instead.
                if (this.cmTextarea) {
                    this.cmTextarea.style.display = 'none';
                } else {
                    container.innerHTML = "";
                }
                // Create a new editor, using the class inferred from the language id
                this.codeMirror = new editorClass(
                    container,
                    {
                        ...this.savedEditorPreferences,
                    },
                    {
                        onClose: () => this._triggerEditorAction("SERVICE_CANCEL", /^cancel$/i),
                        onSave: () => this._triggerEditorAction("SERVICE_SAVE", /^save and continue$/i),
                        onDone: () => this._triggerEditorAction("SERVICE_DONE", /^done$/i),
                        onTest: () => this._triggerEditorAction("SERVICE_EXECUTE"),
                        onPreferencesChanged: (preferences) => {
                            this.userService.setUserPersistentValue(MONACO_EDITOR_SETTINGS_KEY, preferences);
                        },
                    },
                    {
                        code: this._getValue(),
                        language: this.convertHandlerToMonacoLanguage(this.langMode.name),
                        modelName: modelName,
                        readonly: this.readOnly,
                    }
                );

                if (this.codeMirror instanceof TypescriptCodeEditor) {
                    const typescriptCodeEditor = this.codeMirror as TypescriptCodeEditor;
                    let meDefinitions;
                    try {
                        meDefinitions = await this.getEntityInformationForMeDefinitions(currentEditedModel);
                    } catch (e) {
                        // a failure here must never stop the rest of the startup (change listener, view state, spinner)
                        console.warn("Monaco: could not load the entity definitions for autocompletion", e);
                    }
                    if (isStale()) {
                        // a newer run already disposed this editor and owns the container now
                        return;
                    }
                    if (meDefinitions) {
                        typescriptCodeEditor.refreshMeDefinitions(meDefinitions);
                    }
                    this.codeMirror.onEditorFocused(async () => {
                        try {
                            typescriptCodeEditor.refreshMeDefinitions(await this.getEntityInformationForMeDefinitions(currentEditedModel));
                            typescriptCodeEditor.codeTranslator.generateDataShapeCode();
                        } catch (e) {
                            console.warn("Monaco: could not refresh the entity definitions", e);
                        }
                    });

                    typescriptCodeEditor.onEditorTranspileFinished((code) => {
                        if (code !== this._getValue()) {
                            this._setValue(code);
                            // this._lintIfConfigured();
                            CommonUtil.fireChangeEvent(this.element, code);
                        }
                    });
                    this.codeMirror.onLanguageChanged((newLanguage) => {
                        this.langMode.name = newLanguage;
                        if(newLanguage == Languages.TwxJavascript && currentEditedModel && currentEditedModel.serviceImplementation.configurationTables.Script.rows.length == 2) {
                            currentEditedModel.serviceImplementation.configurationTables.Script.rows.pop();
                        }
                    });
                }

                this.codeMirror.onEditorContentChange((code) => {
                    // CodeMirror reported every key press so Composer could record "code updated" in the change history;
                    // Monaco never calls keydown(), so do it for edits made by the user (not programmatic refreshes)
                    if (this.codeMirror && this.codeMirror.hasFocus()) {
                        try {
                            this.keydown();
                        } catch (e) {
                            console.warn("Monaco: could not publish the code change", e);
                        }
                    }
                    if(this.convertHandlerToMonacoLanguage(this.langMode.name) != Languages.TwxTypescript) {
                        if (code !== this._getValue()) {
                            this._setValue(code);
                            this._lintIfConfigured();
                            CommonUtil.fireChangeEvent(this.element, code);
                        }
                    } else {
                        currentEditedModel.serviceImplementation.configurationTables.Script.rows[1] = {
                            code: code
                        }
                        // a type-only edit leaves the transpiled JavaScript unchanged, so the transpile callback never
                        // reports it; tell Composer here so the entity is marked as modified
                        CommonUtil.fireChangeEvent(this.element, this._getValue());
                    }
                });
                this._lintIfConfigured();
                this.codeMirror.focus();
                // restore view state on startup
                if(this.editorType == EditorType.SERVICE_EDITOR || this.editorType == EditorType.SUBSCRIPTION_EDITOR) {
                    let viewState;
                    try {
                        const stored = localStorage.getItem(this._getViewStateKey(currentEditedModel));
                        viewState = stored ? JSON.parse(stored) : undefined;
                    } catch (e) {
                        // storage can be unavailable or corrupt, the view state is only a convenience
                    }
                    if (!viewState) {
                        // entities saved by older versions of the extension carry the view state in the script table
                        const legacySettings = currentEditedModel.serviceImplementation.configurationTables.Script.rows[0]?.editorSettings;
                        viewState = legacySettings && legacySettings.viewState;
                    }
                    if (viewState) {
                        this.codeMirror.setViewState(viewState);
                    }
                }
                // an explicit target line (go to line from the test output) wins over the restored view state
                this._setCursor();

                this.initialized();
                CommonUtil.fireCustomEvent(this.element, "initialized", {});
                $(this.element).find('.editor-loading').css('display', 'none');
            }

            /**
             * The view state is stored per service, so the keys would grow without limit. Keep the most recently saved ones.
             * Never throws: storage is only a convenience.
             */
            AbstractEditor.prototype._trimStoredViewStates = function(latestKey: string) {
                const INDEX_KEY = "monaco-view-state-index";
                const MAX_ENTRIES = 200;
                try {
                    let index: string[] = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
                    index = index.filter((k) => k !== latestKey);
                    index.push(latestKey);
                    while (index.length > MAX_ENTRIES) {
                        localStorage.removeItem(index.shift());
                    }
                    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
                } catch (e) {
                    // ignore
                }
            }

            /** Key of the stored view state of the service or subscription being edited, if it can be identified */
            AbstractEditor.prototype._getViewStateKey = function(editedModel) {
                if (!editedModel || editedModel.isNew || !this.entityModel || !editedModel.name) {
                    return undefined;
                }
                return `monaco-view-state/${this.entityModel.entityType}/${this.entityModel.name}/${this.editorType}/${editedModel.name}`;
            }

            AbstractEditor.prototype._getValue = function() {
                return _.get(this, this.valueField);
            }

            AbstractEditor.prototype._setValue = function(newVal) {
                _.set(this, this.valueField, newVal);
            }

            AbstractEditor.prototype._lintIfConfigured = function() {
                if (this.getLinting()) {
                    this.lint(this.editorOptions);
                }
            }

            AbstractEditor.prototype._cleanupCodeMirror = function() {
                if (!this.codeMirror) {
                    return;
                }
                this._saveEditorViewState();
                this.codeMirror.dispose();
                this.codeMirror = null;
            }

            /**
             * Runs the Composer action behind a keyboard shortcut. The SERVICE_* hotkeys are only subscribed by the
             * Services tab, so in the subscription editor the matching toolbar button is clicked instead.
             * Never throws: a missing handler must not break the editor.
             */
            AbstractEditor.prototype._triggerEditorAction = function(hotkey: string, buttonText?: RegExp) {
                const clickButton = (): boolean => {
                    if (!buttonText) {
                        return false;
                    }
                    // Language independent: the service and subscription editors keep their actions in their own container and
                    // bind them with click.trigger (save: done(true...), done: done() / done(false), cancel: cancel()).
                    const trigger = hotkey == "SERVICE_SAVE" ? /^done\(true/ : hotkey == "SERVICE_DONE" ? /^done\((false)?\)$/ : hotkey == "SERVICE_CANCEL" ? /^cancel\(\)$/ : undefined;
                    const isUsable = (b: HTMLElement) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled;
                    const containerButtons = (Array.from(document.querySelectorAll(".service-actions button, .subscriptions-actions button")) as HTMLElement[]).filter(isUsable);
                    let button = trigger && containerButtons.find((b) => trigger.test((b.getAttribute("click.trigger") || "").replace(/\s/g, "")));
                    if (!button) {
                        // fallback for other Composer versions: match the (English) button text
                        const visible = (Array.from(document.querySelectorAll("button, .btn, [role=button]")) as HTMLElement[])
                            .filter((b) => isUsable(b) && buttonText.test((b.textContent || "").trim()));
                        // the toolbar has an entity level and a service level "Cancel"; the service one sits next to "Done"
                        const done = (Array.from(document.querySelectorAll("button")) as HTMLElement[])
                            .find((b) => b.offsetParent !== null && /^done$/i.test((b.textContent || "").trim()));
                        button = (done && visible.find((b) => b.parentElement === done.parentElement)) || visible[0];
                    }
                    if (!button) {
                        return false;
                    }
                    const target = button;
                    // defer, so Monaco finishes handling the keypress before Composer tears the editor down
                    setTimeout(() => target.click(), 0);
                    return true;
                };
                const run = () => {
                    try {
                        // The toolbar button is what the user would click. Composer's SERVICE_* hotkey callbacks go stale after
                        // the first save (and don't exist in the subscription editor), so use them only as a fallback.
                        if (clickButton()) {
                            return;
                        }
                        const callback = HotkeyManager?._subscribers?.[hotkey]?.callback;
                        if (typeof callback === "function" && this.editorType != EditorType.SUBSCRIPTION_EDITOR) {
                            callback.call();
                            return;
                        }
                        console.warn(`Monaco: no handler for ${hotkey} in the ${this.editorType} editor`);
                    } catch (e) {
                        console.warn(`Monaco: failed to run ${hotkey}`, e);
                    }
                };
                // a TypeScript edit made in the last moments has not been transpiled yet; saving now would keep the old JavaScript
                let pending: Promise<void> | undefined;
                try {
                    pending = this.codeMirror?.flushTranspile?.();
                } catch (e) {
                    console.warn("Monaco: could not flush the pending transpile", e);
                }
                if (pending) {
                    pending.then(run, run);
                } else {
                    run();
                }
            }

            /** Composer builds its syntax error display with this; here it only hands the error provider on */
            AbstractEditor.prototype.twxJsHinter = function(provider) {
                return { __twxHinter: provider };
            }

            AbstractEditor.prototype._showSyntaxErrors = function(provider) {
                try {
                    const model = this.codeMirror && this.codeMirror.monacoEditor && this.codeMirror.monacoEditor.getModel();
                    if (!model) {
                        return;
                    }
                    Promise.resolve(provider()).then((errors) => {
                        if (model.isDisposed()) {
                            return;
                        }
                        monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, hintErrorsToMarkers(
                            errors,
                            model.getLineCount(),
                            (line) => model.getLineMaxColumn(line),
                            monaco.MarkerSeverity,
                            model.getLanguageId() === Languages.TwxTypescript
                        ));
                        // the marks describe the code that was checked; drop them with the first edit
                        const subscription = model.onDidChangeContent(() => {
                            subscription.dispose();
                            if (!model.isDisposed()) {
                                monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, []);
                            }
                        });
                    }).catch((e) => console.warn("Monaco: could not show the syntax errors", e));
                } catch (e) {
                    console.warn("Monaco: could not show the syntax errors", e);
                }
            }

            AbstractEditor.prototype._clearSyntaxErrors = function() {
                try {
                    const model = this.codeMirror && this.codeMirror.monacoEditor && this.codeMirror.monacoEditor.getModel();
                    if (model && !model.isDisposed()) {
                        monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, []);
                    }
                } catch (e) {
                    // cosmetic
                }
            }

            /** True when this editor lives inside a service editor, i.e. next to its Save and Continue / Done / Cancel buttons */
            AbstractEditor.prototype._isInServiceToolbar = function() {
                try {
                    return $(this.element).closest('.service-editor').find('.service-actions').length > 0;
                } catch (e) {
                    return false;
                }
            }

            AbstractEditor.prototype._getSelectedRange = function() {
                // not being used internally
                return {from: 0, to: 0};
            }

            AbstractEditor.prototype._setLine = function(text, line, originalTextLength) {
                // not being used internally
            }

            AbstractEditor.prototype._handleFolding = function(action) {
                if(action == 'fold') {
                    this.codeMirror.foldAll();
                } else if(action == 'unfold') {
                    this.codeMirror.unfoldAll();
                }
            }

            /**
             * Retrieve user preferences.
             *
             * @returns {Promise}
             * @private
             */
             AbstractEditor.prototype._getUserPreferences = function() {
                return this.userService.getUserPersistentValue(UserSessionInfoKeys.USER_PREFERENCES);
            }

            AbstractEditor.prototype._preferenceChanged = function _preferenceChanged(data) {
                if (data.name === UserSessionInfoKeys.USER_PREFERENCES) {
                    let compKey = 'value.' + UserPreferenceKeys.SERVICE_EDITOR_THEME;
                    let prefTheme = _.get(data, compKey);
                    if (prefTheme) {
                        this._themeChanged(prefTheme, this.theme);
                    }
                }
            }

            /**
             * Called when the editor detects a preference change for theming
             *
             * @param newVal
             * @param oldVal
             * @private
             */
             AbstractEditor.prototype._themeChanged = function(newVal, oldVal) {
                if (!newVal || newVal === oldVal) {
                    return;
                }
                this._initCodeMirrorDebounced();
            }

            /**
             * Composer sets `cursor` ({line}, already 0-based like CodeMirror) when the user navigates to
             * `services/<name>:<line>`, for example by clicking a line of a stack trace in the test output.
             * Line 0 is also the default value, so it is treated as "no explicit target".
             */
            AbstractEditor.prototype._setCursor = function() {
                const line = this.cursor && Number(this.cursor.line);
                if (this.codeMirror && line > 0 && typeof this.codeMirror.highlightLine === "function") {
                    this.codeMirror.highlightLine(line);
                    // consume the target, otherwise reopening the service later jumps to this line again
                    this.cursor = { line: 0, col: 0 };
                }
            }

            AbstractEditor.prototype.hasFocus = function() {
                return !!(this.codeMirror && this.codeMirror.hasFocus());
            }

            return AbstractEditor;
        }());
        exports.AbstractEditor = AbstractEditor;
    }
    );
}
function waitForDefine() {
    if(typeof window["define"] == "undefined"){
      window.setTimeout(waitForDefine,10);
    }
    else{
      load();
    }
}
waitForDefine();
