/** Parses the EditorSettings binding of the runtime widget. An empty or invalid binding must not break the widget. */
export function parseSettings(value: any): any {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}
