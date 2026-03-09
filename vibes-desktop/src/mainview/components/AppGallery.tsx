import { useState, useEffect } from "react";
import type { AppEntry } from "../../shared/rpc-types.ts";

interface AppGalleryProps {
	rpc: any;
	onLoad: (name: string) => void;
	onClose: () => void;
}

export default function AppGallery({ rpc, onLoad, onClose }: AppGalleryProps) {
	const [apps, setApps] = useState<AppEntry[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			const result = await rpc.request.listApps({});
			setApps(result.apps);
			setLoading(false);
		})();
	}, []);

	const handleDelete = async (name: string) => {
		await rpc.request.deleteApp({ name });
		setApps((prev) => prev.filter((a) => a.name !== name));
	};

	return (
		<div style={overlayStyle}>
			<div style={modalStyle}>
				<div style={headerStyle}>
					<h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
						Saved Apps
					</h3>
					<button onClick={onClose} style={closeBtnStyle}>
						&#10005;
					</button>
				</div>

				{loading ? (
					<p style={emptyStyle}>Loading...</p>
				) : apps.length === 0 ? (
					<p style={emptyStyle}>No saved apps yet</p>
				) : (
					<div style={gridStyle}>
						{apps.map((app) => (
							<div key={app.name} style={appCardStyle}>
								<div style={thumbnailStyle}>
									<span style={{ fontSize: 24 }}>
										&#9881;
									</span>
								</div>
								<div style={appInfoStyle}>
									<span style={appNameStyle}>
										{app.name}
									</span>
								</div>
								<div style={appActionsStyle}>
									<button
										onClick={() => onLoad(app.name)}
										style={loadBtnStyle}
									>
										Load
									</button>
									<button
										onClick={() =>
											handleDelete(app.name)
										}
										style={deleteBtnStyle}
									>
										&#128465;
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

const overlayStyle: React.CSSProperties = {
	position: "absolute",
	inset: 0,
	background: "rgba(0,0,0,0.6)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 100,
};

const modalStyle: React.CSSProperties = {
	background: "#111",
	border: "1px solid #222",
	borderRadius: 12,
	width: "90%",
	maxWidth: 600,
	maxHeight: "70vh",
	overflow: "auto",
	padding: 20,
};

const headerStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 16,
};

const closeBtnStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	color: "#666",
	fontSize: 18,
	cursor: "pointer",
	padding: 4,
};

const emptyStyle: React.CSSProperties = {
	color: "#666",
	fontSize: 14,
	textAlign: "center",
	padding: 40,
};

const gridStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
	gap: 12,
};

const appCardStyle: React.CSSProperties = {
	background: "#0a0a0a",
	border: "1px solid #1a1a1a",
	borderRadius: 8,
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
};

const thumbnailStyle: React.CSSProperties = {
	height: 80,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background: "#0f0f0f",
	color: "#333",
};

const appInfoStyle: React.CSSProperties = {
	padding: "8px 10px 4px",
};

const appNameStyle: React.CSSProperties = {
	fontSize: 13,
	fontWeight: 500,
	color: "#ccc",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	display: "block",
};

const appActionsStyle: React.CSSProperties = {
	padding: "4px 10px 8px",
	display: "flex",
	gap: 6,
};

const loadBtnStyle: React.CSSProperties = {
	flex: 1,
	background: "#222",
	color: "#ccc",
	border: "none",
	borderRadius: 4,
	padding: "4px 8px",
	fontSize: 12,
	cursor: "pointer",
};

const deleteBtnStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	color: "#666",
	fontSize: 14,
	cursor: "pointer",
	padding: "2px 4px",
};
