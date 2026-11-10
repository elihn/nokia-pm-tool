/**
 * Module partagé de signature Ed25519 pour Supabase Edge Functions (Deno / Node.js).
 */

// Convertit une chaîne hexadécimale en Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim().replace(/^0x/i, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Hex string invalid length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Convertit un Uint8Array en chaîne hexadécimale
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Calcule le hash SHA-256 en hexadécimal
export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(hashBuffer));
}

// Signe un message avec la clé privée Ed25519 brute (32 octets seed ou 64 octets pkcs8)
export async function signEd25519(message: string, privateKeyHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const rawSeed = hexToBytes(privateKeyHex);

  // Construction d'un conteneur PKCS#8 DER valide pour l'import de clé Ed25519 (RFC 8410)
  // Préfixe PKCS#8 Ed25519 standard : 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 [32 octets de clé]
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20
  ]);
  const pkcs8Key = new Uint8Array(pkcs8Prefix.length + 32);
  pkcs8Key.set(pkcs8Prefix, 0);
  pkcs8Key.set(rawSeed.slice(0, 32), pkcs8Prefix.length);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Key,
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    cryptoKey,
    data
  );

  return bytesToHex(new Uint8Array(signature));
}
