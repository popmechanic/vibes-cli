import { useState } from "react";
import { useRPC } from "./hooks/useRPC.ts";
import SetupWizard from "./components/SetupWizard.tsx";
import GeneratePhase from "./components/GeneratePhase.tsx";
import EditPhase from "./components/EditPhase.tsx";

type Phase = "setup" | "generate" | "edit";

function App() {
	const { stream, resetStream, appUpdated, rpc } = useRPC();
	const [phase, setPhase] = useState<Phase>("setup");

	if (phase === "setup") {
		return (
			<SetupWizard
				rpc={rpc}
				onComplete={() => setPhase("generate")}
			/>
		);
	}

	if (phase === "generate") {
		return (
			<GeneratePhase
				rpc={rpc}
				stream={stream}
				resetStream={resetStream}
				onGenerated={() => setPhase("edit")}
			/>
		);
	}

	return (
		<EditPhase
			rpc={rpc}
			stream={stream}
			resetStream={resetStream}
			appUpdated={appUpdated}
			onNewApp={() => setPhase("generate")}
		/>
	);
}

export default App;
