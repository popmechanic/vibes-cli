import { useState, useEffect, useRef, useCallback } from "react";
import ThemeCarousel from "./ThemeCarousel.tsx";
import AppGallery from "./AppGallery.tsx";
import type { ThemeEntry, AnimationEntry } from "../../shared/rpc-types.ts";
import type { StreamState } from "../hooks/useRPC.ts";

interface GeneratePhaseProps {
	rpc: any;
	stream: StreamState;
	resetStream: () => void;
	onGenerated: () => void;
}

export default function GeneratePhase({
	rpc,
	stream,
	resetStream,
	onGenerated,
}: GeneratePhaseProps) {
	const [prompt, setPrompt] = useState("");
	const [themes, setThemes] = useState<ThemeEntry[]>([]);
	const [animations, setAnimations] = useState<AnimationEntry[]>([]);
	const [selectedTheme, setSelectedTheme] = useState("");
	const [selectedAnimation, setSelectedAnimation] = useState("");
	const [designRef, setDesignRef] = useState<{
		type: "image" | "html";
		content: string;
		intent?: string;
	} | null>(null);
	const [showGallery, setShowGallery] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Load themes and animations
	useEffect(() => {
		(async () => {
			const [themeResult, animResult] = await Promise.all([
				rpc.request.getThemes({}),
				rpc.request.getAnimations({}),
			]);
			setThemes(themeResult.themes);
			setAnimations(animResult.animations);
			if (themeResult.themes.length > 0) {
				setSelectedTheme(themeResult.themes[0].id);
			}
		})();
	}, []);

	// Watch for generation completion
	useEffect(() => {
		if (stream.done && isGenerating) {
			setIsGenerating(false);
			onGenerated();
		}
		if (stream.error && isGenerating) {
			setIsGenerating(false);
		}
	}, [stream.done, stream.error, isGenerating]);

	const handleSubmit = useCallback(async () => {
		if (!prompt.trim() || isGenerating) return;

		resetStream();
		setIsGenerating(true);

		await rpc.request.generate({
			prompt: prompt.trim(),
			themeId: selectedTheme || undefined,
			animationId: selectedAnimation || undefined,
			designRef: designRef || undefined,
		});
	}, [prompt, selectedTheme, selectedAnimation, designRef, isGenerating]);

	const handleFileUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();

			if (
				file.type.startsWith("image/") ||
				file.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)
			) {
				reader.onload = () => {
					setDesignRef({
						type: "image",
						content: reader.result as string,
						intent: "match",
					});
				};
				reader.readAsDataURL(file);
			} else if (
				file.name.endsWith(".html") ||
				file.name.endsWith(".htm")
			) {
				reader.onload = () => {
					setDesignRef({
						type: "html",
						content: reader.result as string,
					});
				};
				reader.readAsText(file);
			}
		},
		[],
	);

	const handleLoadApp = useCallback(
		async (name: string) => {
			await rpc.request.loadApp({ name });
			setShowGallery(false);
			onGenerated(); // Go to edit phase
		},
		[rpc],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				handleSubmit();
			}
		},
		[handleSubmit],
	);

	return (
		<div style={containerStyle}>
			{/* Gallery modal */}
			{showGallery && (
				<AppGallery
					rpc={rpc}
					onLoad={handleLoadApp}
					onClose={() => setShowGallery(false)}
				/>
			)}

			<div style={contentStyle}>
				<h2 style={headingStyle}>What would you like to build?</h2>

				{/* Prompt */}
				<textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Describe your app... (e.g., a task tracker with categories and due dates)"
					style={textareaStyle}
					rows={4}
					disabled={isGenerating}
					autoFocus
				/>

				{/* Theme carousel */}
				{themes.length > 0 && (
					<div>
						<label style={labelStyle}>Theme</label>
						<ThemeCarousel
							themes={themes}
							selected={selectedTheme}
							onSelect={setSelectedTheme}
						/>
					</div>
				)}

				{/* Toolbar row */}
				<div style={toolbarStyle}>
					{/* Design ref upload */}
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*,.html,.htm"
						onChange={handleFileUpload}
						style={{ display: "none" }}
					/>
					<button
						onClick={() => fileInputRef.current?.click()}
						style={toolBtnStyle}
						disabled={isGenerating}
					>
						{designRef
							? `${designRef.type === "image" ? "Image" : "HTML"} ref attached`
							: "Upload Design"}
					</button>
					{designRef && (
						<button
							onClick={() => setDesignRef(null)}
							style={{
								...toolBtnStyle,
								color: "#ef4444",
								borderColor: "#3f1515",
							}}
						>
							Remove
						</button>
					)}

					{/* Animation picker */}
					{animations.length > 0 && (
						<select
							value={selectedAnimation}
							onChange={(e) =>
								setSelectedAnimation(e.target.value)
							}
							style={selectStyle}
							disabled={isGenerating}
						>
							<option value="">No animation</option>
							{animations.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</select>
					)}

					{/* Gallery button */}
					<button
						onClick={() => setShowGallery(true)}
						style={{ ...toolBtnStyle, marginLeft: "auto" }}
					>
						Saved Apps
					</button>
				</div>

				{/* Submit */}
				<button
					onClick={handleSubmit}
					disabled={!prompt.trim() || isGenerating}
					style={{
						...submitBtnStyle,
						opacity:
							!prompt.trim() || isGenerating ? 0.5 : 1,
					}}
				>
					{isGenerating ? "Generating..." : "Generate App"}
				</button>

				{/* Progress */}
				{isGenerating && stream.status && (
					<div style={progressContainerStyle}>
						<div style={progressBarBgStyle}>
							<div
								style={{
									...progressBarFillStyle,
									width: `${stream.status.progress || 5}%`,
								}}
							/>
						</div>
						<p style={progressLabelStyle}>
							{stream.status.stage || "Working..."}
						</p>
					</div>
				)}

				{/* Error */}
				{stream.error && (
					<p style={errorStyle}>{stream.error.message}</p>
				)}

				{/* Streaming tokens preview */}
				{isGenerating && stream.tokens && (
					<div style={streamPreviewStyle}>
						{stream.tokens.slice(-200)}
					</div>
				)}
			</div>
		</div>
	);
}

// --- Styles ---
const containerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 40,
	position: "relative",
};

const contentStyle: React.CSSProperties = {
	maxWidth: 640,
	width: "100%",
	display: "flex",
	flexDirection: "column",
	gap: 16,
};

const headingStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 24,
	fontWeight: 600,
	color: "#e0e0e0",
	textAlign: "center",
};

const textareaStyle: React.CSSProperties = {
	width: "100%",
	background: "#111",
	color: "#e0e0e0",
	border: "1px solid #222",
	borderRadius: 8,
	padding: "12px 16px",
	fontSize: 15,
	fontFamily: "system-ui, -apple-system, sans-serif",
	resize: "vertical",
	outline: "none",
	boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
	display: "block",
	fontSize: 12,
	fontWeight: 500,
	color: "#666",
	marginBottom: 6,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
};

const toolbarStyle: React.CSSProperties = {
	display: "flex",
	gap: 8,
	flexWrap: "wrap",
	alignItems: "center",
};

const toolBtnStyle: React.CSSProperties = {
	background: "#0a0a0a",
	color: "#999",
	border: "1px solid #222",
	borderRadius: 6,
	padding: "6px 12px",
	fontSize: 12,
	cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
	background: "#0a0a0a",
	color: "#999",
	border: "1px solid #222",
	borderRadius: 6,
	padding: "6px 10px",
	fontSize: 12,
	cursor: "pointer",
};

const submitBtnStyle: React.CSSProperties = {
	background: "#e94560",
	color: "#fff",
	border: "none",
	borderRadius: 8,
	padding: "14px 28px",
	fontSize: 16,
	fontWeight: 600,
	cursor: "pointer",
	transition: "opacity 0.2s",
};

const progressContainerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 6,
};

const progressBarBgStyle: React.CSSProperties = {
	height: 4,
	background: "#1a1a1a",
	borderRadius: 2,
	overflow: "hidden",
};

const progressBarFillStyle: React.CSSProperties = {
	height: "100%",
	background: "#e94560",
	borderRadius: 2,
	transition: "width 0.5s ease-out",
};

const progressLabelStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 12,
	color: "#666",
};

const errorStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 13,
	color: "#ef4444",
	background: "#1a0505",
	padding: "8px 12px",
	borderRadius: 6,
	border: "1px solid #3f1515",
};

const streamPreviewStyle: React.CSSProperties = {
	background: "#0a0a0a",
	border: "1px solid #1a1a1a",
	borderRadius: 6,
	padding: "8px 12px",
	fontSize: 11,
	fontFamily: "monospace",
	color: "#555",
	maxHeight: 80,
	overflow: "hidden",
	whiteSpace: "pre-wrap",
	wordBreak: "break-all",
};
