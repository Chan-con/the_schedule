const { webcrypto } = require('crypto');

const base64urlEncode = (buffer) => {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, 'binary')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

(async () => {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  const publicKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyPkcs8 = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const vapidPublicKey = base64urlEncode(publicKeyRaw);
  const vapidPrivateKeyPkcs8 = base64urlEncode(privateKeyPkcs8);

  console.log('VITE_VAPID_PUBLIC_KEY=' + vapidPublicKey);
  console.log('VAPID_PUBLIC_KEY=' + vapidPublicKey);
  console.log('VAPID_PRIVATE_KEY_PKCS8=' + vapidPrivateKeyPkcs8);
})();
