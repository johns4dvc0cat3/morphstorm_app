// MorphStorm Main Application
// Orchestrates signaling, RTC, encryption, rooms, and UI

const MorphApp = (() => {
  let myName = '';
  let myPeerId = '';
  let currentRoom = null; // { id, name, type, pin }
  let messages = []; // { id, from, fromId, text, time, type }
  let isConnected = false;

  // ── Initialization ──────────────────────────────────
  async function init() {
    console.log('⚡ MorphStorm v' + MorphConfig.VERSION);
    await MorphRTC.init();
    setupSignalingHandlers();
    setupRTCHandlers();
    setupUI();
    showScreen('login');
    animateBootSequence();
  }

  // ── Boot animation ──────────────────────────────────
  function animateBootSequence() {
    const lines = [
      '> MORPHSTORM v1.0.0',
      '> Initializing cipher engine...',
      '> ECDH key pair generated',
      '> AES-256-GCM ready',
      '> WebRTC mesh protocol loaded',
      '> System ready. Enter the storm.',
    ];
    const terminal = document.getElementById('boot-terminal');
    if (!terminal) return;

    terminal.innerHTML = '';
    lines.forEach((line, i) => {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'boot-line';
        el.textContent = line;
        terminal.appendChild(el);
        if (i === lines.length - 1) {
          setTimeout(() => {
            terminal.classList.add('boot-done');
          }, 600);
        }
      }, i * 400);
    });
  }

  // ── Signaling handlers ──────────────────────────────
  function setupSignalingHandlers() {
    MorphSignaling.on('status', (data) => {
      updateConnectionStatus(data.state);
    });

    MorphSignaling.on('room-created', (data) => {
      currentRoom = {
        id: data.roomId,
        name: data.roomName,
        type: data.roomType,
        pin: data.pin
      };
      showScreen('chat');
      addSystemMessage(`Room "${data.roomName}" created. PIN: ${data.pin}`);
      addSystemMessage('Share the PIN with others to connect.');
      updateRoomHeader();
    });

    MorphSignaling.on('room-joined', (data) => {
      currentRoom = {
        id: data.roomId,
        name: data.roomName,
        type: data.roomType,
        pin: null
      };
      showScreen('chat');
      addSystemMessage(`Joined "${data.roomName}"`);
      updateRoomHeader();

      // Initiate WebRTC connections to all existing peers
      if (data.peers && data.peers.length > 0) {
        addSystemMessage(`Found ${data.peers.length} peer(s). Establishing encrypted links...`);
        data.peers.forEach(peer => {
          MorphRTC.connectToPeer(peer.id, peer.name);
        });
      }
    });

    MorphSignaling.on('peer-joined', (data) => {
      addSystemMessage(`${data.peerName} joined the room`);
      // New peer will initiate connection to us, we just wait
    });

    MorphSignaling.on('peer-left', (data) => {
      addSystemMessage(`${data.peerName} left the room`);
      MorphRTC.disconnectPeer(data.peerId);
      updatePeerList();
    });

    MorphSignaling.on('signal', (data) => {
      MorphRTC.handleSignal(data.fromPeerId, data.fromPeerName, data.signal);
    });

    MorphSignaling.on('left-room', () => {
      currentRoom = null;
      MorphRTC.disconnectAll();
      messages = [];
      showScreen('lobby');
    });

    MorphSignaling.on('error', (data) => {
      showToast(data.message || 'Connection error', 'error');
    });
  }

  // ── RTC handlers ────────────────────────────────────
  function setupRTCHandlers() {
    MorphRTC.on('peer-connected', (data) => {
      addSystemMessage(`🔗 Connected to ${data.name}`);
      updatePeerList();
    });

    MorphRTC.on('peer-encrypted', (data) => {
      addSystemMessage(`🔐 Encrypted channel established with ${data.name}`);
      updatePeerList();
    });

    MorphRTC.on('peer-disconnected', (data) => {
      addSystemMessage(`❌ ${data.name} disconnected`);
      updatePeerList();
    });

    MorphRTC.on('message', (data) => {
      addChatMessage(data.fromName, data.fromPeerId, data.text, data.time);
      playMessageSound();
    });
  }

  // ── UI Setup ────────────────────────────────────────
  function setupUI() {
    // Login form
    document.getElementById('btn-connect')?.addEventListener('click', handleConnect);
    document.getElementById('input-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleConnect();
    });

    // Lobby buttons
    document.getElementById('btn-create-group')?.addEventListener('click', () => showCreateModal('group'));
    document.getElementById('btn-create-dm')?.addEventListener('click', () => showCreateModal('dm'));
    document.getElementById('btn-join-room')?.addEventListener('click', showJoinModal);
    document.getElementById('btn-disconnect')?.addEventListener('click', handleDisconnect);

    // Chat input
    document.getElementById('btn-send')?.addEventListener('click', handleSend);
    document.getElementById('input-message')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Leave room
    document.getElementById('btn-leave-room')?.addEventListener('click', handleLeaveRoom);

    // Modal closes
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', closeModals);
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModals();
      });
    });

    // Create room confirm
    document.getElementById('btn-confirm-create')?.addEventListener('click', handleCreateRoom);
    document.getElementById('btn-confirm-join')?.addEventListener('click', handleJoinRoom);

    // Copy PIN button
    document.getElementById('btn-copy-pin')?.addEventListener('click', handleCopyPin);

    // Toggle peer list on mobile
    document.getElementById('btn-toggle-peers')?.addEventListener('click', () => {
      document.getElementById('peer-sidebar')?.classList.toggle('open');
    });
  }

  // ── Connection ──────────────────────────────────────
  async function handleConnect() {
    const nameInput = document.getElementById('input-name');
    const name = nameInput?.value.trim();
    if (!name) {
      showToast('Enter a display name', 'warn');
      nameInput?.focus();
      return;
    }
    if (name.length > 20) {
      showToast('Name too long (max 20 chars)', 'warn');
      return;
    }

    myName = name;
    const btn = document.getElementById('btn-connect');
    btn.disabled = true;
    btn.textContent = 'CONNECTING...';

    try {
      myPeerId = await MorphSignaling.connect();
      isConnected = true;
      showScreen('lobby');
      showToast(`Connected as ${myName}`, 'success');
    } catch (err) {
      showToast('Failed to connect to signaling server', 'error');
      btn.disabled = false;
      btn.textContent = 'CONNECT';
    }
  }

  function handleDisconnect() {
    MorphSignaling.leaveRoom();
    MorphRTC.disconnectAll();
    MorphSignaling.disconnect();
    isConnected = false;
    currentRoom = null;
    messages = [];
    showScreen('login');
  }

  // ── Room management ─────────────────────────────────
  let pendingRoomType = 'group';

  function showCreateModal(type) {
    pendingRoomType = type;
    const modal = document.getElementById('modal-create');
    const title = modal.querySelector('.modal-title');
    const input = document.getElementById('input-room-name');
    title.textContent = type === 'dm' ? 'New DM Channel' : 'New Group Room';
    input.value = '';
    input.placeholder = type === 'dm' ? 'DM name...' : 'Room name...';
    modal.classList.add('open');
    input.focus();
  }

  function showJoinModal() {
    const modal = document.getElementById('modal-join');
    document.getElementById('input-pin').value = '';
    modal.classList.add('open');
    document.getElementById('input-pin').focus();
  }

  function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  function handleCreateRoom() {
    const nameInput = document.getElementById('input-room-name');
    const roomName = nameInput?.value.trim() || (pendingRoomType === 'dm' ? 'DM' : 'MorphStorm Room');
    MorphSignaling.createRoom(myName, roomName, pendingRoomType);
    closeModals();
  }

  function handleJoinRoom() {
    const pin = document.getElementById('input-pin')?.value.trim();
    if (!pin || pin.length !== 6) {
      showToast('Enter a 6-digit PIN', 'warn');
      return;
    }
    MorphSignaling.joinRoom(myName, pin);
    closeModals();
  }

  function handleLeaveRoom() {
    MorphSignaling.leaveRoom();
  }

  function handleCopyPin() {
    if (currentRoom?.pin) {
      navigator.clipboard.writeText(currentRoom.pin).then(() => {
        showToast('PIN copied!', 'success');
      }).catch(() => {
        showToast('Copy failed', 'error');
      });
    }
  }

  // ── Messaging ───────────────────────────────────────
  function handleSend() {
    const input = document.getElementById('input-message');
    const text = input?.value.trim();
    if (!text) return;

    const msgObj = {
      text,
      time: Date.now(),
      type: 'chat'
    };

    // Display locally
    addChatMessage(myName, myPeerId, text, Date.now(), true);

    // Send to all peers
    MorphRTC.broadcast(msgObj);

    input.value = '';
    input.focus();
  }

  // ── Chat display ────────────────────────────────────
  function addChatMessage(fromName, fromId, text, time, isSelf = false) {
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      from: fromName,
      fromId,
      text,
      time: time || Date.now(),
      type: 'chat',
      isSelf
    };
    messages.push(msg);
    renderMessage(msg);
  }

  function addSystemMessage(text) {
    const msg = {
      id: Date.now() + '-sys-' + Math.random().toString(36).slice(2, 6),
      text,
      time: Date.now(),
      type: 'system'
    };
    messages.push(msg);
    renderMessage(msg);
  }

  function renderMessage(msg) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const el = document.createElement('div');

    if (msg.type === 'system') {
      el.className = 'msg msg-system';
      el.innerHTML = `<span class="msg-sys-text">${escapeHtml(msg.text)}</span>`;
    } else {
      el.className = `msg ${msg.isSelf ? 'msg-self' : 'msg-peer'}`;
      const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = `
        <div class="msg-header">
          <span class="msg-name">${escapeHtml(msg.from)}</span>
          <span class="msg-time">${timeStr}</span>
        </div>
        <div class="msg-body">${escapeHtml(msg.text)}</div>
      `;
    }

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  // ── UI Helpers ──────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`)?.classList.add('active');
  }

  function updateConnectionStatus(state) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    const map = {
      connecting: { text: 'CONNECTING', class: 'status-warn' },
      connected: { text: 'ONLINE', class: 'status-ok' },
      disconnected: { text: 'OFFLINE', class: 'status-error' },
      error: { text: 'ERROR', class: 'status-error' },
      failed: { text: 'FAILED', class: 'status-error' }
    };
    const s = map[state] || { text: state.toUpperCase(), class: 'status-warn' };
    el.textContent = s.text;
    el.className = 'connection-status ' + s.class;
  }

  function updateRoomHeader() {
    const nameEl = document.getElementById('room-name');
    const pinEl = document.getElementById('room-pin');
    const pinContainer = document.getElementById('pin-display');
    const typeEl = document.getElementById('room-type-badge');

    if (nameEl) nameEl.textContent = currentRoom?.name || '';
    if (pinEl) pinEl.textContent = currentRoom?.pin || '';
    if (pinContainer) pinContainer.style.display = currentRoom?.pin ? 'flex' : 'none';
    if (typeEl) {
      typeEl.textContent = currentRoom?.type === 'dm' ? 'DM' : 'GROUP';
      typeEl.className = 'room-type-badge ' + (currentRoom?.type === 'dm' ? 'badge-dm' : 'badge-group');
    }
    updatePeerList();
  }

  function updatePeerList() {
    const container = document.getElementById('peer-list');
    const countEl = document.getElementById('peer-count');
    if (!container) return;

    const peers = MorphRTC.getPeerList();
    countEl.textContent = peers.length + 1; // +1 for self

    container.innerHTML = `
      <div class="peer-item peer-self">
        <span class="peer-indicator encrypted"></span>
        <span class="peer-name">${escapeHtml(myName)}</span>
        <span class="peer-badge">YOU</span>
      </div>
    `;

    peers.forEach(peer => {
      const el = document.createElement('div');
      el.className = 'peer-item';
      el.innerHTML = `
        <span class="peer-indicator ${peer.encrypted ? 'encrypted' : 'connecting'}"></span>
        <span class="peer-name">${escapeHtml(peer.name)}</span>
        <span class="peer-state">${peer.encrypted ? '🔐' : '⏳'}</span>
      `;
      container.appendChild(el);
    });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function playMessageSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 800;
      gain.gain.value = 0.05;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => MorphApp.init());
