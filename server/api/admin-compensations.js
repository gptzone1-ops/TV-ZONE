import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";
const validAccountTypes = new Set(["private", "shared"]);

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(payload);
}

function databaseErrorPayload(error) {
  return {
    success: false,
    error: "operation_failed",
    message: String(error?.message || "تعذر تنفيذ عملية طلبات التعويض"),
    code: error?.code || null,
    details: error?.details || null,
  };
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

function remainingDays(expiresAt) {
  const expiryMs = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(expiryMs)) return null;
  return Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000));
}

function customerReferenceFromUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "v" && segments[1]) return { column: "short_id", value: decodeURIComponent(segments[1]) };
    if (segments[0] === "view" && segments[1]) return { column: "uuid", value: decodeURIComponent(segments[1]) };
    return null;
  } catch {
    return null;
  }
}

async function requestMetadataMap(supabase, requests) {
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
    .select("id,account_type,email,expires_at")
    .in("id", accountIds);
  if (accountsError) throw accountsError;

  const accountsById = new Map((accounts || []).map((account) => [account.id, account]));
  return new Map((links || []).map((link) => [
    String(link.client_code || "").trim().toUpperCase(),
    (() => {
      const account = accountsById.get(link.account_id);
      return {
        account_type: normalizeAccountType(account?.account_type),
        email: String(account?.email || "").trim() || null,
        days_remaining: remainingDays(account?.expires_at),
      };
    })(),
  ]));
}

async function poolMetadataMap(supabase, poolLinks) {
  const references = poolLinks
    .map((poolLink) => ({ poolLink, reference: customerReferenceFromUrl(poolLink.replacement_link) }))
    .filter((item) => item.reference);
  if (!references.length) return new Map();

  const shortIds = [...new Set(references.filter((item) => item.reference.column === "short_id").map((item) => item.reference.value))];
  const uuids = [...new Set(references.filter((item) => item.reference.column === "uuid").map((item) => item.reference.value))];
  const queries = [];
  if (shortIds.length) {
    queries.push(supabase.from("customer_links").select("id,short_id,uuid,account_id").in("short_id", shortIds));
  }
  if (uuids.length) {
    queries.push(supabase.from("customer_links").select("id,short_id,uuid,account_id").in("uuid", uuids));
  }

  const linkResults = await Promise.all(queries);
  const resolvedLinks = [];
  for (const result of linkResults) {
    if (result.error) throw result.error;
    resolvedLinks.push(...(result.data || []));
  }

  const accountIds = [...new Set(resolvedLinks.map((link) => link.account_id).filter(Boolean))];
  if (!accountIds.length) return new Map();
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id,email,expires_at")
    .in("id", accountIds);
  if (accountsError) throw accountsError;

  const accountsById = new Map((accounts || []).map((account) => [account.id, account]));
  const linksByShortId = new Map(resolvedLinks.filter((link) => link.short_id).map((link) => [String(link.short_id), link]));
  const linksByUuid = new Map(resolvedLinks.filter((link) => link.uuid).map((link) => [String(link.uuid), link]));
  const metadata = new Map();
  for (const { poolLink, reference } of references) {
    const customerLink = reference.column === "short_id"
      ? linksByShortId.get(reference.value)
      : linksByUuid.get(reference.value);
    const account = customerLink ? accountsById.get(customerLink.account_id) : null;
    metadata.set(poolLink.id, {
      email: String(account?.email || "").trim() || null,
      days_remaining: remainingDays(account?.expires_at),
    });
  }
  return metadata;
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
  const [requestsResult, availableLinksResult] = await Promise.all([
    supabase
      .from("compensation_requests")
      .select("id, client_code, status, replacement_link, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("compensation_link_pool")
      .select("id,replacement_link,account_type,status,assigned_request_id,assigned_at,created_at")
      .eq("status", "available")
      .is("assigned_request_id", null)
      .is("assigned_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (availableLinksResult.error) throw availableLinksResult.error;

  const safeRequests = requestsResult.data || [];
  const safeAvailableLinks = availableLinksResult.data || [];
  const [metadataByCode, poolMetadata, availableCounts] = await Promise.all([
    requestMetadataMap(supabase, safeRequests),
    poolMetadataMap(supabase, safeAvailableLinks),
    availableLinkCounts(supabase),
  ]);
  const typedRequests = safeRequests.map((request) => {
    const metadata = metadataByCode.get(String(request.client_code || "").trim().toUpperCase());
    return {
      ...request,
      account_type: metadata?.account_type || null,
      email: metadata?.email || null,
      days_remaining: metadata?.days_remaining ?? null,
    };
  });
  const enrichedAvailableLinks = safeAvailableLinks.map((poolLink) => ({
    ...poolLink,
    email: poolMetadata.get(poolLink.id)?.email || null,
    days_remaining: poolMetadata.get(poolLink.id)?.days_remaining ?? null,
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
    available_links: enrichedAvailableLinks,
    available_count: availableCounts.total,
    available_counts: availableCounts,
    pending_counts: pendingCounts,
  };
}

function buildDistributionPlan(snapshot, mode) {
  const requests = snapshot.requests
    .filter((request) => request.status === "pending" && request.account_type && (mode === "all" || request.account_type === mode))
    .sort((first, second) => String(first.created_at).localeCompare(String(second.created_at)) || String(first.id).localeCompare(String(second.id)));
  const availableByType = {
    private: snapshot.available_links.filter((link) => link.account_type === "private"),
    shared: snapshot.available_links.filter((link) => link.account_type === "shared"),
  };
  const matches = [];

  for (const request of requests) {
    const candidates = availableByType[request.account_type];
    if (!candidates?.length) continue;
    let bestIndex = 0;
    let bestDifference = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const link = candidates[index];
      const difference = Number.isFinite(request.days_remaining) && Number.isFinite(link.days_remaining)
        ? Math.abs(link.days_remaining - request.days_remaining)
        : Number.POSITIVE_INFINITY;
      if (difference < bestDifference) {
        bestIndex = index;
        bestDifference = difference;
      }
    }

    const [selectedLink] = candidates.splice(bestIndex, 1);
    const dayDifference = Number.isFinite(request.days_remaining) && Number.isFinite(selectedLink.days_remaining)
      ? selectedLink.days_remaining - request.days_remaining
      : null;
    matches.push({
      request_id: request.id,
      client_code: request.client_code,
      request_email: request.email,
      account_type: request.account_type,
      request_days: request.days_remaining,
      link_id: selectedLink.id,
      replacement_link: selectedLink.replacement_link,
      link_days: selectedLink.days_remaining,
      day_difference: dayDifference,
    });
  }

  return matches;
}

async function executeDistributionPlan(supabase, matches) {
  if (!matches.length) return 0;
  const requestIds = matches.map((match) => match.request_id);
  const linkIds = matches.map((match) => match.link_id);
  if (new Set(requestIds).size !== requestIds.length || new Set(linkIds).size !== linkIds.length) {
    throw new Error("duplicate_distribution_assignment");
  }

  const [requestsResult, linksResult] = await Promise.all([
    supabase.from("compensation_requests").select("id,status").in("id", requestIds),
    supabase.from("compensation_link_pool").select("id,status,assigned_request_id,assigned_at").in("id", linkIds),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (linksResult.error) throw linksResult.error;
  if ((requestsResult.data || []).some((request) => request.status !== "pending") || requestsResult.data?.length !== requestIds.length) {
    throw new Error("distribution_plan_stale");
  }
  if ((linksResult.data || []).some((link) => link.status !== "available" || link.assigned_request_id || link.assigned_at) || linksResult.data?.length !== linkIds.length) {
    throw new Error("distribution_plan_stale");
  }

  const completed = [];
  try {
    for (const match of matches) {
      const assignedAt = new Date().toISOString();
      const { data: claimedLinks, error: claimError } = await supabase
        .from("compensation_link_pool")
        .update({ status: "assigned", assigned_request_id: match.request_id, assigned_at: assignedAt })
        .eq("id", match.link_id)
        .eq("status", "available")
        .is("assigned_request_id", null)
        .is("assigned_at", null)
        .select("id");
      if (claimError || claimedLinks?.length !== 1) throw claimError || new Error("distribution_plan_stale");

      const { data: updatedRequests, error: requestError } = await supabase
        .from("compensation_requests")
        .update({ status: "completed", replacement_link: match.replacement_link })
        .eq("id", match.request_id)
        .eq("status", "pending")
        .select("id");
      if (requestError || updatedRequests?.length !== 1) {
        await supabase
          .from("compensation_link_pool")
          .update({ status: "available", assigned_request_id: null, assigned_at: null })
          .eq("id", match.link_id)
          .eq("assigned_request_id", match.request_id);
        throw requestError || new Error("distribution_plan_stale");
      }
      completed.push(match);
    }
  } catch (error) {
    for (const match of completed.reverse()) {
      await supabase
        .from("compensation_requests")
        .update({ status: "pending", replacement_link: null })
        .eq("id", match.request_id)
        .eq("replacement_link", match.replacement_link);
      await supabase
        .from("compensation_link_pool")
        .update({ status: "available", assigned_request_id: null, assigned_at: null })
        .eq("id", match.link_id)
        .eq("assigned_request_id", match.request_id);
    }
    throw error;
  }

  return completed.length;
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

    if (action === "delete_available_link") {
      const linkId = String(req.body?.link_id || "").trim();
      if (!linkId) return send(res, 400, { success: false, error: "link_id_required" });

      const { data, error } = await supabase
        .from("compensation_link_pool")
        .delete()
        .eq("id", linkId)
        .eq("status", "available")
        .is("assigned_request_id", null)
        .is("assigned_at", null)
        .select("id");
      if (error) throw error;
      if (!data?.length) return send(res, 409, { success: false, error: "link_not_available" });

      return send(res, 200, {
        success: true,
        deleted_count: data.length,
        ...(await dashboardSnapshot(supabase)),
      });
    }

    if (action === "delete_all_available_links") {
      const linkType = normalizeAccountType(req.body?.link_type);
      if (!linkType) return send(res, 400, { success: false, error: "invalid_link_type" });

      const { data, error } = await supabase
        .from("compensation_link_pool")
        .delete()
        .eq("account_type", linkType)
        .eq("status", "available")
        .is("assigned_request_id", null)
        .is("assigned_at", null)
        .select("id");
      if (error) throw error;

      return send(res, 200, {
        success: true,
        deleted_count: data?.length || 0,
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

    if (action === "preview_distribution") {
      const mode = String(req.body?.mode || "all").trim().toLowerCase();
      if (!["private", "shared", "all"].includes(mode)) {
        return send(res, 400, { success: false, error: "invalid_distribution_mode" });
      }
      const snapshot = await dashboardSnapshot(supabase);
      const matches = buildDistributionPlan(snapshot, mode);
      return send(res, 200, {
        success: true,
        mode,
        matches,
        match_count: matches.length,
      });
    }

    if (action === "confirm_distribution") {
      const mode = String(req.body?.mode || "all").trim().toLowerCase();
      if (!["private", "shared", "all"].includes(mode)) {
        return send(res, 400, { success: false, error: "invalid_distribution_mode" });
      }
      const submittedMatches = Array.isArray(req.body?.matches) ? req.body.matches : [];
      const submittedPairs = submittedMatches
        .map((match) => `${String(match?.request_id || "").trim()}:${String(match?.link_id || "").trim()}`)
        .filter((pair) => !pair.startsWith(":"))
        .sort();
      const before = await dashboardSnapshot(supabase);
      const currentPlan = buildDistributionPlan(before, mode);
      const currentPairs = currentPlan.map((match) => `${match.request_id}:${match.link_id}`).sort();
      if (!currentPlan.length || submittedPairs.length !== currentPairs.length || submittedPairs.some((pair, index) => pair !== currentPairs[index])) {
        return send(res, 409, { success: false, error: "distribution_plan_stale" });
      }

      let assignedCount = 0;
      try {
        assignedCount = await executeDistributionPlan(supabase, currentPlan);
      } catch (executionError) {
        if (String(executionError?.message || "").includes("distribution_plan_stale")) {
          return send(res, 409, { success: false, error: "distribution_plan_stale" });
        }
        throw executionError;
      }

      const snapshot = await dashboardSnapshot(supabase);
      return send(res, 200, {
        success: true,
        mode,
        assigned_count: assignedCount,
        remaining_counts: snapshot.pending_counts,
        ...snapshot,
      });
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
    return send(res, 500, databaseErrorPayload(error));
  }
}
