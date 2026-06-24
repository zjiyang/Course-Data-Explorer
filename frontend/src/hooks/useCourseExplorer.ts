// Owns upload, filter, and sortable-results-table state.
// Logic ported 1:1 from legacy-vanilla/frontend.js (handleUpload, clearAllUploadedData,
// refreshTable, buildQueryFromUI, loadDeptOptionsFromCourses) — same endpoints,
// same query-building rules, same 413-avoidance guard.

import { useCallback, useRef, useState } from "react";
import { deleteCourse, formatErr, listAllCourses, postDataset, postSearch, pollDatasetJob } from "../api";
import type { OfferingRow, SortDir, SortKey } from "../types";

export function useCourseExplorer() {
	const [deptOptions, setDeptOptions] = useState<string[]>([]);
	const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
	const [yearMin, setYearMin] = useState("");
	const [yearMax, setYearMax] = useState("");
	const [instructor, setInstructor] = useState("");

	const [sortKey, setSortKey] = useState<SortKey | null>(null);
	const [sortDir, setSortDir] = useState<SortDir>("UP");

	const [rows, setRows] = useState<OfferingRow[]>([]);
	const [tableMeta, setTableMeta] = useState("Upload a dataset to begin.");
	const [queryError, setQueryError] = useState("");

	const [uploading, setUploading] = useState(false);
	const [uploadStatus, setUploadStatus] = useState("No upload yet.");
	const [uploadResult, setUploadResult] = useState("");
	const [uploadError, setUploadError] = useState("");

	// Bumped whenever a fresh upload completes / data is cleared, so the
	// Insights hook knows to re-fetch instead of using its cache.
	const [dataVersion, setDataVersion] = useState(0);

	// Mirrors getSelectedValues() — kept as a ref so buildQueryFromUI-equivalent
	// closures always read the latest filter state without re-binding.
	type Filters = { selectedDepts: string[]; yearMin: string; yearMax: string; instructor: string; sortKey: SortKey | null; sortDir: SortDir };
	const filtersRef = useRef<Filters>({ selectedDepts, yearMin, yearMax, instructor, sortKey, sortDir });
	filtersRef.current = { selectedDepts, yearMin, yearMax, instructor, sortKey, sortDir };

	const loadDeptOptions = useCallback(async () => {
		try {
			const courses = await listAllCourses();
			const depts = new Set<string>();
			for (const c of courses) {
				if (typeof c.dept === "string" && c.dept.trim() !== "") depts.add(c.dept);
			}
			const sorted = Array.from(depts).sort((a, b) => a.localeCompare(b));
			setDeptOptions(sorted);
			// Keep selections that are still valid (mirrors preserving `selected` options).
			setSelectedDepts((prev) => prev.filter((d) => sorted.includes(d)));
			return sorted;
		} catch {
			setDeptOptions([]);
			return [];
		}
	}, []);

	// Accepts overrides so callers that just updated filter state (e.g. toggleSort,
	// resetFilters, handleUpload) can query with the new values immediately instead
	// of waiting for a re-render to land in filtersRef — avoids a stale-read race.
	const refreshTable = useCallback(async (overrides?: Partial<Filters>) => {
		setQueryError("");

		const f: Filters = { ...filtersRef.current, ...overrides };

		const hasAnyFilterSelected = f.selectedDepts.length > 0 || f.yearMin.trim() !== "" || f.yearMax.trim() !== "" || f.instructor.trim() !== "";
		if (!hasAnyFilterSelected) {
			setRows([]);
			setTableMeta("Select at least one filter (dept/year/instructor) then click Apply.");
			return;
		}

		setTableMeta("Loading…");

		const filters: Record<string, unknown>[] = [];

		if (f.selectedDepts.length > 0) {
			filters.push({ OR: f.selectedDepts.map((d) => ({ IS: { dept: d } })) });
		}
		const yearMinRaw = f.yearMin.trim();
		const yearMaxRaw = f.yearMax.trim();
		if (yearMinRaw !== "") {
			const n = Number(yearMinRaw);
			if (Number.isFinite(n)) filters.push({ GT: { year: n - 1 } }); // year >= n
		}
		if (yearMaxRaw !== "") {
			const n = Number(yearMaxRaw);
			if (Number.isFinite(n)) filters.push({ LT: { year: n + 1 } }); // year <= n
		}
		const instructorRaw = f.instructor.trim();
		if (instructorRaw !== "") {
			const cleaned = instructorRaw.replaceAll("*", "").trim();
			if (cleaned !== "") filters.push({ IS: { instructor: `*${cleaned}*` } });
		}

		let WHERE: Record<string, unknown> = {};
		if (filters.length === 1) WHERE = filters[0];
		else if (filters.length > 1) WHERE = { AND: filters };

		try {
			const res = await postSearch(WHERE, f.sortKey ?? undefined);
			const toRender = f.sortKey && f.sortDir === "DOWN" ? [...res].reverse() : res;
			setRows(toRender);
			setTableMeta(`Rows: ${res.length}` + (f.sortKey ? ` | Sorted by: ${f.sortKey} ${f.sortDir === "UP" ? "▲" : "▼"}` : ""));
		} catch (e) {
			setTableMeta("");
			setRows([]);
			setQueryError(formatErr(e));
		}
	}, []);

	const toggleSort = useCallback(
		(key: SortKey) => {
			const f = filtersRef.current;
			const newDir: SortDir = f.sortKey === key && f.sortDir === "UP" ? "DOWN" : "UP";
			setSortKey(key);
			setSortDir(newDir);
			refreshTable({ sortKey: key, sortDir: newDir });
		},
		[refreshTable]
	);

	const resetFilters = useCallback(async () => {
		// autoSelectFirstDeptIfNone()
		const newSelected = deptOptions.length > 0 ? [deptOptions[0]] : [];
		setSortKey(null);
		setSortDir("UP");
		setSelectedDepts(newSelected);
		setYearMin("");
		setYearMax("");
		setInstructor("");
		await refreshTable({ sortKey: null, sortDir: "UP", selectedDepts: newSelected, yearMin: "", yearMax: "", instructor: "" });
	}, [deptOptions, refreshTable]);

	const handleUpload = useCallback(
		async (file: File | null) => {
			setUploadError("");
			setUploadResult("");

			if (!file) {
				setUploadError("Please choose a .zip file first.");
				return;
			}

			setUploading(true);
			setUploadStatus("Uploading…");

			let jobId: string;
			try {
				const postRes = await postDataset(file);
				jobId = postRes.id;
			} catch (e) {
				setUploadStatus("Upload failed.");
				setUploadError(formatErr(e));
				setUploading(false);
				return;
			}

			setUploadStatus(`Processing… (job: ${jobId})`);

			try {
				const finalJob = await pollDatasetJob(jobId, (job) => {
					setUploadStatus(`Processing… status=${job.status}`);
				});

				if (finalJob.status === "completed") {
					setUploadStatus("Completed ✅");
					const s = finalJob.stats || {};
					setUploadResult(
						[
							`Dataset processing complete.`,
							`Courses: added=${s.courses_added ?? "?"}, modified=${s.courses_modified ?? "?"}`,
							`Sections: added=${s.sections_added ?? "?"}, modified=${s.sections_modified ?? "?"}`,
						].join("\n")
					);

					const sorted = await loadDeptOptions();
					const currentSelected = filtersRef.current.selectedDepts;
					const newSelected = currentSelected.length > 0 ? currentSelected : sorted.length > 0 ? [sorted[0]] : [];
					setSelectedDepts(newSelected);
					setDataVersion((v) => v + 1);
					await refreshTable({ selectedDepts: newSelected });
				} else {
					setUploadStatus("Failed ❌");
					setUploadError(finalJob.message || "Upload failed.");
				}
			} catch (e) {
				setUploadStatus("Upload failed.");
				setUploadError(formatErr(e));
			} finally {
				setUploading(false);
			}
		},
		[loadDeptOptions, refreshTable]
	);

	const trySampleData = useCallback(async () => {
		setUploadError("");
		setUploadResult("");
		setUploading(true);
		setUploadStatus("Fetching sample dataset…");

		try {
			const res = await fetch("/samples/courses-dataset.zip");
			if (!res.ok) throw new Error(`Failed to fetch sample dataset (HTTP ${res.status})`);
			const blob = await res.blob();
			const file = new File([blob], "courses-dataset.zip", { type: "application/zip" });
			await handleUpload(file);
		} catch (e) {
			setUploadStatus("Upload failed.");
			setUploadError(formatErr(e));
			setUploading(false);
		}
	}, [handleUpload]);

	const clearAllUploadedData = useCallback(async () => {
		setUploadError("");
		setUploadResult("");
		setQueryError("");
		setUploading(true);
		setUploadStatus("Clearing uploaded data…");

		try {
			const courses = await listAllCourses();
			let removed = 0;
			for (const c of courses) {
				await deleteCourse(c.id as string);
				removed++;
				setUploadStatus(`Clearing uploaded data… (${removed}/${courses.length})`);
			}

			setUploadStatus("All uploaded data cleared ✅");
			setUploadResult(`Deleted courses: ${removed}`);

			setSortKey(null);
			setSortDir("UP");
			setSelectedDepts([]);
			setRows([]);
			setTableMeta("No data. Upload a dataset to begin.");

			await loadDeptOptions();
			setDataVersion((v) => v + 1);
		} catch (e) {
			setUploadStatus("Clear data failed.");
			setUploadError(formatErr(e));
		} finally {
			setUploading(false);
		}
	}, [loadDeptOptions]);

	return {
		deptOptions,
		selectedDepts,
		setSelectedDepts,
		yearMin,
		setYearMin,
		yearMax,
		setYearMax,
		instructor,
		setInstructor,
		sortKey,
		sortDir,
		toggleSort,
		rows,
		tableMeta,
		queryError,
		uploading,
		uploadStatus,
		uploadResult,
		uploadError,
		dataVersion,
		loadDeptOptions,
		refreshTable,
		resetFilters,
		handleUpload,
		trySampleData,
		clearAllUploadedData,
	};
}
