import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { DataShape, FieldDefinition } from './types';

const MIME_APPLICATION_JSON = "application/json";
const MIME_TEXT_XML = "text/xml";

function platformUrl(path: string): string {
    return `${window.location.origin}${path}`;
}

/**
 * Gets the metadata of all the datashapes in the system. Uses the export of all datashapes
 */
export async function getDataShapeDefinitions(): Promise<DataShape[]> {
    const response = await fetch(platformUrl(`/Thingworx/Exporter/DataShapes?universal=true`), {
        method: 'GET',
        headers: {
            'Accept': MIME_TEXT_XML
        }
    });
    if (!response.ok) {
        return [];
    }
    const xmlText = await response.text();
    const document = new DOMParser().parseFromString(xmlText, MIME_TEXT_XML);

    return Array.from(document.getElementsByTagName('DataShape')).map(dsXml => {
        return {
            name: dsXml.getAttribute('name'),
            description: dsXml.getAttribute('description'),
            fieldDefinitions: Array.from(dsXml.getElementsByTagName('FieldDefinition')).map(f => {
                return {
                    name: f.getAttribute('name'),
                    baseType: f.getAttribute('baseType'),
                    description: f.getAttribute('description'),
                    dataShape: f.getAttribute('aspect.dataShape'),
                    ordinal: parseInt(f.getAttribute('ordinal') || '0')
                }
            })
        }
    });
};

/**
 * Searches for entities in the platform using the spotlight search an returns a new promise with the metadata
 * @param  {string} entityType Thingworx Entity Type.
 * @param  {string} searchTerm The entity to search for. Only the prefix can be specified.
 */
const SPOTLIGHT_CACHE_TTL_MS = 60 * 1000;
const SPOTLIGHT_CACHE_MAX_ENTRIES = 200;
const spotlightCache = new Map<string, { time: number, result: any }>();

export async function spotlightSearch(entityType, searchTerm, signal?: AbortSignal): Promise<any> {
    // typing "Things[\"ab" then "abc" asks for the same prefixes again and again, so remember the results for the session
    const cacheKey = `${entityType}|${searchTerm}`;
    const cached = spotlightCache.get(cacheKey);
    if (cached && Date.now() - cached.time < SPOTLIGHT_CACHE_TTL_MS) {
        return cached.result;
    }
    const response = await fetch(platformUrl(`/Thingworx/Resources/SearchFunctions/Services/SpotlightSearch`), {
        method: 'POST',
        signal,
        body: JSON.stringify({
            searchExpression: searchTerm + "*",
            withPermissions: false,
            isAscending: false,
            maxItems: 100,
            types: {
                // todo: proper fix for MediaEntities -> MediaEntity
                items: [entityType == "MediaEntities" ? "MediaEntity" : entityType.slice(0, -1)]
            },
            sortBy: "lastModifiedDate",
            searchDescriptions: true
        }),
        headers: {
            'Content-Type': MIME_APPLICATION_JSON,
            'Accept': MIME_APPLICATION_JSON
        }
    });
    if (!response.ok) {
        return { rows: [] };
    }
    const result = await response.json();
    spotlightCache.delete(cacheKey);
    if (spotlightCache.size >= SPOTLIGHT_CACHE_MAX_ENTRIES) {
        // evict the oldest entry (Map keeps insertion order)
        spotlightCache.delete(spotlightCache.keys().next().value);
    }
    spotlightCache.set(cacheKey, { time: Date.now(), result });
    return result;
};

/**
 * Loads a json monaco snippet file and returns a the Completion list
 *
 * @param  {string} snippets to load
 */
// The snippet files never change, so build the completion items once; only the range differs per request
const snippetItemCache = new WeakMap<object, Omit<monaco.languages.CompletionItem, "range">[]>();

export function loadSnippets(snippets, range: monaco.Range): monaco.languages.CompletionList {
    let items = snippetItemCache.get(snippets);
    if (!items) {
        items = [];
        for (let key in snippets) {
            if (snippets.hasOwnProperty(key)) {
                items.push({
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    label: snippets[key].prefix,
                    documentation: snippets[key].description,
                    insertText: snippets[key].body.join("\n"),
                });
            }
        }
        snippetItemCache.set(snippets, items);
    }
    return { suggestions: items.map((item) => ({ ...item, range })) };
};

// lives in its own file so it can be unit tested without loading monaco
export { sanitizeEntityName } from './entityNames';

export async function getScriptFunctionLibraries(): Promise<any[]> {
    const response = await fetch(platformUrl(`/Thingworx/ScriptFunctionLibraries`), {
        headers: {
            'Accept': MIME_APPLICATION_JSON
        }
    });
    if (!response.ok) {
        return [];
    }
    const libraries = await response.json();
    // fetch all libraries in parallel instead of one after another
    const definitions = await Promise.all(libraries.rows.map(async (scriptFunction: { name: string }) => {
        try {
            const scriptResponse = await fetch(platformUrl(`/Thingworx/ScriptFunctionLibraries/${scriptFunction.name}/FunctionDefinitions`), {
                headers: {
                    'Accept': MIME_APPLICATION_JSON
                }
            });
            return scriptResponse.ok ? await scriptResponse.json() : undefined;
        } catch (e) {
            console.warn(`Monaco: could not load script function library ${scriptFunction.name}`, e);
            return undefined;
        }
    }));
    return definitions.filter((definition) => definition !== undefined);
}

export function isGenericService(serviceDefinition: { sourceName: string, sourceType: string }): boolean {
    return serviceDefinition.sourceName == "ConfiguredThing" && serviceDefinition.sourceType == "ThingPackage";
}

export async function getEntityMetadata(entityType: string, entityName: string): Promise<any> {
    const response = await fetch(platformUrl(`/Thingworx/${entityType}/${encodeURIComponent(entityName)}/Metadata`), {
        headers: {
            'Accept': MIME_APPLICATION_JSON
        }
    });
    if (!response.ok) {
        // a missing or forbidden entity must not break typings for the entities after it
        return undefined;
    }
    return response.json();
}

export async function getEntityInstancesMetadata(entityType: string, entityName: string): Promise<any> {
    const response = await fetch(platformUrl(`/Thingworx/${entityType}/${encodeURIComponent(entityName)}/InstanceMetadata`), {
        headers: {
            'Accept': MIME_APPLICATION_JSON
        }
    });
    if (!response.ok) {
        return undefined;
    }
    return response.json();
}

// every editor focus asks for the properties of "me"; a short cache turns a burst of focus events into one request
const PROPERTY_CACHE_TTL_MS = 10 * 1000;
const propertyValueCache = new Map<string, { time: number, promise: Promise<any> }>();

export function getThingPropertyValues(entityName: string): Promise<any> {
    const cached = propertyValueCache.get(entityName);
    if (cached && Date.now() - cached.time < PROPERTY_CACHE_TTL_MS) {
        return cached.promise;
    }
    const promise = fetchThingPropertyValues(entityName);
    propertyValueCache.set(entityName, { time: Date.now(), promise });
    // a failed request must not be remembered
    promise.then((values) => {
        if (values === undefined && propertyValueCache.get(entityName)?.promise === promise) {
            propertyValueCache.delete(entityName);
        }
    }, () => propertyValueCache.delete(entityName));
    return promise;
}

async function fetchThingPropertyValues(entityName: string): Promise<any> {
    const response = await fetch(platformUrl(`/Thingworx/Things/${encodeURIComponent(entityName)}/Properties`), {
        headers: {
            'Accept': MIME_APPLICATION_JSON
        }
    });
    if (!response.ok) {
        return {};
    }
    const data = await response.json();
    return data.rows?.[0] ?? {};
}
