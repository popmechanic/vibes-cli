import { useState, useEffect, useCallback, useRef } from "react";
import PreviewPane from "./PreviewPane.tsx";
import ChatPane from "./ChatPane.tsx";
import ThemeCarousel from "./ThemeCarousel.tsx";
import DeployPanel from "./DeployPanel.tsx";
import AppGallery from "./AppGallery.tsx";
import type { ThemeEntry } from "../../shared/rpc-types.ts";
import type { StreamState } from "../hooks/useRPC.ts";

interface EditPhaseProps {
	rpc: any;
	stream: StreamState;
	resetStream: () => void;
	appUpdated: number;
	appName?: string;
	onNewApp: () => void;
}

const MIN_PANE_WIDTH = 300;

export default function EditPhase({
	rpc,
	stream,
	resetStream,
	appUpdated,
	appName,
	onNewApp,
}: EditPhaseProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [splitRatio, setSplitRatio] = useState(0.5);
	const [isDragging, setIsDragging] = useState(false);
	const [showThemes, setShowThemes] = useState(false);
	const [themes, setThemes] = useState<ThemeEntry[]>([]);
	const [isSwitchingTheme, setIsSwitchingTheme] = useState(false);
	const [showDeploy, setShowDeploy] = useState(false);
	const [showGallery, setShowGallery] = useState(false);
	const [saveStatus, setSaveStatus] = useState<string | null>(null);

	// Cmd+S to save
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				handleSave();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [appName]);

	const handleSave = useCallback(async () => {
		const name = appName || "untitled";
		setSaveStatus("Saving...");
		await rpc.request.saveApp({ name });
		setSaveStatus("Saved!");
		setTimeout(() => setSaveStatus(null), 2000);
	}, [rpc, appName]);

	const handleLoadFromGallery = useCallback(
		async (name: string) => {
			await rpc.request.loadApp({ name });
			setShowGallery(false);
		},
		[rpc],
	);

	// Load themes once
	useEffect(() => {
		(async () => {
			const result = await rpc.request.getThemes({});
			setThemes(result.themes);
		})();
	}, []);

	const handleThemeSelect = useCallback(
		async (themeId: string) => {
			setShowThemes(false);
			setIsSwitchingTheme(true);
			resetStream();
			await rpc.request.switchTheme({ themeId });
		},
		[rpc, resetStream],
	);

	// Watch for theme switch completion
	useEffect(() => {
		if ((stream.done || stream.error) && isSwitchingTheme) {
			setIsSwitchingTheme(false);
		}
	}, [stream.done, stream.error, isSwitchingTheme]);

	const handleSplitterMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsDragging(true);

			const onMouseMove = (moveEvent: MouseEvent) => {
				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();
				const x = moveEvent.clientX - rect.left;
				const ratio = x / rect.width;
				// Clamp so each pane gets at least MIN_PANE_WIDTH
				const minRatio = MIN_PANE_WIDTH / rect.width;
				const maxRatio = 1 - minRatio;
				setSplitRatio(Math.min(maxRatio, Math.max(minRatio, ratio)));
			};

			const onMouseUp = () => {
				setIsDragging(false);
				document.removeEventListener("mousemove", onMouseMove);
				document.removeEventListener("mouseup", onMouseUp);
			};

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		},
		[],
	);

	return (
		<div style={wrapperStyle}>
			{/* Gallery modal */}
			{showGallery && (
				<AppGallery
					rpc={rpc}
					onLoad={handleLoadFromGallery}
					onClose={() => setShowGallery(false)}
				/>
			)}

			{/* Deploy modal */}
			{showDeploy && (
				<DeployPanel
					rpc={rpc}
					appName={appName}
					onClose={() => setShowDeploy(false)}
				/>
			)}

			{/* Header bar */}
			<div style={headerStyle}>
				<span style={headerTitleStyle}>
					{appName || "Untitled App"}
				</span>
				<div style={headerActionsStyle}>
					<button
						onClick={() => setShowThemes(!showThemes)}
						style={{
							...headerBtnStyle,
							...(showThemes ? { borderColor: "#e94560", color: "#e94560" } : {}),
						}}
						disabled={isSwitchingTheme}
					>
						{isSwitchingTheme ? "Switching..." : "Theme"}
					</button>
					<button onClick={handleSave} style={headerBtnStyle}>
						{saveStatus || "Save"}
					</button>
					<button
						onClick={() => setShowGallery(true)}
						style={headerBtnStyle}
					>
						Apps
					</button>
					<button
						onClick={() => setShowDeploy(true)}
						style={{
							...headerBtnStyle,
							background: "#e94560",
							color: "#fff",
							borderColor: "#e94560",
						}}
					>
						Deploy
					</button>
					<button onClick={onNewApp} style={headerBtnStyle}>
						New App
					</button>
				</div>
			</div>

			{/* Theme overlay */}
			{showThemes && themes.length > 0 && (
				<div style={themeOverlayStyle}>
					<ThemeCarousel
						themes={themes}
						selected=""
						onSelect={handleThemeSelect}
					/>
				</div>
			)}

			{/* Split pane */}
			<div
				ref={containerRef}
				style={{
					...splitContainerStyle,
					cursor: isDragging ? "col-resize" : "default",
					// Prevent text selection during drag
					userSelect: isDragging ? "none" : "auto",
				}}
			>
				{/* Preview */}
				<div style={{ width: `${splitRatio * 100}%`, minWidth: MIN_PANE_WIDTH, height: "100%" }}>
					<PreviewPane
						appUpdated={appUpdated}
						appName={appName}
					/>
				</div>

				{/* Splitter */}
				<div
					onMouseDown={handleSplitterMouseDown}
					style={{
						...splitterStyle,
						background: isDragging ? "#e94560" : "#1a1a1a",
					}}
				/>

				{/* Chat */}
				<div style={{ flex: 1, minWidth: MIN_PANE_WIDTH, height: "100%" }}>
					<ChatPane
						rpc={rpc}
						stream={stream}
						resetStream={resetStream}
					/>
				</div>
			</div>
		</div>
	);
}

const wrapperStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "8px 16px",
	background: "#0a0a0a",
	borderBottom: "1px solid #1a1a1a",
	flexShrink: 0,
};

const headerTitleStyle: React.CSSProperties = {
	fontSize: 14,
	fontWeight: 600,
	color: "#ccc",
};

const headerActionsStyle: React.CSSProperties = {
	display: "flex",
	gap: 8,
};

const headerBtnStyle: React.CSSProperties = {
	background: "#1a1a1a",
	color: "#999",
	border: "1px solid #222",
	borderRadius: 6,
	padding: "4px 12px",
	fontSize: 12,
	cursor: "pointer",
};

const themeOverlayStyle: React.CSSProperties = {
	padding: "8px 16px",
	background: "#0a0a0a",
	borderBottom: "1px solid #1a1a1a",
	flexShrink: 0,
};

const splitContainerStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	overflow: "hidden",
};

const splitterStyle: React.CSSProperties = {
	width: 4,
	cursor: "col-resize",
	flexShrink: 0,
	transition: "background 0.15s",
};
