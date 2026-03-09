import { useState, useEffect, useRef, useCallback } from "react";
import AnimationPicker from "./AnimationPicker.tsx";
import SkillPicker from "./SkillPicker.tsx";
import type { StreamState } from "../hooks/useRPC.ts";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	tools?: Array<{
		tool: string;
		input: string;
		output?: string;
		isError?: boolean;
	}>;
	cost?: number;
	duration?: number;
}

interface ChatPaneProps {
	rpc: any;
	stream: StreamState;
	resetStream: () => void;
}

export default function ChatPane({ rpc, stream, resetStream }: ChatPaneProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	const [selectedAnimation, setSelectedAnimation] = useState("");
	const [selectedSkill, setSelectedSkill] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Auto-scroll on new content
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, stream.tokens]);

	// Watch for stream completion
	useEffect(() => {
		if (stream.done && isSending) {
			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: stream.done!.text || stream.tokens,
					tools: stream.tools.length > 0 ? stream.tools : undefined,
					cost: stream.done!.cost,
					duration: stream.done!.duration,
				},
			]);
			setIsSending(false);
			resetStream();
		}
		if (stream.error && isSending) {
			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: `Error: ${stream.error!.message}`,
				},
			]);
			setIsSending(false);
			resetStream();
		}
	}, [stream.done, stream.error, isSending]);

	const handleSend = useCallback(async () => {
		const text = input.trim();
		if (!text || isSending) return;

		setMessages((prev) => [...prev, { role: "user", content: text }]);
		setInput("");
		resetStream();
		setIsSending(true);

		const params: Record<string, any> = { message: text };
		if (selectedAnimation) params.animationId = selectedAnimation;
		if (selectedSkill) params.skillId = selectedSkill;

		// Clear selections after capturing
		setSelectedAnimation("");
		setSelectedSkill("");

		await rpc.request.chat(params);
	}, [input, isSending, rpc, selectedAnimation, selectedSkill]);

	const handleAbort = useCallback(async () => {
		await rpc.request.abort({ taskId: "" });
	}, [rpc]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	return (
		<div style={containerStyle}>
			{/* Messages */}
			<div style={messagesContainerStyle}>
				{messages.length === 0 && !isSending && (
					<p style={emptyStyle}>
						Chat with Claude to refine your app
					</p>
				)}

				{messages.map((msg, i) => (
					<div key={i} style={messageBubbleStyle(msg.role)}>
						<div style={roleStyle}>
							{msg.role === "user" ? "You" : "Claude"}
						</div>
						<div style={contentStyle}>{msg.content}</div>
						{msg.tools && msg.tools.length > 0 && (
							<ToolList tools={msg.tools} />
						)}
						{msg.cost != null && (
							<div style={metaStyle}>
								${msg.cost.toFixed(4)} &middot;{" "}
								{Math.round((msg.duration || 0) / 1000)}s
							</div>
						)}
					</div>
				))}

				{/* Live streaming */}
				{isSending && (
					<div style={messageBubbleStyle("assistant")}>
						<div style={roleStyle}>Claude</div>
						{stream.status && (
							<div style={stageStyle}>
								{stream.status.stage || "Working..."}
								{stream.status.progress != null && (
									<div style={miniProgressBgStyle}>
										<div
											style={{
												...miniProgressFillStyle,
												width: `${stream.status.progress}%`,
											}}
										/>
									</div>
								)}
							</div>
						)}
						{stream.tools.length > 0 && (
							<ToolList tools={stream.tools} />
						)}
						{stream.tokens && (
							<div style={streamingContentStyle}>
								{stream.tokens.slice(-500)}
							</div>
						)}
						{!stream.tokens && !stream.status && (
							<div style={typingStyle}>
								<span style={dotStyle}>&#8226;</span>
								<span style={{ ...dotStyle, animationDelay: "0.2s" }}>&#8226;</span>
								<span style={{ ...dotStyle, animationDelay: "0.4s" }}>&#8226;</span>
							</div>
						)}
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>

			{/* Composer */}
			<div style={composerStyle}>
				<textarea
					ref={textareaRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask Claude to change your app..."
					style={inputStyle}
					rows={2}
					disabled={isSending}
				/>
				<div style={composerToolbarStyle}>
					<div style={pickerRowStyle}>
						<AnimationPicker
							rpc={rpc}
							selected={selectedAnimation}
							onSelect={setSelectedAnimation}
						/>
						<SkillPicker
							rpc={rpc}
							selected={selectedSkill}
							onSelect={setSelectedSkill}
						/>
					</div>
					<div style={composerActionsStyle}>
						{isSending ? (
							<button onClick={handleAbort} style={cancelBtnStyle}>
								Cancel
							</button>
						) : (
							<button
								onClick={handleSend}
								disabled={!input.trim()}
								style={{
									...sendBtnStyle,
									opacity: input.trim() ? 1 : 0.4,
								}}
							>
								Send
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function ToolList({
	tools,
}: {
	tools: Array<{
		tool: string;
		input: string;
		output?: string;
		isError?: boolean;
	}>;
}) {
	const [expanded, setExpanded] = useState<number | null>(null);

	return (
		<div style={toolListStyle}>
			{tools.map((t, i) => (
				<div key={i}>
					<button
						onClick={() =>
							setExpanded(expanded === i ? null : i)
						}
						style={{
							...toolItemStyle,
							color: t.isError ? "#ef4444" : "#888",
						}}
					>
						<span style={toolIconStyle}>
							{t.output == null
								? "\u23F3"
								: t.isError
									? "\u2717"
									: "\u2713"}
						</span>
						{t.tool}
					</button>
					{expanded === i && (
						<pre style={toolDetailStyle}>
							{t.output || t.input}
						</pre>
					)}
				</div>
			))}
		</div>
	);
}

// --- Styles ---
const containerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	height: "100%",
	overflow: "hidden",
};

const messagesContainerStyle: React.CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px 16px",
	display: "flex",
	flexDirection: "column",
	gap: 12,
};

const emptyStyle: React.CSSProperties = {
	color: "#555",
	fontSize: 14,
	textAlign: "center",
	padding: 40,
	margin: 0,
};

const messageBubbleStyle = (role: "user" | "assistant"): React.CSSProperties => ({
	background: role === "user" ? "#1a1a2e" : "#111",
	border: `1px solid ${role === "user" ? "#252547" : "#1a1a1a"}`,
	borderRadius: 8,
	padding: "10px 14px",
	display: "flex",
	flexDirection: "column",
	gap: 6,
});

const roleStyle: React.CSSProperties = {
	fontSize: 11,
	fontWeight: 600,
	color: "#666",
	textTransform: "uppercase",
	letterSpacing: "0.04em",
};

const contentStyle: React.CSSProperties = {
	fontSize: 14,
	color: "#d0d0d0",
	lineHeight: 1.5,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
};

const streamingContentStyle: React.CSSProperties = {
	fontSize: 12,
	fontFamily: "monospace",
	color: "#555",
	whiteSpace: "pre-wrap",
	wordBreak: "break-all",
	maxHeight: 120,
	overflow: "hidden",
};

const stageStyle: React.CSSProperties = {
	fontSize: 12,
	color: "#888",
	display: "flex",
	alignItems: "center",
	gap: 8,
};

const miniProgressBgStyle: React.CSSProperties = {
	flex: 1,
	height: 3,
	background: "#1a1a1a",
	borderRadius: 2,
	overflow: "hidden",
};

const miniProgressFillStyle: React.CSSProperties = {
	height: "100%",
	background: "#e94560",
	borderRadius: 2,
	transition: "width 0.5s ease-out",
};

const metaStyle: React.CSSProperties = {
	fontSize: 11,
	color: "#444",
};

const typingStyle: React.CSSProperties = {
	display: "flex",
	gap: 4,
};

const dotStyle: React.CSSProperties = {
	color: "#555",
	fontSize: 16,
	animation: "pulse 1s ease-in-out infinite",
};

const toolListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 2,
};

const toolItemStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	padding: "2px 0",
	fontSize: 12,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	gap: 6,
	textAlign: "left",
};

const toolIconStyle: React.CSSProperties = {
	fontSize: 10,
	width: 14,
	textAlign: "center",
};

const toolDetailStyle: React.CSSProperties = {
	background: "#0a0a0a",
	border: "1px solid #1a1a1a",
	borderRadius: 4,
	padding: "6px 8px",
	fontSize: 11,
	fontFamily: "monospace",
	color: "#666",
	margin: "2px 0 4px 20px",
	maxHeight: 100,
	overflow: "auto",
	whiteSpace: "pre-wrap",
	wordBreak: "break-all",
};

const composerStyle: React.CSSProperties = {
	borderTop: "1px solid #1a1a1a",
	padding: 12,
	background: "#0a0a0a",
	flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
	width: "100%",
	background: "#111",
	color: "#e0e0e0",
	border: "1px solid #222",
	borderRadius: 6,
	padding: "8px 12px",
	fontSize: 14,
	fontFamily: "system-ui, -apple-system, sans-serif",
	resize: "none",
	outline: "none",
	boxSizing: "border-box",
};

const composerToolbarStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	marginTop: 8,
};

const pickerRowStyle: React.CSSProperties = {
	display: "flex",
	gap: 6,
};

const composerActionsStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "flex-end",
	marginTop: 8,
	gap: 8,
};

const sendBtnStyle: React.CSSProperties = {
	background: "#e94560",
	color: "#fff",
	border: "none",
	borderRadius: 6,
	padding: "6px 16px",
	fontSize: 13,
	fontWeight: 600,
	cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
	background: "#222",
	color: "#ccc",
	border: "none",
	borderRadius: 6,
	padding: "6px 16px",
	fontSize: 13,
	cursor: "pointer",
};
