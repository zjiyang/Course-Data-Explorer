// Shared types for the Course Data Explorer frontend.
// These mirror the REST API response shapes exactly — no backend changes.

export type DatasetJobStatus = "processing" | "completed" | "failed";

export type DatasetJob = {
	id: string;
	status: DatasetJobStatus;
	kind?: string;
	message?: string;
	stats?: {
		courses_added?: number;
		courses_modified?: number;
		sections_added?: number;
		sections_modified?: number;
		[key: string]: number | undefined;
	};
};

export type Course = {
	id: string;
	dept: string;
	[key: string]: unknown;
};

export type OfferingRow = {
	dept: string;
	code: string;
	title: string;
	year: number;
	instructor: string;
	avg: number;
};

export type InsightRow = {
	dept: string;
	code: string;
	year: number;
	avg: number;
	pass: number;
	fail: number;
	audit: number;
};

export type SortKey = "dept" | "code" | "title" | "year" | "instructor" | "avg";
export type SortDir = "UP" | "DOWN";

export type ApiError = Error & { fields?: Record<string, string> };
