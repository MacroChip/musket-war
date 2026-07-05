import type { ClientMsg, ServerMsg } from '../../shared/src/protocol';

let ws: WebSocket | null = null;

export function connect(
  name: string,
  onMsg: (msg: ServerMsg) => void,
  onOpen: () => void,
  onClose: () => void,
): void {
  const url = import.meta.env.DEV
    ? `ws://${location.hostname}:8080/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    send({ type: 'hello', name });
    onOpen();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      if (msg && typeof msg.type === 'string') onMsg(msg);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = onClose;
}

export function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
