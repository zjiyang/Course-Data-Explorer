// Shared Chart.js styling, ported 1:1 from legacy-vanilla/frontend.js so the
// three Data Insights charts look identical after the React rewrite.

export const CHART_COLORS = {
	blue: "#3f51b5",
	blueFaded: "rgba(63,81,181,0.15)",
	border: "#ddd",
	muted: "#555",
	text: "#111",
	danger: "#b00020",
	ok: "#0b6b0b",
};

export const CHART_BASE = {
	responsive: true,
	maintainAspectRatio: false,
	animation: { duration: 350 },
	plugins: {
		legend: { display: false },
		tooltip: {
			backgroundColor: "white",
			borderColor: "#ddd",
			borderWidth: 1,
			titleColor: "#111",
			bodyColor: "#555",
			padding: 10,
			cornerRadius: 8,
		},
	},
};

/** Interpolate from #e53935 (red, t=0) to #3f51b5 (blue, t=1). Used by Insight 1. */
export function redToBlue(t: number): string {
	const r = Math.round(229 - (229 - 63) * t);
	const g = Math.round(57 + (81 - 57) * t);
	const b = Math.round(53 + (181 - 53) * t);
	return `rgba(${r},${g},${b},0.82)`;
}

/** Interpolate from #3f51b5 (blue, t=0) to #e53935 (red, t=1). Used by Insight 3. */
export function blueToRed(t: number): string {
	const r = Math.round(63 + (229 - 63) * t);
	const g = Math.round(81 + (57 - 81) * t);
	const b = Math.round(181 + (53 - 181) * t);
	return `rgba(${r},${g},${b},0.72)`;
}
