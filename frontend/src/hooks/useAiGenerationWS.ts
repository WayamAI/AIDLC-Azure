import { useRef, useEffect, useCallback } from "react";
import { useAiIde } from "@/context/AiIdeContext";

function getWsBase(): string {
  const viteWs = (import.meta as any).env?.VITE_WS_URL as string | undefined;
  if (viteWs) return viteWs;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api`;
}

export function useAiGenerationWS(workspaceId: string | null) {
  const { dispatch } = useAiIde();
  const wsRef = useRef<WebSocket | null>(null);

  // Token batching: flush every 50 ms to prevent React re-render storms
  const bufferRef = useRef<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBuffer = useCallback(() => {
    const buf = bufferRef.current;
    for (const [path, tokens] of Object.entries(buf)) {
      if (tokens) dispatch({ type: "APPEND_TOKEN", path, token: tokens });
    }
    bufferRef.current = {};
    timerRef.current = null;
  }, [dispatch]);

  const startGeneration = useCallback(
    (idea: string) => {
      if (!workspaceId) return;
      if (wsRef.current) wsRef.current.close();

      const url = `${getWsBase()}/ai-ide/ws/generate/${workspaceId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      dispatch({ type: "SET_STATUS", status: "planning", message: "Connecting…" });

      ws.onopen = () => {
        ws.send(idea);
        dispatch({ type: "SET_STATUS", status: "planning", message: "Planning your app…" });
      };

      ws.onmessage = (ev) => {
        let data: Record<string, any>;
        try {
          data = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        switch (data.type) {
          case "STATUS":
            dispatch({ type: "SET_STATUS", status: "generating", message: data.message });
            dispatch({ type: "ADD_LOG", message: data.message });
            break;

          case "FILE_CREATE":
            dispatch({ type: "START_FILE_STREAM", path: data.path });
            dispatch({ type: "ADD_LOG", message: `Creating ${data.path}…` });
            break;

          case "STREAM_TOKEN": {
            // Buffer tokens and flush every 50 ms
            const buf = bufferRef.current;
            buf[data.path] = (buf[data.path] ?? "") + data.token;
            if (!timerRef.current) {
              timerRef.current = setTimeout(flushBuffer, 50);
            }
            break;
          }

          case "FILE_UPDATE":
            // Flush any buffered tokens first
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              flushBuffer();
            }
            dispatch({ type: "UPDATE_FILE", path: data.path, content: data.content });
            dispatch({ type: "ADD_LOG", message: `Updated ${data.path}` });
            break;

          case "FILE_DONE":
            dispatch({ type: "ADD_LOG", message: `✓ ${data.path}` });
            break;

          case "GENERATION_DONE":
            if (timerRef.current) {
              clearTimeout(timerRef.current);
              flushBuffer();
            }
            dispatch({ type: "SET_STATUS", status: "done", message: "Generation complete!" });
            dispatch({ type: "ADD_LOG", message: "✓ All files generated" });
            ws.close();
            break;

          case "ERROR":
            dispatch({ type: "SET_STATUS", status: "error", message: data.message });
            dispatch({ type: "ADD_LOG", message: `Error: ${data.message}` });
            break;
        }
      };

      ws.onerror = () => {
        dispatch({ type: "SET_STATUS", status: "error", message: "WebSocket connection failed" });
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    },
    [workspaceId, dispatch, flushBuffer]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { startGeneration };
}
