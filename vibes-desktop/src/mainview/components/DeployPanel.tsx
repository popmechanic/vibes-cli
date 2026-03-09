import { useState, useEffect, useCallback } from "react";

interface DeployPanelProps {
	rpc: any;
	appName?: string;
	onClose: () => void;
}

type DeployStage = "idle" | "checking-auth" | "assembling" | "deploying" | "done" | "error";

export default function DeployPanel({ rpc, appName, onClose }: DeployPanelProps) {
	const [stage, setStage] = useState<DeployStage>("idle");
	const [error, setError] = useState<string | null>(null);
	const [url, setUrl] = useState<string | null>(null);

	const handleDeploy = useCallback(async () => {
		if (!appName) return;

		setStage("checking-auth");
		setError(null);

		try {
			// Check Pocket ID auth first
			const pocketId = await rpc.request.checkPocketId({});
			if (!pocketId.authenticated) {
				setStage("checking-auth");
				const loginResult = await rpc.request.triggerPocketIdLogin({});
				if (!loginResult.success) {
					setError(loginResult.error || "Pocket ID login failed");
					setStage("error");
					return;
				}
			}

			setStage("deploying");
			const result = await rpc.request.deploy({ name: appName });

			if (result.taskId) {
				// Deploy started — done message will come via stream
				// For now treat the request returning as success
				setStage("done");
				setUrl(`https://${appName}.vibes.diy`);
			}
		} catch (err: any) {
			setError(err.message || "Deploy failed");
			setStage("error");
		}
	}, [rpc, appName]);

	return (
		<div style={overlayStyle}>
			<div style={panelStyle}>
				<div style={headerStyle}>
					<h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#e0e0e0" }}>
						Deploy
					</h3>
					<button onClick={onClose} style={closeBtnStyle}>
						&#10005;
					</button>
				</div>

				{stage === "idle" && (
					<div style={bodyStyle}>
						<p style={textStyle}>
							Deploy <strong>{appName}</strong> to Cloudflare Workers via Vibes.
						</p>
						<button
							onClick={handleDeploy}
							style={deployBtnStyle}
							disabled={!appName}
						>
							Deploy Now
						</button>
					</div>
				)}

				{stage === "checking-auth" && (
					<div style={bodyStyle}>
						<div style={spinnerStyle} />
						<p style={textStyle}>Checking Pocket ID authentication...</p>
					</div>
				)}

				{stage === "deploying" && (
					<div style={bodyStyle}>
						<div style={spinnerStyle} />
						<p style={textStyle}>Deploying to Cloudflare...</p>
					</div>
				)}

				{stage === "done" && url && (
					<div style={bodyStyle}>
						<div style={successIconStyle}>&#10003;</div>
						<p style={textStyle}>Deployed successfully!</p>
						<p style={urlStyle}>{url}</p>
						<button onClick={onClose} style={doneBtnStyle}>
							Done
						</button>
					</div>
				)}

				{stage === "error" && (
					<div style={bodyStyle}>
						<p style={errorStyle}>{error}</p>
						<div style={{ display: "flex", gap: 8 }}>
							<button onClick={handleDeploy} style={retryBtnStyle}>
								Retry
							</button>
							<button onClick={onClose} style={cancelBtnStyle}>
								Cancel
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

const overlayStyle: React.CSSProperties = {
	position: "absolute",
	inset: 0,
	background: "rgba(0,0,0,0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 100,
};

const panelStyle: React.CSSProperties = {
	background: "#111",
	border: "1px solid #222",
	borderRadius: 12,
	width: 400,
	padding: 24,
};

const headerStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 20,
};

const closeBtnStyle: React.CSSProperties = {
	background: "none",
	border: "none",
	color: "#666",
	fontSize: 16,
	cursor: "pointer",
	padding: 4,
};

const bodyStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 16,
};

const textStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 14,
	color: "#999",
	textAlign: "center",
};

const urlStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 14,
	color: "#4ade80",
	fontFamily: "monospace",
};

const deployBtnStyle: React.CSSProperties = {
	background: "#e94560",
	color: "#fff",
	border: "none",
	borderRadius: 8,
	padding: "10px 24px",
	fontSize: 14,
	fontWeight: 600,
	cursor: "pointer",
};

const doneBtnStyle: React.CSSProperties = {
	background: "#222",
	color: "#ccc",
	border: "none",
	borderRadius: 6,
	padding: "8px 20px",
	fontSize: 13,
	cursor: "pointer",
};

const retryBtnStyle: React.CSSProperties = {
	background: "#e94560",
	color: "#fff",
	border: "none",
	borderRadius: 6,
	padding: "8px 16px",
	fontSize: 13,
	cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
	background: "#222",
	color: "#ccc",
	border: "none",
	borderRadius: 6,
	padding: "8px 16px",
	fontSize: 13,
	cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
	margin: 0,
	fontSize: 13,
	color: "#ef4444",
	background: "#1a0505",
	padding: "8px 12px",
	borderRadius: 6,
	border: "1px solid #3f1515",
	textAlign: "center",
};

const spinnerStyle: React.CSSProperties = {
	width: 28,
	height: 28,
	border: "3px solid #222",
	borderTopColor: "#e94560",
	borderRadius: "50%",
	animation: "spin 0.8s linear infinite",
};

const successIconStyle: React.CSSProperties = {
	width: 40,
	height: 40,
	borderRadius: "50%",
	background: "#16a34a22",
	color: "#4ade80",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: 20,
	fontWeight: 700,
};
