import type { ThemeEntry } from "../../shared/rpc-types.ts";

interface ThemeCarouselProps {
	themes: ThemeEntry[];
	selected: string;
	onSelect: (themeId: string) => void;
}

export default function ThemeCarousel({
	themes,
	selected,
	onSelect,
}: ThemeCarouselProps) {
	if (themes.length === 0) {
		return (
			<p style={{ color: "#666", fontSize: 13, margin: 0 }}>
				No themes available
			</p>
		);
	}

	return (
		<div style={containerStyle}>
			<div style={scrollStyle}>
				{themes.map((theme) => (
					<button
						key={theme.id}
						onClick={() => onSelect(theme.id)}
						style={{
							...cardStyle,
							borderColor:
								selected === theme.id
									? "#e94560"
									: "#222",
							boxShadow:
								selected === theme.id
									? "0 0 0 1px #e94560"
									: "none",
						}}
					>
						{/* Color swatches */}
						<div style={swatchRowStyle}>
							{Object.entries(theme.colors).map(
								([key, color]) => (
									<div
										key={key}
										style={{
											...swatchStyle,
											background: color,
										}}
										title={`${key}: ${color}`}
									/>
								),
							)}
						</div>
						<div style={nameStyle}>{theme.name}</div>
						<div style={moodStyle}>{theme.mood}</div>
					</button>
				))}
			</div>
		</div>
	);
}

const containerStyle: React.CSSProperties = {
	width: "100%",
	overflow: "hidden",
};

const scrollStyle: React.CSSProperties = {
	display: "flex",
	gap: 10,
	overflowX: "auto",
	padding: "4px 2px",
	scrollbarWidth: "thin",
	scrollbarColor: "#333 transparent",
};

const cardStyle: React.CSSProperties = {
	flexShrink: 0,
	width: 120,
	padding: "10px 8px",
	background: "#111",
	border: "1px solid #222",
	borderRadius: 8,
	cursor: "pointer",
	textAlign: "center",
	transition: "border-color 0.2s, box-shadow 0.2s",
	display: "flex",
	flexDirection: "column",
	gap: 6,
};

const swatchRowStyle: React.CSSProperties = {
	display: "flex",
	gap: 4,
	justifyContent: "center",
};

const swatchStyle: React.CSSProperties = {
	width: 14,
	height: 14,
	borderRadius: "50%",
	border: "1px solid #333",
};

const nameStyle: React.CSSProperties = {
	fontSize: 12,
	fontWeight: 600,
	color: "#e0e0e0",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};

const moodStyle: React.CSSProperties = {
	fontSize: 10,
	color: "#666",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};
