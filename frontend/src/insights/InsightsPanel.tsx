// Data Insights tabbed container — ported from the <section class="card"> with
// .insight-tab / .insight-panel markup in legacy-vanilla/index.html.
// All three charts are mounted at once (visibility toggled via CSS) so chart
// instances persist across tab switches, mirroring the original's behavior.

import { useState } from "react";
import type { InsightRow } from "../types";
import DeptAveragesChart from "./DeptAveragesChart";
import GradeTrendsChart from "./GradeTrendsChart";
import PassVsFailChart from "./PassVsFailChart";

type Tab = 1 | 2 | 3;

type Props = {
	allSections: InsightRow[] | null;
	deptOptions: string[];
	loading: boolean;
	error: string;
};

const TABS: { id: Tab; label: string }[] = [
	{ id: 1, label: "📊 Dept Averages" },
	{ id: 2, label: "📈 Grade Trends" },
	{ id: 3, label: "⚠ Pass vs Fail" },
];

export default function InsightsPanel({ allSections, deptOptions, loading, error }: Props) {
	const [active, setActive] = useState<Tab>(1);

	return (
		<section className="card">
			<h2>Data Insights</h2>
			<p className="muted" style={{ marginBottom: 14 }}>
				Visual analysis of the uploaded dataset. Charts load automatically — no filters needed.
			</p>

			<div className="row" style={{ gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
				{TABS.map((t) => (
					<button key={t.id} className={`insight-tab${active === t.id ? " active" : ""}`} onClick={() => setActive(t.id)}>
						{t.label}
					</button>
				))}
			</div>

			{!allSections || allSections.length === 0 ? (
				<div className="error">
					{loading ? "Loading insights…" : error || "No data yet — upload a dataset to see insights."}
				</div>
			) : (
				<>
					<div style={{ display: active === 1 ? "" : "none" }}>
						<DeptAveragesChart allSections={allSections} />
					</div>
					<div style={{ display: active === 2 ? "" : "none" }}>
						<GradeTrendsChart allSections={allSections} deptOptions={deptOptions} />
					</div>
					<div style={{ display: active === 3 ? "" : "none" }}>
						<PassVsFailChart allSections={allSections} />
					</div>
					{error && <div className="error">{error}</div>}
				</>
			)}
		</section>
	);
}
