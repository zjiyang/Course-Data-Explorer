import { Request, Response, NextFunction } from "express";
import {
	NotFoundError,
	ValidationError,
	TooManyResultsError,
	InvalidQueryError,
} from "../models/errors";

// ============================================================
// parsePagination
// Replaces identical copy-pasted blocks in:
//   GET /api/v1/courses
//   GET /api/v1/courses/:course/sections
//   GET /api/v2/buildings
//   GET /api/v2/buildings/:building/rooms
// After this middleware runs, res.locals.pagination is set.
// ============================================================
export function parsePagination(req: Request, res: Response, next: NextFunction): void {
	const limitRaw = req.query.limit;
	const offsetRaw = req.query.offset;

	const limit = limitRaw === undefined ? 100 : Number(limitRaw);
	const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

	const params: Record<string, string> = {};
	if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
		params.limit = "expected an integer between 1 and 5000";
	}
	if (!Number.isInteger(offset) || offset < 0) {
		params.offset = "expected an integer >= 0";
	}

	if (Object.keys(params).length > 0) {
		res.status(400).send({ error: "Invalid request parameters", params });
		return;
	}

	res.locals.pagination = { limit, offset };
	next();
}

// ============================================================
// requireJsonBody
// Guards against null / missing / non-object body before
// controllers try to access req.body fields.
// ============================================================
export function requireJsonBody(req: Request, res: Response, next: NextFunction): void {
	if (!req.body || typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
		res.status(422).send({
			error: "Validation failed",
			fields: { body: "expected a JSON object" },
		});
		return;
	}
	next();
}

// ============================================================
// handleErrors
// Centralised error → HTTP mapping.
// Must be registered LAST with app.use(handleErrors).
// Before this PR: every handler repeated its own 404/422/413
// logic inline. Now: services throw typed errors, controllers
// call next(err), and this middleware maps them once.
// ============================================================
export function handleErrors(
	err: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction
): void {
	if (err instanceof ValidationError) {
		res
			.status(422)
			.send({ error: "Validation failed", fields: err.fields, message: err.message });
		return;
	}
	if (err instanceof InvalidQueryError) {
		res.status(400).send({ error: "Invalid query", message: err.message });
		return;
	}
	if (err instanceof NotFoundError) {
		res.status(404).send({ error: "Not found", message: err.message });
		return;
	}
	if (err instanceof TooManyResultsError) {
		res.status(413).send({
			error: "Too many results",
			message: err.message,
			limit: err.limit,
		});
		return;
	}
	console.error("Unhandled error:", err);
	res.status(500).send({ error: "Internal server error" });
}
