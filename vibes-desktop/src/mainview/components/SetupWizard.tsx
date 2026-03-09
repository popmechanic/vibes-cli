import { useState, useEffect } from "react";

interface SetupWizardProps {
	onComplete: () => void;
	rpc: any;
}

type Step = "checking" | "install" | "auth" | "ready";

export default function SetupWizard({ onComplete, rpc }: SetupWizardProps) {
	const [step, setStep] = useState<Step>("checking");
	const [claudeInfo, setClaudeInfo] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pluginFound, setPluginFound] = useState(true);

	useEffect(() => {
		(async () => {
			// Check Claude CLI
			const claude = await rpc.request.checkClaude({});
			setClaudeInfo(claude);

			if (!claude.installed) {
				setStep("install");
				return;
			}

			// Check auth
			const auth = await rpc.request.checkAuth({});

			if (!auth.authenticated) {
				setStep("auth");
				return;
			}

			// Check plugin availability
			const config = await rpc.request.getConfig({});
			if (!config.pluginPath) {
				setPluginFound(false);
			}

			setStep("ready");
			setTimeout(onComplete, 800);
		})();
	}, []);

	const stepNumber = step === "install" ? 1 : step === "auth" ? 2 : 0;
	const totalSteps = 2;

	return (
		<div style={containerStyle}>
			<div style={cardStyle}>
				{/* Step indicator */}
				{(step === "install" || step === "auth") && (
					<div style={stepIndicatorStyle}>
						{Array.from({ length: totalSteps }, (_, i) => (
							<div
								key={i}
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background:
										i + 1 <= stepNumber
											? "#e94560"
											: "#333",
									transition: "background 0.3s",
								}}
							/>
						))}
					</div>
				)}

				{step === "checking" && (
					<div style={fadeInStyle}>
						<div style={spinnerStyle} />
						<p style={labelStyle}>Checking setup...</p>
					</div>
				)}

				{step === "install" && (
					<div style={fadeInStyle}>
						<h2 style={headingStyle}>Claude CLI Not Found</h2>
						<p style={textStyle}>
							Install Claude Code to continue:
						</p>
						<code style={codeBlockStyle}>
							npm install -g @anthropic-ai/claude-code
						</code>
						<p style={{ ...textStyle, fontSize: 13, color: "#666" }}>
							Or visit{" "}
							<span style={{ color: "#e94560" }}>
								claude.ai/download
							</span>
						</p>
						<button
							onClick={async () => {
								setLoading(true);
								setError(null);
								const result =
									await rpc.request.checkClaude({});
								setClaudeInfo(result);
								if (result.installed) {
									const auth =
										await rpc.request.checkAuth({});
									if (auth.authenticated) {
										setStep("ready");
										setTimeout(onComplete, 800);
									} else {
										setStep("auth");
									}
								} else {
									setError("Claude CLI still not found");
								}
								setLoading(false);
							}}
							style={primaryBtnStyle}
							disabled={loading}
						>
							{loading ? "Checking..." : "Check Again"}
						</button>
						{error && <p style={errorStyle}>{error}</p>}
					</div>
				)}

				{step === "auth" && (
					<div style={fadeInStyle}>
						<h2 style={headingStyle}>
							Authenticate with Anthropic
						</h2>
						<p style={textStyle}>
							Sign in to your Anthropic account to enable
							Claude.
						</p>
						{claudeInfo?.version && (
							<p style={versionStyle}>
								Claude CLI v{claudeInfo.version}
							</p>
						)}
						<button
							onClick={async () => {
								setLoading(true);
								setError(null);
								const result =
									await rpc.request.triggerLogin({});
								if (result.success) {
									setStep("ready");
									setTimeout(onComplete, 800);
								} else {
									setError(
										result.error || "Login failed",
									);
								}
								setLoading(false);
							}}
							style={primaryBtnStyle}
							disabled={loading}
						>
							{loading ? "Waiting for browser..." : "Sign In"}
						</button>
						{error && <p style={errorStyle}>{error}</p>}
					</div>
				)}

				{step === "ready" && (
					<div style={fadeInStyle}>
						<div style={checkmarkStyle}>&#10003;</div>
						<h2 style={headingStyle}>Ready!</h2>
						<p style={textStyle}>
							Claude CLI v{claudeInfo?.version} — authenticated
						</p>
						{!pluginFound && (
							<p
								style={{
									...textStyle,
									color: "#eab308",
									fontSize: 13,
								}}
							>
								Vibes plugin not found — install it for
								full functionality
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// --- Styles ---
const containerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	padding: 40,
};

const cardStyle: React.CSSProperties = {
	background: "#111",
	borderRadius: 12,
	border: "1px solid #222",
	padding: "48px 40px",
	maxWidth: 440,
	width: "100%",
	textAlign: "center",
};

const stepIndicatorStyle: React.CSSProperties = {
	display: "flex",
	gap: 8,
	justifyContent: "center",
	marginBottom: 24,
};

const fadeInStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 16,
	animation: "fadeIn 0.3s ease-out",
};

const headingStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 22,
	fontWeight: 600,
	color: "#e0e0e0",
};

const textStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 15,
	color: "#999",
	lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 15,
	color: "#666",
};

const versionStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 13,
	color: "#4ade80",
	fontFamily: "monospace",
};

const codeBlockStyle: React.CSSProperties = {
	background: "#0a0a0a",
	padding: "12px 20px",
	borderRadius: 8,
	fontSize: 14,
	fontFamily: "monospace",
	color: "#e0e0e0",
	border: "1px solid #222",
};

const primaryBtnStyle: React.CSSProperties = {
	background: "#e94560",
	color: "#fff",
	border: "none",
	borderRadius: 8,
	padding: "12px 28px",
	cursor: "pointer",
	fontSize: 15,
	fontWeight: 600,
	marginTop: 8,
	transition: "opacity 0.2s",
};

const errorStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 13,
	color: "#ef4444",
};

const spinnerStyle: React.CSSProperties = {
	width: 32,
	height: 32,
	border: "3px solid #222",
	borderTopColor: "#e94560",
	borderRadius: "50%",
	animation: "spin 0.8s linear infinite",
};

const checkmarkStyle: React.CSSProperties = {
	width: 48,
	height: 48,
	borderRadius: "50%",
	background: "#16a34a22",
	color: "#4ade80",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: 24,
	fontWeight: 700,
};
