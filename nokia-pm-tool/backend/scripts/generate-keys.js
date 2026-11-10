/**
 * Script de génération de paire de clés Ed25519 pour le système de licence NOKIA PM TOOL.
 * Utilise l'API Web Crypto native de Node.js (v16+).
 * 
 * Sorties :
 *  - Clé privée Ed25519 (format Base64 PKCS#8 ou Hex raw 32 octets) -> À stocker comme SECRET dans Supabase Edge Functions (ED25519_PRIVATE_KEY)
 *  - Clé publique Ed25519 (format Hex raw 32 octets / Base64) -> À intégrer dans l'application Android client (Ed25519Verifier.kt)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  // La clé publique brute Ed25519 correspond aux 32 derniers octets du DER SPKI (préfixe ASN.1 de 12 octets)
  const rawPublicKey = pubKeyDer.slice(pubKeyDer.length - 32);

  const privKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  // La clé privée brute correspond aux 32 octets de graine (seed) à l'offset 16
  const rawPrivateKey = privKeyDer.slice(16, 16 + 32);

  const result = {
    generatedAt: new Date().toISOString(),
    publicKeyHex: rawPublicKey.toString('hex'),
    publicKeyBase64: rawPublicKey.toString('base64'),
    privateKeyHex: rawPrivateKey.toString('hex'),
    privateKeyBase64: rawPrivateKey.toString('base64'),
    instructions: {
      serverSecret: "Ajoutez ED25519_PRIVATE_KEY dans les secrets Supabase Edge Functions",
      clientConfig: "Intégrez publicKeyHex dans LicenseManager.kt côté Android"
    }
  };

  const outDir = path.join(__dirname, '..', 'config');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'ed25519_keys.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), { encoding: 'utf8' });

  console.log("=== PAIRE DE CLÉS ED25519 GÉNÉRÉE ===");
  console.log("Clé publique (Client Android - Hex 64 car.) :", result.publicKeyHex);
  console.log("Clé privée   (Serveur Supabase  - Hex 64 car.) :", result.privateKeyHex);
  console.log("Fichier sauvegardé dans :", outPath);
}

generateEd25519KeyPair();
