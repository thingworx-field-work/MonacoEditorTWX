/**
 * Entity names recognized by monaco can only be valid javascript variable names
 */
export const DISALLOWED_ENTITY_CHARS = /^[^a-zA-Z_]+|[^a-zA-Z_0-9]+/g;

/**
 * Sanitizes an entity name to be a valid javascript declaration.
 * Names that had to be changed get a short hash of the original name, so that for example "My-Thing" and
 * "My.Thing" do not both become "MyThing" and replace each other's typings.
 */
export function sanitizeEntityName(entityName: string): string {
    const sanitized = entityName.replace(DISALLOWED_ENTITY_CHARS, "");
    if (sanitized === entityName) {
        return sanitized;
    }
    let hash = 5381;
    for (let i = 0; i < entityName.length; i++) {
        hash = ((hash << 5) + hash + entityName.charCodeAt(i)) >>> 0;
    }
    return `${sanitized}_${hash.toString(36)}`;
}
