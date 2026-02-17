// MorphStorm Signaling Client
// Handles WebSocket connection to signaling server

const MorphSignaling = (() => {
  let ws = null;
  let myPeerId = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;
  const RECONNECT_DELAY = 3000;

  const handlers = new Map();

  function on(type, callback) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(callback);
  }

  function emit(type, data) {
    const cbs = handlers.get(type) || [];
    cbs.forEach(cb => cb(data));
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const url = MorphConfig.SIGNALING_URL;
      console.log(`[SIG] Connecting to ${url}...`);
      emit('status', { state: 'connecting' });

      try {
        ws = new WebSocket(url);
      } catch (err) {
        emit('status', { state: 'error', error: err.message });
        reject(err);
        return;
      }

      ws.onopen = () => {
        console.log('[SIG] Connected');
        reconnectAttempts = 0;
        emit('status', { state: 'connected' });
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'welcome') {
          myPeerId = msg.peerId;
          console.log(`[SIG] My peer ID: ${myPeerId}`);
          emit('ready', { peerId: myPeerId });
          resolve(myPeerId);
          return;
        }

        emit(msg.type, msg);
      };

      ws.onclose = () => {
        console.log('[SIG] Disconnected');
        emit('status', { state: 'disconnected' });
        attemptReconnect();
      };

      ws.onerror = (err) => {
        console.error('[SIG] Error:', err);
        emit('status', { state: 'error', error: 'Connection failed' });
      };

      // Timeout
      setTimeout(() => {
        if (!myPeerId) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
      emit('status', { state: 'failed', error: 'Max reconnection attempts reached' });
      return;
    }
    reconnectAttempts++;
    console.log(`[SIG] Reconnecting (${reconnectAttempts}/${MAX_RECONNECT})...`);
    reconnectTimer = setTimeout(() => connect().catch(() => {}), RECONNECT_DELAY);
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[SIG] Cannot send — not connected');
    }
  }

  function createRoom(name, roomName, roomType = 'group') {
    send({ type: 'create-room', name, roomName, roomType });
  }

  function joinRoom(name, pin) {
    send({ type: 'join-room', name, pin });
  }

  function leaveRoom() {
    send({ type: 'leave-room' });
  }

  function sendSignal(targetPeerId, signal) {
    send({ type: 'signal', targetPeerId, signal });
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    reconnectAttempts = MAX_RECONNECT; // prevent auto-reconnect
    if (ws) ws.close();
  }

  function getPeerId() {
    return myPeerId;
  }

  return {
    connect,
    disconnect,
    send,
    on,
    createRoom,
    joinRoom,
    leaveRoom,
    sendSignal,
    getPeerId
  };
})();

window.MorphSignaling = MorphSignaling;
