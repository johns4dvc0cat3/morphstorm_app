// MorphStorm RTC Mesh Manager
// Manages WebRTC peer connections in a mesh topology with per-pair encryption

const MorphRTC = (() => {
  // Map of peerId -> { connection, dataChannel, sharedKey, keyPair, name, state }
  const peers = new Map();
  const handlers = new Map();
  let myKeyPair = null;
  let myPublicKeyJwk = null;

  function on(type, callback) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(callback);
  }

  function emit(type, data) {
    const cbs = handlers.get(type) || [];
    cbs.forEach(cb => cb(data));
  }

  // Initialize our ECDH key pair (call once at startup)
  async function init() {
    const result = await MorphCrypto.initKeyExchange();
    myKeyPair = result.keyPair;
    myPublicKeyJwk = result.publicKeyJwk;
    console.log('[RTC] Crypto initialized');
  }

  // Create a new peer connection (we are the initiator/offerer)
  async function connectToPeer(peerId, peerName) {
    console.log(`[RTC] Initiating connection to ${peerName} (${peerId})`);

    const config = { iceServers: MorphConfig.ICE_SERVERS };
    const pc = new RTCPeerConnection(config);
    const dc = pc.createDataChannel('morphstorm', { ordered: true });

    const peerState = {
      connection: pc,
      dataChannel: dc,
      sharedKey: null,
      name: peerName,
      state: 'connecting',
      isInitiator: true,
      pendingMessages: []
    };
    peers.set(peerId, peerState);

    setupPeerConnection(peerId, pc);
    setupDataChannel(peerId, dc);

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    MorphSignaling.sendSignal(peerId, {
      type: 'offer',
      sdp: pc.localDescription
    });
  }

  // Handle incoming signal from a peer
  async function handleSignal(fromPeerId, fromPeerName, signal) {
    if (signal.type === 'offer') {
      console.log(`[RTC] Received offer from ${fromPeerName}`);

      const config = { iceServers: MorphConfig.ICE_SERVERS };
      const pc = new RTCPeerConnection(config);

      const peerState = {
        connection: pc,
        dataChannel: null,
        sharedKey: null,
        name: fromPeerName,
        state: 'connecting',
        isInitiator: false,
        pendingMessages: []
      };
      peers.set(fromPeerId, peerState);

      setupPeerConnection(fromPeerId, pc);

      // Listen for data channel from initiator
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        peerState.dataChannel = dc;
        setupDataChannel(fromPeerId, dc);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      MorphSignaling.sendSignal(fromPeerId, {
        type: 'answer',
        sdp: pc.localDescription
      });

    } else if (signal.type === 'answer') {
      console.log(`[RTC] Received answer from ${fromPeerName}`);
      const peer = peers.get(fromPeerId);
      if (peer) {
        await peer.connection.setRemoteDescription(
          new RTCSessionDescription(signal.sdp)
        );
      }

    } else if (signal.type === 'ice-candidate') {
      const peer = peers.get(fromPeerId);
      if (peer && signal.candidate) {
        try {
          await peer.connection.addIceCandidate(
            new RTCIceCandidate(signal.candidate)
          );
        } catch (err) {
          console.warn('[RTC] ICE candidate error:', err);
        }
      }

    } else if (signal.type === 'key-exchange') {
      // Peer sent their public key
      const peer = peers.get(fromPeerId);
      if (peer && signal.publicKey) {
        try {
          peer.sharedKey = await MorphCrypto.completeKeyExchange(
            myKeyPair, signal.publicKey
          );
          peer.state = 'encrypted';
          console.log(`[RTC] 🔐 Encrypted channel with ${peer.name}`);
          emit('peer-encrypted', { peerId: fromPeerId, name: peer.name });

          // Send any pending messages
          for (const msg of peer.pendingMessages) {
            await sendToPeer(fromPeerId, msg);
          }
          peer.pendingMessages = [];
        } catch (err) {
          console.error('[RTC] Key exchange failed:', err);
        }
      }
    }
  }

  function setupPeerConnection(peerId, pc) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        MorphSignaling.sendSignal(peerId, {
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[RTC] ICE state (${peerId}): ${state}`);

      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        handlePeerDisconnect(peerId);
      }
    };
  }

  function setupDataChannel(peerId, dc) {
    dc.onopen = () => {
      console.log(`[RTC] DataChannel OPEN with ${peerId}`);
      const peer = peers.get(peerId);
      if (peer) peer.state = 'open';

      // Initiate key exchange — send our public key
      dc.send(JSON.stringify({
        _morph: 'key-exchange',
        publicKey: myPublicKeyJwk
      }));

      emit('peer-connected', { peerId, name: peer?.name });
    };

    dc.onmessage = async (event) => {
      const peer = peers.get(peerId);
      if (!peer) return;

      try {
        // Check if this is a control message (key exchange)
        const raw = event.data;
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }

        if (parsed && parsed._morph === 'key-exchange') {
          // Handle key exchange over data channel
          await handleSignal(peerId, peer.name, {
            type: 'key-exchange',
            publicKey: parsed.publicKey
          });
          return;
        }

        // Regular encrypted message
        if (!peer.sharedKey) {
          console.warn('[RTC] Message received but no shared key yet');
          return;
        }

        const decrypted = await MorphCrypto.decrypt(peer.sharedKey, raw);
        const message = JSON.parse(decrypted);

        emit('message', {
          fromPeerId: peerId,
          fromName: peer.name,
          ...message
        });

      } catch (err) {
        console.error('[RTC] Message decode error:', err);
      }
    };

    dc.onclose = () => {
      console.log(`[RTC] DataChannel CLOSED with ${peerId}`);
      handlePeerDisconnect(peerId);
    };

    dc.onerror = (err) => {
      console.error(`[RTC] DataChannel error (${peerId}):`, err);
    };
  }

  function handlePeerDisconnect(peerId) {
    const peer = peers.get(peerId);
    if (peer) {
      try { peer.connection.close(); } catch {}
      peers.delete(peerId);
      emit('peer-disconnected', { peerId, name: peer.name });
    }
  }

  // Send encrypted message to a specific peer
  async function sendToPeer(peerId, messageObj) {
    const peer = peers.get(peerId);
    if (!peer) return false;

    if (!peer.sharedKey) {
      // Queue message until encryption is ready
      peer.pendingMessages.push(messageObj);
      return true;
    }

    if (!peer.dataChannel || peer.dataChannel.readyState !== 'open') {
      console.warn(`[RTC] Channel not open for ${peerId}`);
      return false;
    }

    try {
      const plaintext = JSON.stringify(messageObj);
      const encrypted = await MorphCrypto.encrypt(peer.sharedKey, plaintext);
      peer.dataChannel.send(encrypted);
      return true;
    } catch (err) {
      console.error(`[RTC] Send error to ${peerId}:`, err);
      return false;
    }
  }

  // Broadcast message to all connected peers
  async function broadcast(messageObj) {
    const results = [];
    for (const [peerId] of peers) {
      results.push(await sendToPeer(peerId, messageObj));
    }
    return results;
  }

  // Disconnect from a specific peer
  function disconnectPeer(peerId) {
    handlePeerDisconnect(peerId);
  }

  // Disconnect from all peers
  function disconnectAll() {
    for (const [peerId] of peers) {
      handlePeerDisconnect(peerId);
    }
    peers.clear();
  }

  function getPeerList() {
    return Array.from(peers.entries()).map(([id, p]) => ({
      id,
      name: p.name,
      state: p.state,
      encrypted: !!p.sharedKey
    }));
  }

  function getPeerCount() {
    return peers.size;
  }

  function isPeerConnected(peerId) {
    const peer = peers.get(peerId);
    return peer && peer.dataChannel && peer.dataChannel.readyState === 'open';
  }

  return {
    init,
    connectToPeer,
    handleSignal,
    sendToPeer,
    broadcast,
    disconnectPeer,
    disconnectAll,
    getPeerList,
    getPeerCount,
    isPeerConnected,
    on
  };
})();

window.MorphRTC = MorphRTC;
