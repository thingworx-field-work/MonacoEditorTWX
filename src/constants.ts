import type { MonacoEditorSettings } from './editors/basicCodeEditor';

export { DISALLOWED_ENTITY_CHARS } from './entityNames';

export const MONACO_EDITOR_SETTINGS_KEY = "MONACO_EDITOR_SETTINGS";
export const MONACO_EDITOR_CONFIGURATION_MODEL = "twx://configuration_model.json"
/**
 * List of all the collections in thingworx
 */
export const ENTITY_TYPES = ["ApplicationKeys", "Authenticators", "Bindings", "Blogs", "Dashboards",
    "DataAnalysisDefinitions", "DataTags", "ModelTags", "DirectoryServices", "Groups", "LocalizationTables",
    "Logs", "Mashups", "MediaEntities", "Menus", "Networks", "Organizations", "Permissions", "Projects", "Resources", "StateDefinitions",
    "StyleDefinitions", "Subsystems", "Things", "ThingTemplates", "ThingShapes", "Users", "Wikis"
];

/**
 * The default editor settings with monaco.
 * The full reference is available here: https://microsoft.github.io/monaco-editor/api/interfaces/monaco.editor.ieditoroptions.html
 */
export const DEFAULT_EDITOR_SETTINGS: MonacoEditorSettings = {
    editor: {
        showFoldingControls: "mouseover",
        folding: true,
        fontSize: 12,
        tabSize: 4,
        insertSpaces: true,
        detectIndentation: false,
        fontFamily: "Fira Code,Monaco,monospace",
        fontLigatures: true,
        mouseWheelZoom: true,
        formatOnPaste: true,
        fixedOverflowWidgets: true,
        scrollBeyondLastLine: true,
        theme: "vs",
        disableLayerHinting: true, // fixes bug in FF
        snippetSuggestions: "bottom",
        inlayHints: {
            enabled: "on"
        },
        bracketPairColorization: {
            enabled: true
        }
    },
    diffEditor: {},
    thingworx: {
        showGenericServices: false
    },
    prettier: {
        enabled: true,
        options: {
            printWidth: 100,
            // ThingWorx services run on Rhino (ES5); Prettier 3's default "all" adds ES2017 trailing commas in calls and parameters
            trailingComma: "es5",
        }
    }
}

export enum Languages {
    TwxTypescript = 'typescript',
    TwxJavascript = 'javascript'
}

/**
 * Deep-merges the user's saved settings over the defaults, per section, so that defaults added in newer
 * versions reach users that already saved preferences.
 * If the user chose a tab size or insertSpaces but did not say anything about `detectIndentation`,
 * detection is turned off, otherwise the file contents would override the chosen indentation.
 */
export function mergeEditorSettings(saved?: Partial<MonacoEditorSettings>): MonacoEditorSettings {
    const defaults = DEFAULT_EDITOR_SETTINGS;
    saved = saved || {};
    const merged: MonacoEditorSettings = {
        ...defaults,
        ...saved,
        editor: { ...defaults.editor, ...(saved.editor || {}) },
        diffEditor: { ...defaults.diffEditor, ...(saved.diffEditor || {}) },
        thingworx: { ...defaults.thingworx, ...(saved.thingworx || {}) },
        prettier: {
            ...defaults.prettier,
            ...(saved.prettier || {}),
            options: { ...defaults.prettier.options, ...(saved.prettier?.options || {}) },
        },
    };
    const savedEditor = saved.editor || {};
    if (
        savedEditor.detectIndentation === undefined &&
        (savedEditor.tabSize !== undefined || savedEditor.insertSpaces !== undefined)
    ) {
        merged.editor.detectIndentation = false;
    }
    return merged;
}

function isPlainObject(value: any): boolean {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diffObjects(current: any, defaults: any): any {
    const result: any = {};
    for (const key of Object.keys(current)) {
        const value = current[key];
        const defaultValue = defaults ? defaults[key] : undefined;
        if (isPlainObject(value) && isPlainObject(defaultValue)) {
            const nested = diffObjects(value, defaultValue);
            if (Object.keys(nested).length > 0) {
                result[key] = nested;
            }
        } else if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Reduces the settings to the values that differ from the defaults. Storing only those lets defaults that
 * are changed in a later version reach users that never customised the value.
 */
export function diffFromDefaultSettings(settings: MonacoEditorSettings): Partial<MonacoEditorSettings> {
    return diffObjects(settings, DEFAULT_EDITOR_SETTINGS);
}

/** Languages Prettier formats. SQL and XML services must not get it: Prettier has no parser for them and would throw. */
export const PRETTIER_LANGUAGES = ["javascript", "typescript", "json", "css"];

/** The parts of the URI of an editor model. "#" and "?" in an entity name stay part of the path, they are not parsed. */
export function modelUriParts(modelName: string) {
    return { scheme: "twx", authority: "privateModel", path: "/" + modelName };
}
