import type OpenAI from 'openai';

export const FREE_MODEL_SUFFIX = ':free';

/** Free models that are excluded from auto-mode rotation. */
export const FREE_MODEL_BLACKLIST: ReadonlySet<string> = new Set([
	'nvidia/nemotron-3.5-content-safety:free'
]);

export async function fetchFreeModels(client: OpenAI): Promise<string[]> {
	const response = await client.models.list();
	const freeModels = response.data
		.map((model) => model.id)
		.filter((id) => id.endsWith(FREE_MODEL_SUFFIX) && !FREE_MODEL_BLACKLIST.has(id));
	return [...new Set(freeModels)];
}

export function isRetryableError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}

	const status =
		typeof (error as { status?: unknown }).status === 'number'
			? (error as { status: number }).status
			: undefined;
	if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
		return true;
	}

	const code =
		typeof (error as { code?: unknown }).code === 'string'
			? (error as { code: string }).code
			: undefined;
	if (code === 'rate_limit_exceeded') {
		return true;
	}

	return false;
}

export class FreeModelRotator {
	private readonly client: OpenAI;
	private readonly cacheMs: number;
	private models: string[] = [];
	private currentIndex = 0;
	private lastFetched = 0;
	private refreshPromise: Promise<string[]> | null = null;

	constructor(client: OpenAI, cacheMs = 10 * 60 * 1000) {
		this.client = client;
		this.cacheMs = cacheMs;
	}

	public async getModels(force = false): Promise<string[]> {
		const now = Date.now();
		const isFresh = now - this.lastFetched < this.cacheMs;

		if (!force && this.models.length > 0 && isFresh) {
			return this.models;
		}

		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		this.refreshPromise = fetchFreeModels(this.client)
			.then((models) => {
				this.models = models;
				this.lastFetched = Date.now();
				this.currentIndex = 0;
				return this.models;
			})
			.finally(() => {
				this.refreshPromise = null;
			});

		return this.refreshPromise;
	}

	public async getCurrentModel(): Promise<string | null> {
		const models = await this.getModels();

		if (models.length === 0) {
			return null;
		}

		if (this.currentIndex >= models.length) {
			this.currentIndex = 0;
		}

		return models[this.currentIndex] ?? null;
	}

	public async advanceModel(): Promise<string | null> {
		const models = await this.getModels();

		if (models.length === 0) {
			return null;
		}

		this.currentIndex = (this.currentIndex + 1) % models.length;
		return models[this.currentIndex] ?? null;
	}
}
