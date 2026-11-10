// Supabase Edge Function: activate-license
// Active une licence sur un appareil unique et émet une autorisation signée Ed25519 (valable 30j hors-ligne)

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

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur incomplète (SUPABASE_URL ou SERVICE_ROLE_KEY manquants)" }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (!serverPrivateKeyHex) {
      return new Response(
        JSON.stringify({ error: "Clé de signature Ed25519 non configurée sur le serveur" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { license_key, installation_id, public_key, device_name } = body;

    // 1. Validation des champs obligatoires
    if (!license_key || !installation_id || !public_key) {
      return new Response(
        JSON.stringify({ error: "Champs requis manquants : license_key, installation_id, public_key" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanKey = String(license_key).trim().toUpperCase();

    // 2. Recherche de la licence dans la base de données
    const { data: license, error: licenseErr } = await supabase
      .from("licenses")
      .select(`
        id,
        license_key,
        technician_id,
        status,
        license_type,
        start_date,
        expiration_date,
        max_devices,
        technicians (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq("license_key", cleanKey)
      .single();

    if (licenseErr || !license) {
      // Journaliser la tentative échouée
      await supabase.from("license_logs").insert({
        action: "FAILED_ATTEMPT",
        details: { reason: "Code d'activation inconnu", key: cleanKey, installation_id }
      });

      return new Response(
        JSON.stringify({ error: "Code d'activation invalide ou introuvable." }),
        { status: 404, headers: corsHeaders }
      );
    }

    // 3. Vérification du statut de la licence
    if (license.status === "REVOKED") {
      return new Response(
        JSON.stringify({ error: "Cette licence a été révoquée par l'administrateur." }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (license.status === "SUSPENDED") {
      return new Response(
        JSON.stringify({ error: "Cette licence est temporairement suspendue. Veuillez contacter l'administrateur." }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 4. Vérification de la date d'expiration
    const now = new Date();
    if (license.expiration_date && new Date(license.expiration_date) < now) {
      await supabase.from("licenses").update({ status: "EXPIRED" }).eq("id", license.id);
      return new Response(
        JSON.stringify({ error: "Cette licence a expiré le " + new Date(license.expiration_date).toLocaleDateString() }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 5. Règle d'or : une licence autorise un seul téléphone à la fois
    const { data: existingDevices, error: devErr } = await supabase
      .from("devices")
      .select("id, installation_id, status")
      .eq("license_id", license.id)
      .eq("status", "ACTIVE");

    if (devErr) {
      throw devErr;
    }

    let deviceRecordId: string | null = null;
    const activeDevice = existingDevices && existingDevices.length > 0 ? existingDevices[0] : null;

    if (activeDevice) {
      if (activeDevice.installation_id !== installation_id) {
        // Tentative d'utilisation sur un DEUXIÈME téléphone
        await supabase.from("license_logs").insert({
          license_id: license.id,
          action: "REJECTED_SECOND_DEVICE",
          details: {
            reason: "Tentative d'activation sur un appareil différent",
            active_installation_id: activeDevice.installation_id,
            attempted_installation_id: installation_id
          }
        });

        return new Response(
          JSON.stringify({
            error: "Cette licence est déjà activée sur un autre téléphone. Un seul appareil est autorisé par licence. Veuillez contacter votre administrateur pour libérer la licence."
          }),
          { status: 409, headers: corsHeaders }
        );
      } else {
        // Réactivation sur le MÊME téléphone (mise à jour)
        deviceRecordId = activeDevice.id;
        await supabase
          .from("devices")
          .update({
            last_sync: now.toISOString(),
            public_key: public_key,
            device_name: device_name || "Android Device"
          })
          .eq("id", activeDevice.id);
      }
    } else {
      // Premier enregistrement de l'appareil pour cette licence
      const { data: newDev, error: createDevErr } = await supabase
        .from("devices")
        .insert({
          license_id: license.id,
          installation_id: installation_id,
          public_key: public_key,
          device_name: device_name || "Android Device",
          activation_date: now.toISOString(),
          last_sync: now.toISOString(),
          status: "ACTIVE"
        })
        .select("id")
        .single();

      if (createDevErr || !newDev) {
        throw createDevErr || new Error("Échec d'enregistrement de l'appareil");
      }
      deviceRecordId = newDev.id;
    }

    // 6. Calcul de la tolérance hors-ligne de 30 jours
    // Valable 30 jours consécutifs à compter d'aujourd'hui, sans dépasser l'expiration de la licence
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    let offlineValidUntil = thirtyDaysLater;
    if (license.expiration_date) {
      const expDate = new Date(license.expiration_date);
      if (expDate < thirtyDaysLater) {
        offlineValidUntil = expDate;
      }
    }

    const devicePubKeyHash = await sha256Hex(public_key);
    const uniqueTokenId = crypto.randomUUID();

    // 7. Construction du jeton d'autorisation structuré
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

    // Chaîne canonique ordonnée pour signature Ed25519
    const canonicalString = JSON.stringify(tokenPayload, Object.keys(tokenPayload).sort());

    // 8. Signature cryptographique avec la clé privée Ed25519 du serveur
    const signatureHex = await signEd25519(canonicalString, serverPrivateKeyHex);

    // 9. Journalisation de l'activation réussie
    await supabase.from("license_logs").insert({
      license_id: license.id,
      device_id: deviceRecordId,
      action: "ACTIVATION",
      details: {
        installation_id,
        device_name,
        offline_valid_until: offlineValidUntil.toISOString(),
        token_id: uniqueTokenId
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Licence activée avec succès.",
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
    console.error("Erreur activate-license:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erreur interne du serveur de licence" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
