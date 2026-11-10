import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Liste stricte des origines autorisées pour le tableau de bord administrateur
const ALLOWED_ORIGINS = [
  "https://ais-dev-c75bpslqlkz7tksztte5qp-116548704598.europe-west2.run.app",
  "https://ais-pre-c75bpslqlkz7tksztte5qp-116548704598.europe-west2.run.app",
];

// Configuration stricte des en-têtes CORS : n'autorise que les deux origines spécifiées
function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("origin");

  // 1. Si Origin correspond à l'une des deux origines autorisées, retourner les en-têtes CORS complets
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
      "Access-Control-Max-Age": "86400",
    };
  }

  // 2. Si Origin est absent (requête directe non-CORS, appel serveur ou script), ne pas ajouter artificiellement Access-Control-Allow-Origin
  if (!origin) {
    return {};
  }

  // 3. Si Origin est inconnu / non autorisé : renvoie null pour refuser la requête avec HTTP 403
  return null;
}

function generateLicenseKey(prefix = "NOKIA"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix}-${segment()}-${segment()}-${segment()}`;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // Pour toute origine non autorisée, refuser immédiatement la requête (HTTP 403)
  if (!corsHeaders) {
    return new Response(JSON.stringify({ error: "Origine non autorisée (CORS Forbidden)" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Traiter immédiatement les requêtes OPTIONS (preflight CORS) avant tout traitement d'authentification
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);

    // Rechercher le segment correspondant à la fonction admin-api
    const functionIndex = segments.lastIndexOf("admin-api");

    // Vérifier que l'URL correspond bien à cette Edge Function
    if (functionIndex === -1) {
      return new Response(
        JSON.stringify({ error: "Chemin admin-api introuvable" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Récupérer uniquement le chemin situé après admin-api
    const path = segments.slice(functionIndex + 1).join("/");
    const method = req.method;

    // -------------------------------------------------------------
    // VÉRIFICATION D'AUTHENTIFICATION SUPABASE AUTH & RÔLE ADMIN
    // -------------------------------------------------------------
    const authHeader = req.headers.get("Authorization") || "";
    const jwtToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!jwtToken) {
      return new Response(JSON.stringify({ error: "Authentification requise : header Authorization manquant" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Validation cryptographique du JWT via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.getUser(jwtToken);
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Jeton d'authentification invalide ou expiré" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const authenticatedUser = authData.user;

    // Vérification des droits administrateur dans public.admin_users par user_id
    const { data: adminRecord, error: adminCheckError } = await supabase
      .from("admin_users")
      .select("id, user_id, email, role")
      .eq("user_id", authenticatedUser.id)
      .maybeSingle();

    if (adminCheckError || !adminRecord) {
      return new Response(JSON.stringify({ error: "Accès refusé : utilisateur non administrateur" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Autoriser uniquement les rôles admin et super_admin
    const allowedRoles = ["admin", "super_admin"];
    if (!allowedRoles.includes(adminRecord.role)) {
      return new Response(JSON.stringify({ error: "Accès refusé : rôle non autorisé" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Métadonnées de l'administrateur pour la traçabilité dans l'audit
    const adminActor = {
      admin_user_id: authenticatedUser.id,
      admin_email: authenticatedUser.email || adminRecord.email
    };

    // 1. Dashboard summary stats
    if (method === "GET" && (path === "stats" || path === "")) {
      const [{ count: techCount }, { count: licCount }, { count: activeCount }, { count: devCount }] = await Promise.all([
        supabase.from("technicians").select("*", { count: "exact", head: true }),
        supabase.from("licenses").select("*", { count: "exact", head: true }),
        supabase.from("licenses").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
        supabase.from("devices").select("*", { count: "exact", head: true })
      ]);

      return new Response(JSON.stringify({
        technicians: techCount || 0,
        totalLicenses: licCount || 0,
        activeLicenses: activeCount || 0,
        devices: devCount || 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Technicians list & create
    if (path === "technicians") {
      if (method === "GET") {
        const { data, error } = await supabase
          .from("technicians")
          .select("*, licenses(*)")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (method === "POST") {
        const body = await req.json();
        const { full_name, email, phone, company, notes } = body;
        if (!full_name) {
          return new Response(JSON.stringify({ error: "Nom complet requis" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const { data, error } = await supabase
          .from("technicians")
          .insert([{ full_name, email, phone, company, notes }])
          .select()
          .single();
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 3. Licenses list & create
    if (path === "licenses") {
      if (method === "GET") {
        const { data, error } = await supabase
          .from("licenses")
          .select("*, technician:technicians(*), device:devices(*)")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (method === "POST") {
        const body = await req.json();
        const { technician_id, duration_type, notes, custom_key } = body;

        const license_key = (custom_key && custom_key.trim()) || generateLicenseKey();
        const type = duration_type || "1_MONTH";

        // Calculate expiration if not permanent
        let expires_at: string | null = null;
        const now = new Date();
        if (type === "1_MONTH") {
          now.setMonth(now.getMonth() + 1);
          expires_at = now.toISOString();
        } else if (type === "3_MONTHS") {
          now.setMonth(now.getMonth() + 3);
          expires_at = now.toISOString();
        } else if (type === "6_MONTHS") {
          now.setMonth(now.getMonth() + 6);
          expires_at = now.toISOString();
        } else if (type === "1_YEAR") {
          now.setFullYear(now.getFullYear() + 1);
          expires_at = now.toISOString();
        } else if (type === "PERMANENT") {
          expires_at = null;
        }

        const { data, error } = await supabase
          .from("licenses")
          .insert([{
            technician_id: technician_id || null,
            license_key,
            duration_type: type,
            status: "ACTIVE",
            expires_at,
            notes: notes || null
          }])
          .select("*, technician:technicians(*)")
          .single();

        if (error) throw error;

        // Log creation with admin attribution
        await supabase.from("license_logs").insert([{
          license_id: data.id,
          action: "CREATED",
          details: { duration_type: type, expires_at, created_by: adminActor }
        }]);

        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 4. License actions: suspend, activate, revoke, renew, unbind-device
    if (path.startsWith("licenses/")) {
      const parts = path.split("/");
      const licenseId = parts[1];
      const action = parts[2]; // e.g., 'suspend', 'revoke', 'renew', 'unbind'

      if (method === "POST" && action) {
        const { data: license, error: fetchErr } = await supabase
          .from("licenses")
          .select("*")
          .eq("id", licenseId)
          .single();
        if (fetchErr || !license) {
          return new Response(JSON.stringify({ error: "Licence introuvable" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (action === "suspend") {
          await supabase.from("licenses").update({ status: "SUSPENDED" }).eq("id", licenseId);
          await supabase.from("license_logs").insert([{
            license_id: licenseId,
            action: "SUSPENDED",
            details: { performed_by: adminActor }
          }]);
          return new Response(JSON.stringify({ success: true, status: "SUSPENDED" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (action === "activate") {
          await supabase.from("licenses").update({ status: "ACTIVE" }).eq("id", licenseId);
          await supabase.from("license_logs").insert([{
            license_id: licenseId,
            action: "ACTIVATED",
            details: { performed_by: adminActor }
          }]);
          return new Response(JSON.stringify({ success: true, status: "ACTIVE" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (action === "revoke") {
          await supabase.from("licenses").update({ status: "REVOKED" }).eq("id", licenseId);
          await supabase.from("license_logs").insert([{
            license_id: licenseId,
            action: "REVOKED",
            details: { performed_by: adminActor }
          }]);
          return new Response(JSON.stringify({ success: true, status: "REVOKED" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (action === "unbind") {
          // Unbind attached device
          await supabase.from("devices").delete().eq("license_id", licenseId);
          await supabase.from("licenses").update({
            device_id: null,
            status: license.status === "ACTIVE" ? "ACTIVE" : license.status
          }).eq("id", licenseId);

          await supabase.from("license_logs").insert([{
            license_id: licenseId,
            action: "DEVICE_UNBOUND",
            details: { previous_device: license.device_id, performed_by: adminActor }
          }]);

          return new Response(JSON.stringify({ success: true, message: "Appareil dissocié avec succès" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (action === "renew") {
          const body = await req.json().catch(() => ({}));
          const newType = body.duration_type || license.duration_type;
          let newExpires: string | null = null;
          const baseDate = license.expires_at && new Date(license.expires_at) > new Date()
            ? new Date(license.expires_at)
            : new Date();

          if (newType === "1_MONTH") baseDate.setMonth(baseDate.getMonth() + 1);
          else if (newType === "3_MONTHS") baseDate.setMonth(baseDate.getMonth() + 3);
          else if (newType === "6_MONTHS") baseDate.setMonth(baseDate.getMonth() + 6);
          else if (newType === "1_YEAR") baseDate.setFullYear(baseDate.getFullYear() + 1);
          else if (newType === "PERMANENT") baseDate.setFullYear(baseDate.getFullYear() + 100);

          newExpires = newType === "PERMANENT" ? null : baseDate.toISOString();

          await supabase.from("licenses").update({
            status: "ACTIVE",
            duration_type: newType,
            expires_at: newExpires
          }).eq("id", licenseId);

          await supabase.from("license_logs").insert([{
            license_id: licenseId,
            action: "RENEWED",
            details: { duration_type: newType, new_expires_at: newExpires, performed_by: adminActor }
          }]);

          return new Response(JSON.stringify({ success: true, status: "ACTIVE", expires_at: newExpires }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    }

    // 5. Audit logs
    if (path === "logs" && method === "GET") {
      const { data, error } = await supabase
        .from("license_logs")
        .select("*, license:licenses(license_key, technician:technicians(full_name))")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Route inconnue" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Erreur interne" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
