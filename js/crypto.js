// MorphStorm Crypto Engine
// ECDH key exchange + AES-256-GCM message encryption

const MorphCrypto = (() => {
  const ALGO_ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const ALGO_AES = { name: 'AES-GCM', length: 256 };
  const IV_LENGTH = 12; // 96 bits for AES-GCM

  // Generate an ECDH key pair
  async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      ALGO_ECDH,
      true, // extractable (need to export public key)
      ['deriveKey', 'deriveBits']
    );
    return keyPair;
  }

  // Export public key to transmittable format (JWK)
  async function exportPublicKey(publicKey) {
    const jwk = await crypto.subtle.exportKey('jwk', publicKey);
    return jwk;
  }

  // Import peer's public key from JWK
  async function importPublicKey(jwk) {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      ALGO_ECDH,
      true,
      []
    );
    return key;
  }

  // Derive a shared AES-GCM key from our private key + peer's public key
  async function deriveSharedKey(privateKey, peerPublicKey) {
    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      privateKey,
      ALGO_AES,
      false, // not extractable
      ['encrypt', 'decrypt']
    );
    return sharedKey;
  }

  // Encrypt a message string with AES-GCM
  async function encrypt(sharedKey, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      encoded
    );

    // Combine IV + ciphertext into one buffer
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // Return as base64 for easy transport
    return btoa(String.fromCharCode(...combined));
  }

  // Decrypt a message
  async function decrypt(sharedKey, encryptedBase64) {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  // Full key exchange flow helper
  // Returns: { publicKeyJwk, keyPair }
  async function initKeyExchange() {
    const keyPair = await generateKeyPair();
    const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
    return { publicKeyJwk, keyPair };
  }

  // Complete key exchange with peer's public key
  // Returns: sharedKey (AES-GCM)
  async function completeKeyExchange(keyPair, peerPublicKeyJwk) {
    const peerPublicKey = await importPublicKey(peerPublicKeyJwk);
    const sharedKey = await deriveSharedKey(keyPair.privateKey, peerPublicKey);
    return sharedKey;
  }

  return {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedKey,
    encrypt,
    decrypt,
    initKeyExchange,
    completeKeyExchange
  };
})();

window.MorphCrypto = MorphCrypto;
