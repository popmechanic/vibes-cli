import { useState, useEffect } from "react";
import type { SkillEntry } from "../../shared/rpc-types.ts";

interface SkillPickerProps {
	rpc: any;
	selected: string;
	onSelect: (skillId: string) => void;
}

export default function SkillPicker({
	rpc,
	selected,
	onSelect,
}: SkillPickerProps) {
	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (open && skills.length === 0) {
			(async () => {
				const result = await rpc.request.getSkills({});
				setSkills(result.skills);
			})();
		}
	}, [open]);

	return (
		<div style={wrapperStyle}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					...triggerStyle,
					...(selected ? { borderColor: "#22c55e", color: "#86efac" } : {}),
				}}
			>
				{selected
					? skills.find((s) => s.id === selected)?.name || "Skill"
					: "Skill"}
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
					{skills.map((s) => (
						<button
							key={s.id}
							onClick={() => {
								onSelect(s.id);
								setOpen(false);
							}}
							style={{
								...itemStyle,
								color: selected === s.id ? "#86efac" : "#ccc",
							}}
						>
							<span style={itemNameStyle}>{s.name}</span>
							{s.description && (
								<span style={itemDescStyle}>
									{s.description}
								</span>
							)}
						</button>
					))}
					{skills.length === 0 && (
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
	minWidth: 200,
	maxHeight: 240,
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

const itemDescStyle: React.CSSProperties = {
	fontSize: 10,
	color: "#666",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
};

const emptyStyle: React.CSSProperties = {
	margin: 0,
	padding: 8,
	fontSize: 12,
	color: "#555",
	textAlign: "center",
};
