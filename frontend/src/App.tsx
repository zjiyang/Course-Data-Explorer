import { useEffect, useRef } from "react";
import UploadPanel from "./components/UploadPanel";
import FiltersPanel from "./components/FiltersPanel";
import ResultsTable from "./components/ResultsTable";
import InsightsPanel from "./insights/InsightsPanel";
import { useCourseExplorer } from "./hooks/useCourseExplorer";
import { useInsights } from "./hooks/useInsights";

export default function App() {
	const ce = useCourseExplorer();
	const insights = useInsights(ce.deptOptions, ce.dataVersion);

	// Mirrors initFromServer() + scheduleInsightRetry() from legacy-vanilla/frontend.js:
	// on first load, try to populate dept options; if none exist yet (e.g. seed.js
	// is still uploading on a fresh demo), poll every 2s for up to 2 minutes.
	const pollStarted = useRef(false);
	useEffect(() => {
		if (pollStarted.current) return;
		pollStarted.current = true;

		(async () => {
			const first = await ce.loadDeptOptions();
			if (first.length > 0) return;

			let attempts = 0;
			const MAX = 60;
			const timer = setInterval(async () => {
				attempts++;
				const sorted = await ce.loadDeptOptions();
				if (sorted.length > 0 || attempts >= MAX) clearInterval(timer);
			}, 2000);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const disabled = ce.uploading;

	return (
		<>
			<header className="header">
				<h1>Course Data Explorer</h1>
				<p className="muted">Upload a dataset, then explore offerings with filters & sorting (server-side).</p>
			</header>

			<UploadPanel
				uploading={ce.uploading}
				uploadStatus={ce.uploadStatus}
				uploadResult={ce.uploadResult}
				uploadError={ce.uploadError}
				onUpload={ce.handleUpload}
				onTrySample={ce.trySampleData}
				onClearData={ce.clearAllUploadedData}
			/>

			<FiltersPanel
				deptOptions={ce.deptOptions}
				selectedDepts={ce.selectedDepts}
				onSelectedDeptsChange={ce.setSelectedDepts}
				yearMin={ce.yearMin}
				onYearMinChange={ce.setYearMin}
				yearMax={ce.yearMax}
				onYearMaxChange={ce.setYearMax}
				instructor={ce.instructor}
				onInstructorChange={ce.setInstructor}
				onApply={() => ce.refreshTable()}
				onReset={() => ce.resetFilters()}
				queryError={ce.queryError}
				disabled={disabled}
			/>

			<ResultsTable
				rows={ce.rows}
				tableMeta={ce.tableMeta}
				sortKey={ce.sortKey}
				sortDir={ce.sortDir}
				onSort={ce.toggleSort}
			/>

			<InsightsPanel
				allSections={insights.allSections}
				deptOptions={ce.deptOptions}
				loading={insights.loading}
				error={insights.error}
			/>
		</>
	);
}
