import { useEffect, useCallback, useState } from "react";
import { callbacks, electrobun } from "../rpc.ts";
import type { VibesDesktopRPC } from "../../shared/rpc-types.ts";

type StatusMsg = VibesDesktopRPC["webview"]["messages"]["status"];
type DoneMsg = VibesDesktopRPC["webview"]["messages"]["done"];
type ErrorMsg = VibesDesktopRPC["webview"]["messages"]["error"];

export interface StreamState {
	tokens: string;
	tools: Array<{
		tool: string;
		input: string;
		output?: string;
		isError?: boolean;
	}>;
	status: StatusMsg | null;
	done: DoneMsg | null;
	error: ErrorMsg | null;
	isStreaming: boolean;
}

export function useRPC() {
	const [stream, setStream] = useState<StreamState>({
		tokens: "",
		tools: [],
		status: null,
		done: null,
		error: null,
		isStreaming: false,
	});

	const [appUpdated, setAppUpdated] = useState(0);

	useEffect(() => {
		callbacks.onToken = ({ text }) => {
			setStream((prev) => ({
				...prev,
				tokens: prev.tokens + text,
				isStreaming: true,
			}));
		};

		callbacks.onToolUse = ({ tool, input }) => {
			setStream((prev) => ({
				...prev,
				tools: [...prev.tools, { tool, input }],
			}));
		};

		callbacks.onToolResult = ({ tool, output, isError }) => {
			setStream((prev) => {
				const tools = [...prev.tools];
				const lastIdx = tools.findLastIndex(
					(t) => t.tool === tool && !t.output,
				);
				if (lastIdx >= 0) {
					tools[lastIdx] = { ...tools[lastIdx], output, isError };
				}
				return { ...prev, tools };
			});
		};

		callbacks.onStatus = (status) => {
			setStream((prev) => ({ ...prev, status }));
		};

		callbacks.onDone = (done) => {
			setStream((prev) => ({
				...prev,
				done,
				isStreaming: false,
			}));
		};

		callbacks.onError = (error) => {
			setStream((prev) => ({
				...prev,
				error,
				isStreaming: false,
			}));
		};

		callbacks.onAppUpdated = () => {
			setAppUpdated((n) => n + 1);
		};

		return () => {
			callbacks.onToken = null;
			callbacks.onToolUse = null;
			callbacks.onToolResult = null;
			callbacks.onStatus = null;
			callbacks.onDone = null;
			callbacks.onError = null;
			callbacks.onAppUpdated = null;
		};
	}, []);

	const resetStream = useCallback(() => {
		setStream({
			tokens: "",
			tools: [],
			status: null,
			done: null,
			error: null,
			isStreaming: false,
		});
	}, []);

	const rpc = electrobun.rpc;

	return { stream, resetStream, appUpdated, rpc };
}
