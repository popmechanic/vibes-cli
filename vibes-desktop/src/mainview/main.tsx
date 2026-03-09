import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./rpc.ts"; // Initialize Electroview RPC before React
import App from "./App";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
