import type { CallToolResult, Tool } from '@contextvm/mcp-sdk/types.js';

/**
 * Turns an MCP tool's `inputSchema` into form fields and the filled-in form
 * back into tool arguments, for the Tools page. Only the top level of the
 * schema becomes fields; nested objects and arrays are edited as JSON.
 */

export type FieldKind = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'json';

export interface FormField {
	name: string;
	label: string;
	description?: string;
	required: boolean;
	kind: FieldKind;
	/** `select` choices, as their JSON values. */
	options?: unknown[];
	defaultValue?: unknown;
	min?: number;
	max?: number;
	integer?: boolean;
}

/** What the inputs hold: text, a number (from `type="number"`), a checkbox, or empty. */
export type FormValue = string | number | boolean | null | undefined;

// Values that are long or copy-pasted blobs get a textarea instead of a one-line input.
const LONG_VALUE_NAME = /hex|raw_?tx|psbt|descriptor|script|policy|miniscript/i;

type JsonSchema = {
	type?: string | string[];
	title?: string;
	description?: string;
	enum?: unknown[];
	default?: unknown;
	minimum?: number;
	maximum?: number;
};

function primaryType(schema: JsonSchema): string | undefined {
	return Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
}

function fieldKind(name: string, schema: JsonSchema): FieldKind {
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'select';
	switch (primaryType(schema)) {
		case 'boolean':
			return 'checkbox';
		case 'integer':
		case 'number':
			return 'number';
		case 'string':
			return LONG_VALUE_NAME.test(name) ? 'textarea' : 'text';
		default:
			return 'json';
	}
}

export function fieldsFromSchema(inputSchema: Tool['inputSchema']): FormField[] {
	const properties = (inputSchema?.properties ?? {}) as Record<string, JsonSchema>;
	const required = new Set(Array.isArray(inputSchema?.required) ? inputSchema.required : []);

	return Object.entries(properties).map(([name, schema]) => ({
		name,
		label: schema.title ?? name,
		description: schema.description,
		required: required.has(name),
		kind: fieldKind(name, schema),
		options: schema.enum,
		defaultValue: schema.default,
		min: schema.minimum,
		max: schema.maximum,
		integer: primaryType(schema) === 'integer'
	}));
}

/** Initial input values: schema defaults where given, else empty. */
export function initialValues(fields: FormField[]): Record<string, FormValue> {
	return Object.fromEntries(
		fields.map((field) => {
			const value = field.defaultValue;
			switch (field.kind) {
				case 'checkbox':
					return [field.name, value === true];
				case 'number':
					return [field.name, typeof value === 'number' ? value : null];
				case 'select':
					return [field.name, value === undefined ? '' : JSON.stringify(value)];
				case 'json':
					return [field.name, value === undefined ? '' : JSON.stringify(value, null, 2)];
				default:
					return [field.name, typeof value === 'string' ? value : ''];
			}
		})
	);
}

export type BuildArgsResult =
	| { ok: true; args: Record<string, unknown> }
	| { ok: false; error: string };

/**
 * Converts input values to tool arguments. Empty optional fields are left out
 * so the tool applies its own defaults; schema validation happens afterwards.
 */
export function buildArgs(fields: FormField[], values: Record<string, FormValue>): BuildArgsResult {
	const args: Record<string, unknown> = {};

	for (const field of fields) {
		const value = values[field.name];

		if (field.kind === 'checkbox') {
			// Only send a flag the user changed from its default, or that is required.
			if (field.required || value !== (field.defaultValue === true)) {
				args[field.name] = value === true;
			}
			continue;
		}

		const text = typeof value === 'string' ? value.trim() : value;
		if (text === '' || text === null || text === undefined) {
			if (field.required) return { ok: false, error: `${field.label} is required.` };
			continue;
		}

		switch (field.kind) {
			case 'number': {
				const number = Number(text);
				if (!Number.isFinite(number)) {
					return { ok: false, error: `${field.label} must be a number.` };
				}
				args[field.name] = number;
				break;
			}
			case 'select':
			case 'json':
				try {
					args[field.name] = JSON.parse(String(text));
				} catch {
					return { ok: false, error: `${field.label} is not valid JSON.` };
				}
				break;
			default:
				args[field.name] = text;
		}
	}

	return { ok: true, args };
}

function prettyText(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

/** A tool result for display: structured content, else its content blocks (JSON pretty-printed). */
export function formatResult(result: CallToolResult): string {
	if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
		return JSON.stringify(result.structuredContent, null, 2);
	}

	const blocks = Array.isArray(result.content) ? result.content : [];
	if (blocks.length === 0) return '(empty result)';

	return blocks
		.map((block) =>
			block.type === 'text' ? prettyText(block.text) : JSON.stringify(block, null, 2)
		)
		.join('\n\n');
}
