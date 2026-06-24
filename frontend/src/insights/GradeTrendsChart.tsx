// Insight 2: Grade Trends Over Time (line).
// Aggregation ported 1:1 from legacy-vanilla/frontend.js buildInsight2/renderInsight2.

import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import type { Chart as ChartJS } from "chart.js";
import type { InsightRow } from "../types";
import { CHART_BASE, CHART_COLORS } from "./chartTheme";
import "./registerChartJs";

type Props = { allSections: InsightRow[]; deptOptions: string[] };

export default function GradeTrendsChart({ allSections, deptOptions }: Props) {
	const [dept, setDept] = useState<string>("");
	const [yearMinRaw, setYearMinRaw] = useState("");
	const [yearMaxRaw, setYearMaxRaw] = useState("");
	const chartRef = useRef<ChartJS<"line"> | null>(null);

	// Default to "cpsc" if available, else first dept — mirrors buildInsight2().
	useEffect(() => {
		if (dept && deptOptions.includes(dept)) return;
		if (deptOptions.includes("cpsc")) setDept("cpsc");
		else if (deptOptions.length > 0) setDept(deptOptions[0]);
	}, [deptOptions, dept]);

	const { labels, values } = useMemo(() => {
		const yearMin = yearMinRaw.trim() !== "" ? Number(yearMinRaw) : -Infinity;
		const yearMax = yearMaxRaw.trim() !== "" ? Number(yearMaxRaw) : Infinity;

		const yearTotals: Record<string, { sum: number; count: number }> = {};
		for (const r of allSections) {
			if (r.dept !== dept || typeof r.avg !== "number") continue;
			if (typeof r.year !== "number" || r.year < 2000) continue; // skip 1900 "overall" rows
			if (r.year < yearMin || r.year > yearMax) continue;
			const y = String(r.year);
			if (!yearTotals[y]) yearTotals[y] = { sum: 0, count: 0 };
			yearTotals[y].sum += r.avg;
			yearTotals[y].count++;
		}

		const sorted = Object.entries(yearTotals)
			.map(([year, { sum, count }]) => ({ year, avg: Math.round((sum / count) * 100) / 100 }))
			.sort((a, b) => Number(a.year) - Number(b.year));

		return { labels: sorted.map((r) => r.year), values: sorted.map((r) => r.avg) };
	}, [allSections, dept, yearMinRaw, yearMaxRaw]);

	const gradient = useMemo(() => {
		const chart = chartRef.current;
		if (!chart) return CHART_COLORS.blueFaded;
		const ctx = chart.ctx;
		const g = ctx.createLinearGradient(0, 0, 0, 340);
		g.addColorStop(0, "rgba(63,81,181,0.18)");
		g.addColorStop(1, "rgba(63,81,181,0)");
		return g;
		// re-derive each render so it tracks the live chart instance
	}, [labels, values]);

	return (
		<div>
			<div className="row space-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
				<div>
					<strong>Grade Trends Over Time</strong>
					<div className="hint">How has average performance shifted year-by-year within a department?</div>
				</div>
				<div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
					<label className="muted" style={{ fontSize: 13 }}>
						Department:
					</label>
					<select
						value={dept}
						onChange={(e) => setDept(e.target.value)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, minWidth: 120 }}
					>
						{deptOptions.map((d) => (
							<option key={d} value={d}>
								{d.toUpperCase()}
							</option>
						))}
					</select>
					<label className="muted" style={{ fontSize: 13 }}>
						Year from:
					</label>
					<input
						type="number"
						placeholder="e.g. 2010"
						value={yearMinRaw}
						onChange={(e) => setYearMinRaw(e.target.value)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 90 }}
					/>
					<label className="muted" style={{ fontSize: 13 }}>
						to:
					</label>
					<input
						type="number"
						placeholder="e.g. 2022"
						value={yearMaxRaw}
						onChange={(e) => setYearMaxRaw(e.target.value)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: 90 }}
					/>
				</div>
			</div>

			<div className="insight-use-case">
				💡 <strong>Decision value:</strong> Enrollment planners can detect long-term grade inflation, deflation, or sudden
				policy-driven shifts — enabling proactive course planning and resource forecasting.
			</div>

			<div style={{ position: "relative", height: 380, marginTop: 14 }}>
				<Line
					ref={chartRef}
					data={{
						labels,
						datasets: [
							{
								data: values,
								borderColor: CHART_COLORS.blue,
								backgroundColor: gradient,
								borderWidth: 2,
								pointBackgroundColor: CHART_COLORS.blue,
								pointRadius: 4,
								pointHoverRadius: 7,
								fill: true,
								tension: 0.35,
							},
						],
					}}
					options={{
						...CHART_BASE,
						scales: {
							x: {
								grid: { color: "#eee" },
								ticks: { color: CHART_COLORS.muted },
								title: { display: true, text: "Year", color: CHART_COLORS.muted },
							},
							y: {
								grid: { color: "#eee" },
								ticks: { color: CHART_COLORS.muted },
								title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
							},
						},
						plugins: {
							...CHART_BASE.plugins,
							tooltip: {
								...CHART_BASE.plugins.tooltip,
								callbacks: {
									title: (items) => `Year ${items[0].label}`,
									label: (item) => `Avg grade: ${(item.raw as number).toFixed(2)}`,
								},
							},
						},
					}}
				/>
			</div>

			<div className="hint" style={{ marginTop: 8 }}>
				Select a department and optional year range. Line shows the yearly average grade across all its sections.
			</div>
		</div>
	);
}
