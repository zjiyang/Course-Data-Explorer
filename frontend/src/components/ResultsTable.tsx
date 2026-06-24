import type { OfferingRow, SortDir, SortKey } from "../types";

type Column = { key: SortKey; label: string };

const COLUMNS: Column[] = [
	{ key: "dept", label: "dept" },
	{ key: "code", label: "code" },
	{ key: "title", label: "title" },
	{ key: "year", label: "year" },
	{ key: "instructor", label: "instructor" },
	{ key: "avg", label: "avg" },
];

function formatAvg(v: number): string {
	if (typeof v !== "number") return "";
	return String(Math.round(v * 10) / 10);
}

type Props = {
	rows: OfferingRow[];
	tableMeta: string;
	sortKey: SortKey | null;
	sortDir: SortDir;
	onSort: (key: SortKey) => void;
};

export default function ResultsTable({ rows, tableMeta, sortKey, sortDir, onSort }: Props) {
	return (
		<section className="card">
			<div className="row space-between">
				<h2>Offerings</h2>
				<div className="muted">{tableMeta}</div>
			</div>

			<div className="table-wrap">
				<table>
					<thead>
						<tr>
							{COLUMNS.map((col) => (
								<th key={col.key} onClick={() => onSort(col.key)}>
									{col.label}
									{sortKey === col.key ? (sortDir === "UP" ? " ▲" : " ▼") : ""}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r, i) => (
							<tr key={`${r.dept}-${r.code}-${r.year}-${r.instructor}-${i}`}>
								<td>{r.dept ?? ""}</td>
								<td>{r.code ?? ""}</td>
								<td>{r.title ?? ""}</td>
								<td>{r.year ?? ""}</td>
								<td>{r.instructor ?? ""}</td>
								<td>{formatAvg(r.avg)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="muted small">Click a column header to sort (server-side). Click again to toggle ▲/▼.</div>
		</section>
	);
}
