// Fetches & caches the raw section rows used by all three Data Insights charts.
// Ported from legacy-vanilla/frontend.js's fetchAllSectionsForInsights(): iterates
// depts one at a time (POST /api/v2/search, falling back to /api/v1/search) to
// stay under the backend's 5000-row search limit. Aggregation per-chart still
// happens in each chart component, mirroring buildInsight1/2/3 in the original.

import { useEffect, useRef, useState } from "react";
import { fetchInsightRowsForDept, formatErr } from "../api";
import type { InsightRow } from "../types";

export function useInsights(deptOptions: string[], dataVersion: number) {
	const [allSections, setAllSections] = useState<InsightRow[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const lastDataVersion = useRef(-1);

	useEffect(() => {
		if (deptOptions.length === 0) {
			setAllSections(null);
			return;
		}
		// Re-fetch when the dept list changes shape, or after an upload/clear
		// bumps dataVersion (mirrors `insightCache.allSections = null` resets).
		if (lastDataVersion.current === dataVersion && allSections !== null) return;
		lastDataVersion.current = dataVersion;

		let cancelled = false;
		(async () => {
			setLoading(true);
			setError("");
			try {
				const out: InsightRow[] = [];
				for (const dept of deptOptions) {
					const rows = await fetchInsightRowsForDept(dept);
					out.push(...rows);
				}
				if (!cancelled) {
					setAllSections(out);
					if (out.length === 0) setError("No data yet — upload a dataset to see insights.");
				}
			} catch (e) {
				if (!cancelled) setError(formatErr(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [deptOptions, dataVersion]);

	return { allSections, loading, error };
}
