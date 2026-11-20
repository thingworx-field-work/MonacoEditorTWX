import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

let applied = false;

/**
 * Monaco's basic JavaScript/TypeScript language configuration has no `indentationRules`, so pressing Enter after an
 * existing `{`, `(` or `[` does not indent. This registers the stock configuration plus the indentation rules VS Code uses.
 * setLanguageConfiguration replaces the whole configuration of a language, so the stock values are repeated here.
 */
export function applyScriptIndentationRules(): void {
    if (applied) {
        return;
    }
    applied = true;
    const IndentAction = monaco.languages.IndentAction;
    const configuration: monaco.languages.LanguageConfiguration = {
        wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        comments: { lineComment: "//", blockComment: ["/*", "*/"] },
        brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
        indentationRules: {
            increaseIndentPattern: /^((?!\/\/).)*(\{([^}"'`/]*|(\t|[ ])*\/\/.*)|\([^)"'`/]*|\[[^\]"'`/]*)$/,
            decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[\}\]].*$/,
        },
        onEnterRules: [
            {
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                afterText: /^\s*\*\/$/,
                action: { indentAction: IndentAction.IndentOutdent, appendText: " * " },
            },
            {
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                action: { indentAction: IndentAction.None, appendText: " * " },
            },
            {
                beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
                action: { indentAction: IndentAction.None, appendText: "* " },
            },
            {
                beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
                action: { indentAction: IndentAction.None, removeText: 1 },
            },
        ],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"', notIn: ["string"] },
            { open: "'", close: "'", notIn: ["string", "comment"] },
            { open: "`", close: "`", notIn: ["string", "comment"] },
            { open: "/**", close: " */", notIn: ["string"] },
        ],
        folding: {
            markers: {
                start: new RegExp("^\s*//\s*#?region\b"),
                end: new RegExp("^\s*//\s*#?endregion\b"),
            },
        },
    };
    monaco.languages.setLanguageConfiguration("javascript", configuration);
    monaco.languages.setLanguageConfiguration("typescript", configuration);
}
