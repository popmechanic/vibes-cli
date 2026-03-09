import { useState, useEffect } from "react";
import type { AnimationEntry } from "../../shared/rpc-types.ts";

interface AnimationPickerProps {
	rpc: any;
	selected: string;
	onSelect: (animationId: string) => void;
}

export default function AnimationPicker({
	rpc,
	selected,
	onSelect,
}: AnimationPickerProps) {
	const [animations, setAnimations] = useState<AnimationEntry[]>([]);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (open && animations.length === 0) {
			(async () => {
				const result = await rpc.request.getAnimations({});
				setAnimations(result.animations);
			})();
		}
	}, [open]);

	return (
		<div style={wrapperStyle}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					...triggerStyle,
					...(selected ? { borderColor: "#6366f1", color: "#a5b4fc" } : {}),
				}}
			>
				{selected
					? animations.find((a) => a.id === selected)?.name || "Animation"
					: "Animation"}
			</button>

			{open && (
				<div style={dropdownStyle}>
					<button
						onClick={() => {
							onSelect("");
							setOpen(false);
						}}
						style={{
							...itemStyle,
							color: !selected ? "#e0e0e0" : "#888",
						}}
					>
						None
					</button>
					{animations.map((a) => (
						<button
							key={a.id}
							onClick={() => {
								onSelect(a.id);
								setOpen(false);
							}}
							style={{
								...itemStyle,
								color: selected === a.id ? "#a5b4fc" : "#ccc",
							}}
						>
							<span style={itemNameStyle}>{a.name}</span>
						</button>
					))}
					{animations.length === 0 && (
						<p style={emptyStyle}>Loading...</p>
					)}
				</div>
			)}
		</div>
	);
}

const wrapperStyle: React.CSSProperties = {
	position: "relative",
};

const triggerStyle: React.CSSProperties = {
	background: "none",
	border: "1px solid #222",
	borderRadius: 4,
	padding: "3px 8px",
	fontSize: 11,
	color: "#888",
	cursor: "pointer",
};

const dropdownStyle: React.CSSProperties = {
	position: "absolute",
	bottom: "100%",
	left: 0,
	marginBottom: 4,
	background: "#111",
	border: "1px solid #222",
	borderRadius: 6,
	padding: 4,
	minWidth: 160,
	maxHeight: 200,
	overflowY: "auto",
	zIndex: 50,
	display: "flex",
	flexDirection: "column",
	gap: 2,
};

const itemStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	padding: "6px 8px",
	fontSize: 12,
	cursor: "pointer",
	textAlign: "left",
	borderRadius: 4,
	display: "flex",
	flexDirection: "column",
	gap: 2,
};

const itemNameStyle: React.CSSProperties = {
	fontWeight: 500,
};

const emptyStyle: React.CSSProperties = {
	margin: 0,
	padding: 8,
	fontSize: 12,
	color: "#555",
	textAlign: "center",
};
