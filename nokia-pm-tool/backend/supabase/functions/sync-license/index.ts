// Supabase Edge Function: sync-license
// Synchronisation en ligne automatique ou manuelle : vérifie le statut serveur et renouvelle la fenêtre de 30 jours

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex, signEd25519 } from "../_shared/ed25519.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const serverPrivateKeyHex = Deno.env.get("ED25519_PRIVATE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey || !serverPrivateKeyHex) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur incomplète" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { license_key, installation_id } = body;

    if (!license_key || !installation_id) {
      return new Response(
        JSON.stringify({ error: "license_key et installation_id sont requis pour la synchronisation" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanKey = String(license_key).trim().toUpperCase();

    // 1. Récupération de la licence et du technicien
    const { data: license, error: licErr } = await supabase
      .from("licenses")
      .select(`
        id,
        license_key,
        technician_id,
        status,
        license_type,
        start_date,
        expiration_date,
        technicians (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq("license_key", cleanKey)
      .single();

    if (licErr || !license) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "NOT_FOUND",
          error: "Licence introuvable sur le serveur."
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Vérification de l'association de l'appareil
    const { data: device, error: devErr } = await supabase
      .from("devices")
      .select("id, installation_id, public_key, status")
      .eq("license_id", license.id)
      .eq("installation_id", installation_id)
      .single();

    if (devErr || !device) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "UNBOUND",
          error: "Cet appareil n'est plus associé à cette licence."
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (device.status !== "ACTIVE") {
      return new Response(
        JSON.stringify({
          success: false,
          status: "DEVICE_REVOKED",
          error: "Cet appareil a été révoqué par l'administrateur."
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 3. Contrôle du statut de la licence
    const now = new Date();

    if (license.status === "REVOKED") {
      await supabase.from("license_logs").insert({
        license_id: license.id,
        device_id: device.id,
        action: "SYNC_BLOCKED_REVOKED",
        details: { installation_id }
      });

      return new Response(
        JSON.stringify({
          success: false,
          status: "REVOKED",
          error: "Cette licence a été définitivement révoquée par l'administrateur."
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (license.status === "SUSPENDED") {
      return new Response(
        JSON.stringify({
          success: false,
          status: "SUSPENDED",
          error: "Cette licence est actuellement suspendue par l'administrateur."
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Vérifier l'expiration calendaire
    if (license.expiration_date && new Date(license.expiration_date) < now) {
      await supabase.from("licenses").update({ status: "EXPIRED" }).eq("id", license.id);
      return new Response(
        JSON.stringify({
          success: false,
          status: "EXPIRED",
          error: "La licence a expiré le " + new Date(license.expiration_date).toLocaleDateString()
        }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 4. Tout est en ordre : Mise à jour de last_sync
    await supabase
      .from("devices")
      .update({ last_sync: now.toISOString() })
      .eq("id", device.id);

    // 5. Calcul de la nouvelle période hors ligne de 30 jours
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    let offlineValidUntil = thirtyDaysLater;
    if (license.expiration_date) {
      const expDate = new Date(license.expiration_date);
      if (expDate < thirtyDaysLater) {
        offlineValidUntil = expDate;
      }
    }

    const devicePubKeyHash = await sha256Hex(device.public_key);
    const uniqueTokenId = crypto.randomUUID();

    const tokenPayload = {
      license_id: license.id,
      license_key: license.license_key,
      license_type: license.license_type,
      technician_id: license.technician_id,
      technician_name: (license.technicians as any)?.full_name || "Technicien",
      installation_id: installation_id,
      device_public_key_hash: devicePubKeyHash,
      issued_at: now.toISOString(),
      expiration_date: license.expiration_date,
      offline_valid_until: offlineValidUntil.toISOString(),
      license_status: "ACTIVE",
      unique_token_id: uniqueTokenId
    };

    const canonicalString = JSON.stringify(tokenPayload, Object.keys(tokenPayload).sort());
    const signatureHex = await signEd25519(canonicalString, serverPrivateKeyHex);

    // 6. Journalisation
    await supabase.from("license_logs").insert({
      license_id: license.id,
      device_id: device.id,
      action: "SYNC",
      details: {
        installation_id,
        synced_at: now.toISOString(),
        offline_valid_until: offlineValidUntil.toISOString(),
        token_id: uniqueTokenId
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Synchronisation réussie. Mode hors ligne renouvelé pour 30 jours.",
        token: tokenPayload,
        signature: signatureHex,
        license: {
          id: license.id,
          key: license.license_key,
          type: license.license_type,
          status: license.status,
          expiration_date: license.expiration_date
        },
        technician: license.technicians
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err: any) {
    console.error("Erreur sync-license:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erreur interne lors de la synchronisation" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
