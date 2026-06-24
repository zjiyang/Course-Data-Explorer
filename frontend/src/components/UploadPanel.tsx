import { useRef } from "react";

type Props = {
	uploading: boolean;
	uploadStatus: string;
	uploadResult: string;
	uploadError: string;
	onUpload: (file: File | null) => void;
	onTrySample: () => void;
	onClearData: () => void;
};

export default function UploadPanel({ uploading, uploadStatus, uploadResult, uploadError, onUpload, onTrySample, onClearData }: Props) {
	const fileInputRef = useRef<HTMLInputElement>(null);

	return (
		<section className="card">
			<h2>Dataset Upload</h2>

			<div className="row">
				<input ref={fileInputRef} type="file" accept=".zip" disabled={uploading} />
				<button
					className="button"
					disabled={uploading}
					onClick={() => onUpload(fileInputRef.current?.files?.[0] ?? null)}
				>
					Upload
				</button>
				<button
					className="button secondary"
					disabled={uploading}
					title="Upload a bundled sample dataset — no file needed"
					onClick={onTrySample}
				>
					Try Sample Data
				</button>
				<button
					className="button secondary"
					disabled={uploading}
					title="Delete all uploaded courses & sections"
					onClick={onClearData}
				>
					Clear Data
				</button>
			</div>

			<div className="row status">
				{uploading && <div className="spinner" aria-label="processing" />}
				<div className="muted">{uploadStatus}</div>
			</div>

			{uploadResult && <div className="result">{uploadResult}</div>}
			{uploadError && <div className="error">{uploadError}</div>}
		</section>
	);
}
