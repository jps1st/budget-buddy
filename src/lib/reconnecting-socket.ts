export type ReconnectingSocketHandlers = {
  onOpen?: () => void;
  onMessage: (data: string) => void;
};

export type ReconnectingSocket = { close: () => void };

const MAX_RETRY_MS = 30_000;
const BASE_RETRY_MS = 500;

// Wraps a WebSocket with auto-reconnect + capped exponential backoff, since unlike
// EventSource, the native WebSocket API does not reconnect on drop by itself.
export function openReconnectingSocket(path: string, handlers: ReconnectingSocketHandlers): ReconnectingSocket {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}${path}`;

  function connect() {
    if (closed) return;
    const s = new WebSocket(url);
    socket = s;

    s.onopen = () => {
      attempt = 0;
      handlers.onOpen?.();
    };
    s.onmessage = (event) => {
      handlers.onMessage(event.data as string);
    };
    s.onclose = () => {
      if (closed) return;
      const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt) + Math.random() * 500;
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };
    s.onerror = () => {
      s.close();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    },
  };
}
