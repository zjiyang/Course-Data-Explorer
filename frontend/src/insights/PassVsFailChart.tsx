// Insight 3: Grade Average vs Failure Rate (scatter).
// Aggregation ported 1:1 from legacy-vanilla/frontend.js buildInsight3/renderInsight3.

import { useMemo, useState } from "react";
import { Scatter } from "react-chartjs-2";
import type { InsightRow } from "../types";
import { CHART_BASE, CHART_COLORS, blueToRed } from "./chartTheme";
import "./registerChartJs";

type ScatterPoint = { x: number; y: number; dept: string; code: string; total: number };

export default function PassVsFailChart({ allSections }: { allSections: InsightRow[] }) {
	const [deptFilter, setDeptFilter] = useState("all");
	const [minEnroll, setMinEnroll] = useState("30");

	const courses = useMemo(() => {
		type Totals = { dept: string; code: string; sumAvg: number; pass: number; fail: number; audit: number; count: number };
		const courseTotals: Record<string, Totals> = {};

		for (const r of allSections) {
			const key = `${r.dept}::${r.code}`;
			if (typeof r.year === "number" && r.year < 2000) continue; // skip 1900 "overall" rows
			if (!courseTotals[key]) {
				courseTotals[key] = { dept: r.dept, code: r.code, sumAvg: 0, pass: 0, fail: 0, audit: 0, count: 0 };
			}
			const c = courseTotals[key];
			if (typeof r.avg === "number") {
				c.sumAvg += r.avg;
				c.count++;
			}
			if (typeof r.pass === "number") c.pass += r.pass;
			if (typeof r.fail === "number") c.fail += r.fail;
			if (typeof r.audit === "number") c.audit += r.audit;
		}

		return Object.values(courseTotals).map((c) => {
			const total = c.pass + c.fail + c.audit;
			const failRate = total > 0 ? Math.round((c.fail / total) * 1000) / 10 : 0;
			const avg = c.count > 0 ? Math.round((c.sumAvg / c.count) * 100) / 100 : 0;
			return { dept: c.dept, code: c.code, avg, failRate, total };
		});
	}, [allSections]);

	const deptChoices = useMemo(() => Array.from(new Set(courses.map((c) => c.dept))).sort(), [courses]);

	const points: ScatterPoint[] = useMemo(() => {
		let data = courses.filter((c) => c.total >= Number(minEnroll));
		if (deptFilter !== "all") data = data.filter((c) => c.dept === deptFilter);
		return data.map((c) => ({ x: c.avg, y: c.failRate, dept: c.dept, code: c.code, total: c.total }));
	}, [courses, deptFilter, minEnroll]);

	const bgColors = useMemo(() => {
		const maxFail = Math.max(...points.map((p) => p.y), 1);
		return points.map((p) => blueToRed(p.y / maxFail));
	}, [points]);

	return (
		<div>
			<div className="row space-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
				<div>
					<strong>Grade Average vs Failure Rate</strong>
					<div className="hint">Which courses have high failure rates despite decent averages — or struggle across the board?</div>
				</div>
				<div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
					<label className="muted" style={{ fontSize: 13 }}>
						Dept:
					</label>
					<select
						value={deptFilter}
						onChange={(e) => setDeptFilter(e.target.value)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, minWidth: 120 }}
					>
						<option value="all">All departments</option>
						{deptChoices.map((d) => (
							<option key={d} value={d}>
								{d.toUpperCase()}
							</option>
						))}
					</select>
					<label className="muted" style={{ fontSize: 13 }}>
						Min enrolled:
					</label>
					<select
						value={minEnroll}
						onChange={(e) => setMinEnroll(e.target.value)}
						style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
					>
						<option value="10">≥ 10</option>
						<option value="30">≥ 30</option>
						<option value="100">≥ 100</option>
					</select>
				</div>
			</div>

			<div className="insight-use-case">
				💡 <strong>Decision value:</strong> Student advisors can pinpoint courses with unusually high failure rates, enabling
				targeted early-intervention programs and academic support prioritization.
			</div>

			<div style={{ position: "relative", height: 380, marginTop: 14 }}>
				<Scatter
					data={{ datasets: [{ data: points, backgroundColor: bgColors, pointRadius: 5, pointHoverRadius: 8 }] }}
					options={{
						...CHART_BASE,
						scales: {
							x: {
								grid: { color: "#eee" },
								ticks: { color: CHART_COLORS.muted },
								title: { display: true, text: "Average Grade", color: CHART_COLORS.muted },
							},
							y: {
								grid: { color: "#eee" },
								ticks: { color: CHART_COLORS.muted },
								title: { display: true, text: "Fail Rate (%)", color: CHART_COLORS.muted },
								min: 0,
							},
						},
						plugins: {
							...CHART_BASE.plugins,
							tooltip: {
								...CHART_BASE.plugins.tooltip,
								callbacks: {
									title: (items) => {
										const raw = items[0].raw as ScatterPoint;
										return `${raw.dept.toUpperCase()} ${raw.code}`;
									},
									label: (item) => {
										const raw = item.raw as ScatterPoint;
										return [`Avg grade: ${raw.x.toFixed(2)}`, `Fail rate: ${raw.y}%`, `Total enrolled: ${raw.total}`];
									},
								},
							},
						},
					}}
				/>
			</div>

			<div className="hint" style={{ marginTop: 8 }}>
				Each dot = one course. X = avg grade, Y = fail rate (%). Hover a dot for dept / code / details.
			</div>
		</div>
	);
}
