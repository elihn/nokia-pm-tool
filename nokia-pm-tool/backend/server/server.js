const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const DB_FILE = path.join(__dirname, "data.json");
const KEYS_FILE = path.join(__dirname, "../config/ed25519_keys.json");

// Load Ed25519 Keys
if (!fs.existsSync(KEYS_FILE)) {
  console.error("FATAL: ed25519_keys.json not found!");
  process.exit(1);
}
const keyConfig = JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
const SERVER_PRIVATE_KEY_HEX = keyConfig.privateKeyHex || keyConfig.server_private_key_hex;
const CLIENT_PUBLIC_KEY_HEX = keyConfig.publicKeyHex || keyConfig.client_public_key_hex;

// Convert Hex Ed25519 Private Key to PKCS#8 DER for Node.js crypto
function getPrivateKeyObject(privateKeyHex) {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const der = Buffer.concat([pkcs8Prefix, Buffer.from(privateKeyHex, "hex")]);
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}
const serverPrivateKey = getPrivateKeyObject(SERVER_PRIVATE_KEY_HEX);

// Simple JSON Database persistence
let db = {
  technicians: [
    {
      id: "tech_001",
      full_name: "Amadou Traoré",
      company: "Nokia West Africa",
      email: "amadou.traore@partner.nokia.com",
      phone: "+225 07 00 00 01",
      notes: "Chef d'équipe Radio",
      created_at: new Date().toISOString()
    }
  ],
  licenses: [
    {
      id: "lic_001",
      license_key: "NOKIA-PM25-7890-ABCD",
      technician_id: "tech_001",
      device_id: null,
      status: "ACTIVE",
      duration_type: "1_YEAR",
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      last_sync: null,
      created_at: new Date().toISOString(),
      notes: "Licence initiale de test"
    }
  ],
  devices: [],
  logs: []
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (e) {
    console.warn("Could not read db file, using default in-memory state");
  }
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function logAudit(licenseId, action, details = {}) {
  const log = {
    id: "log_" + Date.now(),
    license_id: licenseId,
    action,
    details,
    created_at: new Date().toISOString()
  };
  db.logs.unshift(log);
  if (db.logs.length > 500) db.logs.pop();
  saveDb();
}

function signPayload(payload) {
  const jsonStr = JSON.stringify(payload);
  const sig = crypto.sign(null, Buffer.from(jsonStr, "utf-8"), serverPrivateKey);
  return {
    payload,
    signature: sig.toString("hex")
  };
}

// Helpers
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    });
    return res.end();
  }

  // Serve Admin UI static files
  if (pathname === "/" || pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html") {
    const adminPath = path.join(__dirname, "../admin/index.html");
    if (fs.existsSync(adminPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(adminPath));
    }
  }

  try {
    // -------------------------------------------------------------
    // CLIENT API 1: /api/activate
    // -------------------------------------------------------------
    if (pathname === "/api/activate" && method === "POST") {
      const body = await parseBody(req);
      const { license_key, installation_id, device_public_key, device_model, app_version } = body;

      if (!license_key || !installation_id || !device_public_key) {
        return sendJson(res, 400, { error: "Paramètres manquants (license_key, installation_id, device_public_key requis)" });
      }

      const cleanKey = license_key.trim().toUpperCase();
      const license = db.licenses.find(l => l.license_key === cleanKey);

      if (!license) {
        return sendJson(res, 404, { error: "Clé de licence invalide ou inexistante" });
      }

      if (license.status === "REVOKED") {
        return sendJson(res, 403, { error: "Cette licence a été révoquée définitivement." });
      }

      if (license.status === "SUSPENDED") {
        return sendJson(res, 403, { error: "Cette licence est actuellement suspendue par l'administrateur." });
      }

      if (license.expires_at && new Date(license.expires_at) < new Date()) {
        return sendJson(res, 403, { error: "Cette licence est expirée." });
      }

      // Check device binding (1 phone = 1 license)
      let device = db.devices.find(d => d.installation_id === installation_id);

      if (license.device_id) {
        // License already bound to a device
        const boundDevice = db.devices.find(d => d.id === license.device_id);
        if (boundDevice && boundDevice.installation_id !== installation_id) {
          logAudit(license.id, "ACTIVATION_REJECTED", {
            reason: "DEVICE_MISMATCH",
            bound_device: boundDevice.installation_id,
            attempted_device: installation_id
          });
          return sendJson(res, 409, {
            error: "Cette licence est déjà activée sur un autre téléphone. Veuillez contacter l'administrateur pour dissocier l'ancien appareil."
          });
        }
      }

      // Register or update device
      const clientIp = req.socket.remoteAddress || "127.0.0.1";
      if (!device) {
        device = {
          id: "dev_" + Date.now(),
          installation_id,
          device_public_key,
          device_model: device_model || "Android",
          app_version: app_version || "1.0",
          license_id: license.id,
          last_ip: clientIp,
          last_seen: new Date().toISOString(),
          created_at: new Date().toISOString()
        };
        db.devices.push(device);
      } else {
        device.license_id = license.id;
        device.device_public_key = device_public_key;
        device.device_model = device_model || device.device_model;
        device.app_version = app_version || device.app_version;
        device.last_ip = clientIp;
        device.last_seen = new Date().toISOString();
      }

      license.device_id = device.id;
      license.last_sync = new Date().toISOString();
      saveDb();

      // Issue 30-day offline token
      const now = new Date();
      const offlineValidUntil = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      let effectiveOfflineExpiration = offlineValidUntil;
      if (license.expires_at && new Date(license.expires_at) < offlineValidUntil) {
        effectiveOfflineExpiration = new Date(license.expires_at);
      }

      const tech = db.technicians.find(t => t.id === license.technician_id);

      const tokenPayload = {
        license_key: license.license_key,
        installation_id: device.installation_id,
        device_public_key: device.device_public_key,
        technician_name: tech ? tech.full_name : "Opérateur Nokia",
        technician_company: tech ? tech.company : "Nokia Field",
        status: "ACTIVE",
        duration_type: license.duration_type,
        license_expires_at: license.expires_at,
        offline_valid_until: effectiveOfflineExpiration.toISOString(),
        issued_at: now.toISOString(),
        server_timestamp: now.getTime()
      };

      const signedToken = signPayload(tokenPayload);

      logAudit(license.id, "ACTIVATED", {
        installation_id,
        device_model,
        client_ip: clientIp
      });

      return sendJson(res, 200, {
        success: true,
        message: "Licence activée avec succès",
        token: signedToken
      });
    }

    // -------------------------------------------------------------
    // CLIENT API 2: /api/sync
    // -------------------------------------------------------------
    if (pathname === "/api/sync" && method === "POST") {
      const body = await parseBody(req);
      const { license_key, installation_id } = body;

      if (!license_key || !installation_id) {
        return sendJson(res, 400, { error: "Paramètres manquants (license_key, installation_id)" });
      }

      const cleanKey = license_key.trim().toUpperCase();
      const license = db.licenses.find(l => l.license_key === cleanKey);

      if (!license) {
        return sendJson(res, 404, { error: "Licence introuvable", status: "REVOKED" });
      }

      const device = db.devices.find(d => d.installation_id === installation_id);
      if (!device || license.device_id !== device.id) {
        return sendJson(res, 403, {
          error: "Appareil non autorisé pour cette licence",
          status: "DEVICE_MISMATCH"
        });
      }

      if (license.status === "REVOKED") {
        return sendJson(res, 403, { error: "Licence révoquée définitivement", status: "REVOKED" });
      }

      if (license.status === "SUSPENDED") {
        return sendJson(res, 403, { error: "Licence suspendue", status: "SUSPENDED" });
      }

      if (license.expires_at && new Date(license.expires_at) < new Date()) {
        return sendJson(res, 403, { error: "Licence expirée", status: "EXPIRED" });
      }

      // Update sync
      const now = new Date();
      license.last_sync = now.toISOString();
      device.last_seen = now.toISOString();
      device.last_ip = req.socket.remoteAddress || device.last_ip;
      saveDb();

      // Issue renewed 30-day offline token
      const offlineValidUntil = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      let effectiveOfflineExpiration = offlineValidUntil;
      if (license.expires_at && new Date(license.expires_at) < offlineValidUntil) {
        effectiveOfflineExpiration = new Date(license.expires_at);
      }

      const tech = db.technicians.find(t => t.id === license.technician_id);

      const tokenPayload = {
        license_key: license.license_key,
        installation_id: device.installation_id,
        device_public_key: device.device_public_key,
        technician_name: tech ? tech.full_name : "Opérateur Nokia",
        technician_company: tech ? tech.company : "Nokia Field",
        status: "ACTIVE",
        duration_type: license.duration_type,
        license_expires_at: license.expires_at,
        offline_valid_until: effectiveOfflineExpiration.toISOString(),
        issued_at: now.toISOString(),
        server_timestamp: now.getTime()
      };

      const signedToken = signPayload(tokenPayload);

      logAudit(license.id, "SYNCED", { installation_id });

      return sendJson(res, 200, {
        success: true,
        message: "Licence synchronisée avec succès. Validité hors-ligne renouvelée pour 30 jours.",
        token: signedToken
      });
    }

    // -------------------------------------------------------------
    // ADMIN APIS: /api/stats, /api/licenses, /api/technicians, etc.
    // -------------------------------------------------------------
    if (pathname === "/api/stats" && method === "GET") {
      const activeLicenses = db.licenses.filter(l => l.status === "ACTIVE" && (!l.expires_at || new Date(l.expires_at) > new Date())).length;
      return sendJson(res, 200, {
        technicians: db.technicians.length,
        totalLicenses: db.licenses.length,
        activeLicenses,
        devices: db.devices.length
      });
    }

    if (pathname === "/api/technicians") {
      if (method === "GET") {
        const enriched = db.technicians.map(t => ({
          ...t,
          licenses: db.licenses.filter(l => l.technician_id === t.id)
        }));
        return sendJson(res, 200, enriched);
      }
      if (method === "POST") {
        const body = await parseBody(req);
        if (!body.full_name) return sendJson(res, 400, { error: "Nom requis" });
        const newTech = {
          id: "tech_" + Date.now(),
          full_name: body.full_name,
          company: body.company || "",
          email: body.email || "",
          phone: body.phone || "",
          notes: body.notes || "",
          created_at: new Date().toISOString()
        };
        db.technicians.push(newTech);
        saveDb();
        return sendJson(res, 201, newTech);
      }
    }

    if (pathname === "/api/licenses") {
      if (method === "GET") {
        const enriched = db.licenses.map(l => ({
          ...l,
          technician: db.technicians.find(t => t.id === l.technician_id) || null,
          device: db.devices.find(d => d.id === l.device_id) || null
        }));
        return sendJson(res, 200, enriched);
      }
      if (method === "POST") {
        const body = await parseBody(req);
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        const key = (body.custom_key && body.custom_key.trim().toUpperCase()) || `NOKIA-${seg()}-${seg()}-${seg()}`;
        const type = body.duration_type || "1_MONTH";

        let expires_at = null;
        const now = new Date();
        if (type === "1_MONTH") { now.setMonth(now.getMonth() + 1); expires_at = now.toISOString(); }
        else if (type === "3_MONTHS") { now.setMonth(now.getMonth() + 3); expires_at = now.toISOString(); }
        else if (type === "6_MONTHS") { now.setMonth(now.getMonth() + 6); expires_at = now.toISOString(); }
        else if (type === "1_YEAR") { now.setFullYear(now.getFullYear() + 1); expires_at = now.toISOString(); }
        else if (type === "PERMANENT") { expires_at = null; }

        const newLic = {
          id: "lic_" + Date.now(),
          license_key: key,
          technician_id: body.technician_id || null,
          device_id: null,
          status: "ACTIVE",
          duration_type: type,
          expires_at,
          last_sync: null,
          notes: body.notes || "",
          created_at: new Date().toISOString()
        };
        db.licenses.unshift(newLic);
        logAudit(newLic.id, "CREATED", { duration_type: type, expires_at });
        saveDb();
        return sendJson(res, 201, newLic);
      }
    }

    if (pathname.startsWith("/api/licenses/")) {
      const parts = pathname.replace("/api/licenses/", "").split("/");
      const licId = parts[0];
      const action = parts[1];

      const lic = db.licenses.find(l => l.id === licId);
      if (!lic) return sendJson(res, 404, { error: "Licence introuvable" });

      if (action === "suspend") {
        lic.status = "SUSPENDED";
        logAudit(lic.id, "SUSPENDED");
        saveDb();
        return sendJson(res, 200, { success: true, status: "SUSPENDED" });
      }
      if (action === "activate") {
        lic.status = "ACTIVE";
        logAudit(lic.id, "ACTIVATED");
        saveDb();
        return sendJson(res, 200, { success: true, status: "ACTIVE" });
      }
      if (action === "revoke") {
        lic.status = "REVOKED";
        logAudit(lic.id, "REVOKED");
        saveDb();
        return sendJson(res, 200, { success: true, status: "REVOKED" });
      }
      if (action === "unbind") {
        lic.device_id = null;
        logAudit(lic.id, "DEVICE_UNBOUND");
        saveDb();
        return sendJson(res, 200, { success: true, message: "Appareil dissocié" });
      }
      if (action === "renew") {
        const body = await parseBody(req);
        const newType = body.duration_type || lic.duration_type;
        const base = lic.expires_at && new Date(lic.expires_at) > new Date() ? new Date(lic.expires_at) : new Date();

        if (newType === "1_MONTH") base.setMonth(base.getMonth() + 1);
        else if (newType === "3_MONTHS") base.setMonth(base.getMonth() + 3);
        else if (newType === "6_MONTHS") base.setMonth(base.getMonth() + 6);
        else if (newType === "1_YEAR") base.setFullYear(base.getFullYear() + 1);

        lic.expires_at = newType === "PERMANENT" ? null : base.toISOString();
        lic.duration_type = newType;
        lic.status = "ACTIVE";
        logAudit(lic.id, "RENEWED", { duration_type: newType, expires_at: lic.expires_at });
        saveDb();
        return sendJson(res, 200, { success: true, status: "ACTIVE", expires_at: lic.expires_at });
      }
    }

    if (pathname === "/api/logs" && method === "GET") {
      const enrichedLogs = db.logs.map(log => {
        const lic = db.licenses.find(l => l.id === log.license_id);
        const tech = lic ? db.technicians.find(t => t.id === lic.technician_id) : null;
        return {
          ...log,
          license: lic ? { license_key: lic.license_key, technician: tech } : null
        };
      });
      return sendJson(res, 200, enrichedLogs);
    }

    return sendJson(res, 404, { error: "Route non trouvée" });
  } catch (err) {
    console.error("Server error:", err);
    return sendJson(res, 500, { error: err.message || "Erreur interne" });
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Nokia PM Tool License Server running on port ${PORT}`);
  console.log(`Admin UI:  http://localhost:${PORT}/admin/`);
  console.log(`API Base:  http://localhost:${PORT}/api`);
  console.log(`Client Ed25519 Public Key: ${CLIENT_PUBLIC_KEY_HEX}`);
  console.log(`====================================================`);
});
