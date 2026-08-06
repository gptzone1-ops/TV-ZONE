import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function validUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function dashboardSnapshot(supabase) {
  const [{ data: requests, error: requestsError }, { count: availableCount, error: countError }] = await Promise.all([
    supabase
      .from("compensation_requests")
      .select("id, client_code, status, replacement_link, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("compensation_link_pool")
      .select("id", { count: "exact", head: true })
      .eq("status", "available"),
  ]);

  if (requestsError) throw requestsError;
  if (countError) throw countError;
  return { requests: requests || [], available_count: availableCount || 0 };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }
  if (req.headers["x-admin-password"] !== adminPassword) {
    return send(res, 401, { success: false, error: "unauthorized" });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const action = String(req.body?.action || "list");

  try {
    if (action === "list") {
      return send(res, 200, { success: true, ...(await dashboardSnapshot(supabase)) });
    }

    if (action === "import_links") {
      const uniqueLinks = [...new Set((Array.isArray(req.body?.links) ? req.body.links : [])
        .map((value) => String(value || "").trim())
        .filter(validUrl))];

      if (uniqueLinks.length === 0) {
        return send(res, 400, { success: false, error: "no_valid_links" });
      }

      const { data, error } = await supabase
        .from("compensation_link_pool")
        .upsert(
          uniqueLinks.map((replacementLink) => ({ replacement_link: replacementLink })),
          { onConflict: "replacement_link", ignoreDuplicates: true },
        )
        .select("id");

      if (error) throw error;
      return send(res, 200, {
        success: true,
        imported_count: data?.length || 0,
        ...(await dashboardSnapshot(supabase)),
      });
    }

    if (action === "assign") {
      const requestId = String(req.body?.request_id || "").trim();
      if (!requestId) return send(res, 400, { success: false, error: "request_id_required" });

      const { error } = await supabase.rpc("assign_compensation_link", { p_request_id: requestId });
      if (error) {
        if (String(error.message || "").includes("no_available_links")) {
          return send(res, 409, { success: false, error: "no_available_links" });
        }
        throw error;
      }
      return send(res, 200, { success: true, ...(await dashboardSnapshot(supabase)) });
    }

    if (action === "distribute") {
      const { data: assignedCount, error } = await supabase.rpc("distribute_compensation_links");
      if (error) throw error;
      return send(res, 200, {
        success: true,
        assigned_count: Number(assignedCount || 0),
        ...(await dashboardSnapshot(supabase)),
      });
    }

    return send(res, 400, { success: false, error: "unknown_action" });
  } catch (error) {
    console.error("Admin compensation endpoint failed:", error);
    return send(res, 500, { success: false, error: "operation_failed" });
  }
}
