type Props = {
	deptOptions: string[];
	selectedDepts: string[];
	onSelectedDeptsChange: (depts: string[]) => void;
	yearMin: string;
	onYearMinChange: (v: string) => void;
	yearMax: string;
	onYearMaxChange: (v: string) => void;
	instructor: string;
	onInstructorChange: (v: string) => void;
	onApply: () => void;
	onReset: () => void;
	queryError: string;
	disabled: boolean;
};

export default function FiltersPanel({
	deptOptions,
	selectedDepts,
	onSelectedDeptsChange,
	yearMin,
	onYearMinChange,
	yearMax,
	onYearMaxChange,
	instructor,
	onInstructorChange,
	onApply,
	onReset,
	queryError,
	disabled,
}: Props) {
	return (
		<section className="card">
			<h2>Filters</h2>

			<div className="grid">
				<div className="field">
					<label htmlFor="dept-select">Departments (multi-select)</label>
					<select
						id="dept-select"
						multiple
						size={6}
						disabled={disabled}
						value={selectedDepts}
						onChange={(e) => onSelectedDeptsChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
					>
						{deptOptions.map((d) => (
							<option key={d} value={d}>
								{d}
							</option>
						))}
					</select>
					<div className="hint">Tip: Ctrl/Cmd-click to select multiple.</div>
				</div>

				<div className="field">
					<label>Year range</label>
					<div className="row">
						<input
							type="number"
							placeholder="Min (e.g., 2015)"
							disabled={disabled}
							value={yearMin}
							onChange={(e) => onYearMinChange(e.target.value)}
						/>
						<input
							type="number"
							placeholder="Max (e.g., 2020)"
							disabled={disabled}
							value={yearMax}
							onChange={(e) => onYearMaxChange(e.target.value)}
						/>
					</div>
					<div className="hint">Leave blank for no bound.</div>
				</div>

				<div className="field">
					<label htmlFor="instructor-input">Instructor (partial match)</label>
					<input
						id="instructor-input"
						type="text"
						placeholder="e.g., holmes"
						disabled={disabled}
						value={instructor}
						onChange={(e) => onInstructorChange(e.target.value)}
					/>
					<div className="hint">Uses IS with *pattern*.</div>
				</div>

				<div className="field">
					<label>Actions</label>
					<div className="row">
						<button className="button" disabled={disabled} onClick={onApply}>
							Apply Filters
						</button>
						<button className="button secondary" disabled={disabled} onClick={onReset}>
							Reset
						</button>
					</div>
				</div>
			</div>

			{queryError && <div className="error">{queryError}</div>}
		</section>
	);
}
