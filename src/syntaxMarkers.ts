/** An error as Composer's own syntax check reports it (see its jsPreview) */
export interface HintError {
    message: string;
    severity?: string;
    /** 1 based line of the checked JavaScript */
    line?: number;
}

export interface MarkerData {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    message: string;
    severity: number;
}

export interface MarkerSeverities {
    Error: number;
    Warning: number;
    Info: number;
}

/**
 * Turns the errors of Composer's server side syntax check into Monaco markers that cover the whole line.
 * `inGeneratedJavaScript` is for TypeScript services: the server checks the transpiled JavaScript, so its line numbers
 * do not match the TypeScript the user sees. Then the message names the JavaScript line and the marker sits on line 1.
 */
export function hintErrorsToMarkers(
    errors: HintError[],
    lineCount: number,
    maxColumnOf: (line: number) => number,
    severities: MarkerSeverities,
    inGeneratedJavaScript = false
): MarkerData[] {
    return (errors || [])
        .filter((error) => error && typeof error.message === "string")
        .map((error) => {
            const reported = Number(error.line) > 0 ? Number(error.line) : 1;
            const line = inGeneratedJavaScript ? 1 : Math.min(reported, Math.max(1, lineCount));
            const severity = /^err/i.test(error.severity || "error")
                ? severities.Error
                : /^warn/i.test(error.severity || "")
                ? severities.Warning
                : severities.Info;
            return {
                startLineNumber: line,
                startColumn: 1,
                endLineNumber: line,
                endColumn: Math.max(1, maxColumnOf(line)),
                message: inGeneratedJavaScript ? `${error.message} (line ${reported} of the generated JavaScript)` : error.message,
                severity,
            };
        });
}
