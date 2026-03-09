import { useRef, useEffect, useState } from "react";

interface PreviewPaneProps {
	appUpdated: number;
	appName?: string;
}

export default function PreviewPane({ appUpdated, appName }: PreviewPaneProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [flash, setFlash] = useState(false);

	// Refresh iframe when app is updated
	useEffect(() => {
		if (appUpdated === 0) return;
		const iframe = iframeRef.current;
		if (iframe) {
			iframe.src = `http://localhost:3333/app-frame?t=${Date.now()}`;
			setFlash(true);
			const timer = setTimeout(() => setFlash(false), 600);
			return () => clearTimeout(timer);
		}
	}, [appUpdated]);

	return (
		<div style={containerStyle}>
			{/* Version bar */}
			<div style={versionBarStyle}>
				<span style={appNameStyle}>
					{appName || "Untitled App"}
				</span>
				<button
					onClick={() => {
						const iframe = iframeRef.current;
						if (iframe) {
							iframe.src = `http://localhost:3333/app-frame?t=${Date.now()}`;
						}
					}}
					style={refreshBtnStyle}
					title="Refresh preview"
				>
					&#8635;
				</button>
			</div>

			{/* Preview iframe */}
			<div
				style={{
					...iframeWrapperStyle,
					boxShadow: flash
						? "inset 0 0 0 2px #4ade80"
						: "none",
				}}
			>
				<iframe
					ref={iframeRef}
					src="http://localhost:3333/app-frame"
					style={iframeStyle}
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
					title="App Preview"
				/>
			</div>
		</div>
	);
}

const containerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	height: "100%",
	overflow: "hidden",
};

const versionBarStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "6px 12px",
	background: "#0a0a0a",
	borderBottom: "1px solid #1a1a1a",
	flexShrink: 0,
};

const appNameStyle: React.CSSProperties = {
	fontSize: 12,
	fontWeight: 500,
	color: "#888",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};

const refreshBtnStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	color: "#666",
	fontSize: 16,
	cursor: "pointer",
	padding: "2px 4px",
};

const iframeWrapperStyle: React.CSSProperties = {
	flex: 1,
	overflow: "hidden",
	transition: "box-shadow 0.3s ease-out",
	borderRadius: 4,
	margin: 4,
};

const iframeStyle: React.CSSProperties = {
	width: "100%",
	height: "100%",
	border: "none",
	background: "#000",
	borderRadius: 4,
};
