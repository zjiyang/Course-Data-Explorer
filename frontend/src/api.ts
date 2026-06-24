// Thin REST client for the Course Data Explorer backend.
// Ported 1:1 from the original vanilla-JS frontend (legacy-vanilla/frontend.js) —
// same endpoints, same query shapes, same error handling. No backend changes.

import type { Course, DatasetJob, InsightRow, OfferingRow } from "./types";

async function safeJson(res: Response): Promise<any> {
	const text = await res.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { raw: text };
	}
}

function formatHttpError(res: Response, payload: any): string {
	let msg = `${res.status} ${payload?.error || res.statusText || "Error"}`;
	if (payload?.message) msg += `\n${payload.message}`;
	if (payload?.fields && typeof payload.fields === "object") {
		msg += `\n\nFields:`;
		for (const [k, v] of Object.entries(payload.fields)) msg += `\n- ${k}: ${v}`;
	}
	return msg;
}

export function formatErr(e: unknown): string {
	if (e instanceof Error) return e.message;
	return String(e);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /api/v1/datasets (multipart)
export async function postDataset(file: File): Promise<{ id: string }> {
	const fd = new FormData();
	fd.set("kind", "course_offerings");
	fd.set("archive", file);

	const res = await fetch("/api/v1/datasets", { method: "POST", body: fd });
	const payload = await safeJson(res);
	if (res.status === 202) return payload;

	throw new Error(formatHttpError(res, payload));
}

// GET /api/v1/datasets/:id until completed/failed
export async function pollDatasetJob(id: string, onTick?: (job: DatasetJob) => void): Promise<DatasetJob> {
	const maxAttempts = 80;
	for (let i = 0; i < maxAttempts; i++) {
		const res = await fetch(`/api/v1/datasets/${encodeURIComponent(id)}`, { method: "GET" });
		const payload = await safeJson(res);

		if (!res.ok) throw new Error(formatHttpError(res, payload));
		onTick?.(payload);

		if (payload.status === "completed" || payload.status === "failed") return payload;
		await sleep(200);
	}
	throw new Error("Timed out waiting for dataset processing to finish.");
}

// GET /api/v1/courses?limit=&offset= (paginated)
export async function listAllCourses(): Promise<Course[]> {
	const all: Course[] = [];
	let offset = 0;
	const limit = 5000;

	while (true) {
		const res = await fetch(`/api/v1/courses?limit=${limit}&offset=${offset}`, { method: "GET" });
		const payload = await safeJson(res);
		if (!res.ok) throw new Error(formatHttpError(res, payload));
		if (!payload || !Array.isArray(payload.items)) return all;

		for (const c of payload.items) all.push(c);

		offset += payload.items.length;
		if (offset >= (payload.total ?? offset) || payload.items.length === 0) break;
	}
	return all;
}

// DELETE /api/v1/courses/:course
export async function deleteCourse(courseId: string): Promise<void> {
	const res = await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
	const payload = await safeJson(res);
	if (!res.ok) throw new Error(formatHttpError(res, payload));
}

export type WhereClause = Record<string, unknown>;

export type SearchOptions = {
	COLUMNS: string[];
	ORDER?: string;
};

// POST /api/v1/search
export async function postSearch(where: WhereClause, order?: string): Promise<OfferingRow[]> {
	const OPTIONS: SearchOptions = { COLUMNS: ["dept", "code", "title", "year", "instructor", "avg"] };
	if (order) OPTIONS.ORDER = order;

	const res = await fetch("/api/v1/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "course_offerings", query: { WHERE: where, OPTIONS } }),
	});

	const payload = await safeJson(res);

	if (res.status === 413) {
		throw new Error("Too many results (> 5000).\nPlease narrow filters (choose depts, set year range, or instructor).");
	}
	if (!res.ok) throw new Error(formatHttpError(res, payload));
	if (!Array.isArray(payload)) throw new Error("Unexpected response from /api/v1/search (expected an array).");

	return payload;
}

// POST /api/v2/search (falls back to /api/v1/search on 404) — used by Data Insights.
// Fetched dept-by-dept by the caller to stay under the server's 5000-row limit.
export async function fetchInsightRowsForDept(dept: string): Promise<InsightRow[]> {
	const body = JSON.stringify({
		kind: "course_offerings",
		query: {
			WHERE: { IS: { dept } },
			OPTIONS: { COLUMNS: ["dept", "code", "year", "avg", "pass", "fail", "audit"] },
		},
	});

	let res = await fetch("/api/v2/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
	if (res.status === 404) {
		res = await fetch("/api/v1/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});
	}

	const payload = await safeJson(res);
	if (!res.ok || !Array.isArray(payload)) return [];
	return payload;
}
