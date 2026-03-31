// ============================================================
// Domain errors — typed Error subclasses, no Express coupling.
// Services throw these; handleErrors middleware maps them to HTTP.
// ============================================================

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export class ValidationError extends Error {
	public readonly fields?: Record<string, string>;

	constructor(message: string, fields?: Record<string, string>) {
		super(message);
		this.name = "ValidationError";
		this.fields = fields;
	}
}

export class TooManyResultsError extends Error {
	public readonly limit: number;

	constructor(limit: number) {
		super(`Query would return more than ${limit} results`);
		this.name = "TooManyResultsError";
		this.limit = limit;
	}
}

export class InvalidQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidQueryError";
	}
}
