// MorphStorm Configuration
// ═══════════════════════════════════════════════
// EDIT THE SIGNALING URL AFTER YOU DEPLOY TO RENDER
// ═══════════════════════════════════════════════

const MorphConfig = {

  // ── YOUR SIGNALING SERVER URL ─────────────────
  // After deploying to Render, replace this with your Render URL.
  // It will look like: 'wss://morphstorm-signaling.onrender.com'
  // For local testing only: 'ws://localhost:5000'
  SIGNALING_URL: 'wss://morphstorm.onrender.com',

  // ── ICE/TURN SERVERS (already configured!) ────
  // These free servers handle NAT traversal so devices
  // on different networks can connect to each other.
  // Open Relay gives 20GB/month free — for 3 people
  // texting, you'll never come close to that limit.
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],

  MAX_GROUP_PEERS: 5,
  MAX_DM_PEERS: 2,
  APP_NAME: 'MorphStorm',
  VERSION: '1.0.0'
};

window.MorphConfig = MorphConfig;
