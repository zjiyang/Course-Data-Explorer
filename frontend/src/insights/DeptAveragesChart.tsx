// Insight 1: Department Average Grades (horizontal bar).
// Aggregation ported 1:1 from legacy-vanilla/frontend.js buildInsight1/renderInsight1.

import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import type { InsightRow } from "../types";
import { CHART_BASE, CHART_COLORS, redToBlue } from "./chartTheme";
import "./registerChartJs";

type SortMode = "avg" | "dept";
type LimitMode = "20" | "40" | "all";

export default function DeptAveragesChart({ allSections }: { allSections: InsightRow[] }) {
	const [sortMode, setSortMode] = useState<SortMode>("avg");
	const [limitMode, setLimitMode] = useState<LimitMode>("20");

	const raw = useMemo(() => {
		const deptTotals: Record<string, { sum: number; count: number }> = {};
		for (const r of allSections) {
			if (typeof r.avg !== "number") continue;
			if (typeof r.year === "number" && r.year < 2000) continue; // skip 1900 "overall" rows
			if (!deptTotals[r.dept]) deptTotals[r.dept] = { sum: 0, count: 0 };
			deptTotals[r.dept].sum += r.avg;
			deptTotals[r.dept].count++;
		}
		return Object.entries(deptTotals).map(([dept, { sum, count }]) => ({
			dept,
			avg: Math.round((sum / count) * 100) / 100,
		}));
	}, [allSections]);

	const { labels, values, colors, minV } = useMemo(() => {
		let data = [...raw];
		if (sortMode === "avg") data.sort((a, b) => b.avg - a.avg);
		else data.sort((a, b) => a.dept.localeCompare(b.dept));

		if (limitMode !== "all") {
			const n = parseInt(limitMode, 10);
			data = data.slice(0, n);
		}

		const labels = data.map((d) => d.dept.toUpperCase());
		const values = data.map((d) => d.avg);
		const maxV = Math.max(...values, 1);
		const minV = Math.min(...values, 0);
		const colors = values.map((v) => redToBlue((v - minV) / (maxV - minV || 1)));
		return { labels, values, colors, minV };
	}, [raw, sortMode, limitMode]);

	return (
		<div>
			<div className="row space-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
				<div>
					<strong>Department Average Grades</strong>
					<div className="hint">Which departments consistently outperform or underperform across all years?</div>
				</div>
				<div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
					<label className="muted" style={{ fontSize: 13 }}>
						Sort:
					</label>
					<select
						value={sortMode}
						onChange={(e) => setSortMode(e.target.value as SortMode)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
					>
						<option value="avg">By average ↓</option>
						<option value="dept">Dept A–Z</option>
					</select>
					<label className="muted" style={{ fontSize: 13 }}>
						Show:
					</label>
					<select
						value={limitMode}
						onChange={(e) => setLimitMode(e.target.value as LimitMode)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
					>
						<option value="20">Top 20</option>
						<option value="40">Top 40</option>
						<option value="all">All</option>
					</select>
				</div>
			</div>

			<div className="insight-use-case">
				💡 <strong>Decision value:</strong> Department heads can identify disciplines with persistently high or low grade
				averages — flagging candidates for curriculum review or student support allocation.
			</div>

			<div style={{ position: "relative", height: 420, marginTop: 14 }}>
				<Bar
					data={{ labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] }}
					options={{
						...CHART_BASE,
						indexAxis: "y" as const,
						scales: {
							x: {
								min: Math.max(0, minV - 3),
								grid: { color: "#eee" },
								ticks: { color: CHART_COLORS.muted },
								title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
							},
							y: {
								grid: { display: false },
								ticks: { color: CHART_COLORS.text, font: { size: 11 } },
							},
						},
						plugins: {
							...CHART_BASE.plugins,
							tooltip: {
								...CHART_BASE.plugins.tooltip,
								callbacks: {
									title: (items) => items[0].label,
									label: (item) => `Avg grade: ${(item.raw as number).toFixed(2)}`,
								},
							},
						},
					}}
				/>
			</div>

			<div className="hint" style={{ marginTop: 8 }}>
				Hover any bar for exact average. Computed across all sections and years in the dataset.
			</div>
		</div>
	);
}
