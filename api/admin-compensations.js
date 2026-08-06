import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";
const validAccountTypes = new Set(["private", "shared"]);

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

function normalizeAccountType(value) {
  const type = String(value || "").trim().toLowerCase();
  return validAccountTypes.has(type) ? type : null;
}

async function requestTypeMap(supabase, requests) {
  const clientCodes = [...new Set(requests.map((request) => String(request.client_code || "").trim().toUpperCase()).filter(Boolean))];
  if (!clientCodes.length) return new Map();

  const { data: links, error: linksError } = await supabase
    .from("customer_links")
    .select("client_code,account_id")
    .in("client_code", clientCodes);
  if (linksError) throw linksError;

  const accountIds = [...new Set((links || []).map((link) => link.account_id).filter(Boolean))];
  if (!accountIds.length) return new Map();

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id,account_type")
    .in("id", accountIds);
  if (accountsError) throw accountsError;

  const accountTypes = new Map((accounts || []).map((account) => [account.id, normalizeAccountType(account.account_type)]));
  return new Map((links || []).map((link) => [
    String(link.client_code || "").trim().toUpperCase(),
    accountTypes.get(link.account_id) || null,
  ]));
}

async function availableLinkCounts(supabase) {
  const countFor = async (type) => {
    let query = supabase
      .from("compensation_link_pool")
      .select("id", { count: "exact", head: true })
      .eq("status", "available");
    query = type === null ? query.is("account_type", null) : query.eq("account_type", type);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  };

  const [privateCount, sharedCount, unclassifiedCount] = await Promise.all([
    countFor("private"),
    countFor("shared"),
    countFor(null),
  ]);

  return {
    private: privateCount,
    shared: sharedCount,
    unclassified: unclassifiedCount,
    total: privateCount + sharedCount + unclassifiedCount,
  };
}

async function dashboardSnapshot(supabase) {
  const { data: requests, error: requestsError } = await supabase
    .from("compensation_requests")
    .select("id, client_code, status, replacement_link, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (requestsError) throw requestsError;

  const safeRequests = requests || [];
  const [typesByCode, availableCounts] = await Promise.all([
    requestTypeMap(supabase, safeRequests),
    availableLinkCounts(supabase),
  ]);
  const typedRequests = safeRequests.map((request) => ({
    ...request,
    account_type: typesByCode.get(String(request.client_code || "").trim().toUpperCase()) || null,
  }));
  const pendingCounts = typedRequests.reduce(
    (counts, request) => {
      if (request.status !== "pending") return counts;
      if (request.account_type === "private") counts.private += 1;
      else if (request.account_type === "shared") counts.shared += 1;
      else counts.unknown += 1;
      return counts;
    },
    { private: 0, shared: 0, unknown: 0 },
  );

  return {
    requests: typedRequests,
    available_count: availableCounts.total,
    available_counts: availableCounts,
    pending_counts: pendingCounts,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success: false, error: "method_not_allowed" });
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
      const linkType = normalizeAccountType(req.body?.link_type);
      if (!linkType) return send(res, 400, { success: false, error: "invalid_link_type" });

      const uniqueLinks = [...new Set((Array.isArray(req.body?.links) ? req.body.links : [])
        .map((value) => String(value || "").trim())
        .filter(validUrl))];
      if (!uniqueLinks.length) return send(res, 400, { success: false, error: "no_valid_links" });

      const { data, error } = await supabase
        .from("compensation_link_pool")
        .upsert(
          uniqueLinks.map((replacementLink) => ({ replacement_link: replacementLink, account_type: linkType })),
          { onConflict: "replacement_link", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;

      return send(res, 200, {
        success: true,
        imported_count: data?.length || 0,
        link_type: linkType,
        ...(await dashboardSnapshot(supabase)),
      });
    }

    if (action === "assign") {
      const requestId = String(req.body?.request_id || "").trim();
      if (!requestId) return send(res, 400, { success: false, error: "request_id_required" });

      const { error } = await supabase.rpc("assign_compensation_link", { p_request_id: requestId });
      if (error) {
        const message = String(error.message || "");
        if (message.includes("no_available_links")) {
          return send(res, 409, { success: false, error: "no_available_links" });
        }
        if (message.includes("request_account_type_not_found")) {
          return send(res, 409, { success: false, error: "request_account_type_not_found" });
        }
        throw error;
      }
      return send(res, 200, { success: true, ...(await dashboardSnapshot(supabase)) });
    }

    if (action === "distribute") {
      const mode = String(req.body?.mode || "all").trim().toLowerCase();
      if (!["private", "shared", "all"].includes(mode)) {
        return send(res, 400, { success: false, error: "invalid_distribution_mode" });
      }

      const before = await dashboardSnapshot(supabase);
      const { error: distributionError } = await supabase.rpc("distribute_compensation_links_by_type", {
        p_account_type: mode === "all" ? null : mode,
      });
      if (distributionError) throw distributionError;

      const snapshot = await dashboardSnapshot(supabase);
      const assignedCounts = {
        private: Math.max(0, before.pending_counts.private - snapshot.pending_counts.private),
        shared: Math.max(0, before.pending_counts.shared - snapshot.pending_counts.shared),
      };
      const exhaustedTypes = ["private", "shared"].filter((type) => {
        if (mode !== "all" && mode !== type) return false;
        return snapshot.pending_counts[type] > 0 && snapshot.available_counts[type] === 0;
      });
      return send(res, 200, {
        success: true,
        mode,
        assigned_count: assignedCounts.private + assignedCounts.shared,
        assigned_counts: assignedCounts,
        remaining_counts: snapshot.pending_counts,
        exhausted_types: exhaustedTypes,
        ...snapshot,
      });
    }

    return send(res, 400, { success: false, error: "unknown_action" });
  } catch (error) {
    console.error("Admin compensation endpoint failed:", error);
    return send(res, 500, { success: false, error: "operation_failed" });
  }
}
