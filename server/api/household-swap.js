import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";
const dayMs = 24 * 60 * 60 * 1000;

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(payload);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function remainingDays(expiresAt) {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return -1;
  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / dayMs));
}

function isAvailableLink(link, reservedLinkIds) {
  return !reservedLinkIds.has(link.id)
    && (link.service_type === "netflix" || link.service_type == null)
    && link.selected_device == null
    && Number(link.code_requested_count || 0) === 0
    && link.has_used_tv_link !== true;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function resultPayload(targetDays, replacement, link, existing = false) {
  const replacementDays = remainingDays(replacement.expires_at);
  return {
    success: true,
    matched: true,
    existing,
    target_days: targetDays,
    replacement: {
      account_email: replacement.email,
      days_remaining: replacementDays,
      difference: replacementDays - targetDays,
      profile_name: link.profile_name,
      profile_label: link.profile_label,
      link: {
        id: link.id,
        uuid: link.uuid,
        short_id: link.short_id || null,
      },
    },
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

  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    return send(res, 400, { success: false, error: "invalid_email" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: targetAccounts, error: targetError } = await supabase
      .from("accounts")
      .select("id,email,expires_at,created_at")
      .ilike("email", email)
      .or("service_type.eq.netflix,service_type.is.null")
      .in("account_type", ["private", "shared"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (targetError) throw targetError;

    const target = targetAccounts?.[0];
    if (!target) return send(res, 404, { success: false, error: "account_not_found" });

    const targetDays = remainingDays(target.expires_at);
    if (targetDays <= 0) {
      return send(res, 409, { success: false, error: "account_expired" });
    }

    const { error: poolUpsertError } = await supabase
      .from("household_pool")
      .upsert({
        account_id: target.id,
        email: normalizeEmail(target.email),
        days_remaining: targetDays,
        updated_at: new Date().toISOString(),
      }, { onConflict: "account_id" });
    if (poolUpsertError) throw poolUpsertError;

    const { data: existingAssignments, error: existingError } = await supabase
      .from("household_assignments")
      .select("replacement_account_id,customer_link_id")
      .eq("source_account_id", target.id)
      .limit(1);
    if (existingError) throw existingError;

    const existingAssignment = existingAssignments?.[0];
    if (existingAssignment) {
      const [{ data: replacementAccounts, error: accountError }, { data: links, error: linkError }] = await Promise.all([
        supabase.from("accounts").select("id,email,expires_at").eq("id", existingAssignment.replacement_account_id).limit(1),
        supabase.from("customer_links").select("id,uuid,short_id,profile_name,profile_label").eq("id", existingAssignment.customer_link_id).limit(1),
      ]);
      if (accountError) throw accountError;
      if (linkError) throw linkError;
      if (replacementAccounts?.[0] && links?.[0]) {
        return send(res, 200, resultPayload(targetDays, replacementAccounts[0], links[0], true));
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: activeAccounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id,email,expires_at,created_at")
      .or("service_type.eq.netflix,service_type.is.null")
      .in("account_type", ["private", "shared"])
      .gte("expires_at", today)
      .neq("id", target.id);
    if (accountsError) throw accountsError;

    const matchingAccounts = (activeAccounts || [])
      .map((account) => ({ ...account, days: remainingDays(account.expires_at) }))
      .filter((account) => (
        account.days > 0
        && Math.abs(account.days - targetDays) <= 2
        && normalizeEmail(account.email) !== normalizeEmail(target.email)
      ));

    if (!matchingAccounts.length) {
      return send(res, 200, { success: true, matched: false, queued: true, target_days: targetDays });
    }

    const candidateIds = matchingAccounts.map((account) => account.id);
    const [{ data: pooledAccounts, error: poolError }, { data: candidateLinks, error: linksError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabase.from("household_pool").select("account_id").in("account_id", candidateIds),
      supabase
        .from("customer_links")
        .select("id,account_id,uuid,short_id,profile_name,profile_label,selected_device,code_requested_count,has_used_tv_link,service_type")
        .in("account_id", candidateIds),
      supabase.from("household_assignments").select("customer_link_id"),
    ]);
    if (poolError) throw poolError;
    if (linksError) throw linksError;
    if (assignmentsError) throw assignmentsError;

    const poolAccountIds = new Set((pooledAccounts || []).map((item) => item.account_id));
    const reservedLinkIds = new Set((assignments || []).map((item) => item.customer_link_id));
    const linksByAccount = new Map();
    for (const link of candidateLinks || []) {
      if (!isAvailableLink(link, reservedLinkIds)) continue;
      const links = linksByAccount.get(link.account_id) || [];
      links.push(link);
      linksByAccount.set(link.account_id, links);
    }

    const sortByClosestDays = (first, second) => {
      const difference = Math.abs(first.days - targetDays) - Math.abs(second.days - targetDays);
      return difference || new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
    };
    const prioritizedAccounts = [
      ...matchingAccounts.filter((account) => poolAccountIds.has(account.id)).sort(sortByClosestDays),
      ...matchingAccounts.filter((account) => !poolAccountIds.has(account.id)).sort(sortByClosestDays),
    ];

    for (const replacement of prioritizedAccounts) {
      for (const link of shuffle(linksByAccount.get(replacement.id) || [])) {
        const { error: reserveError } = await supabase.from("household_assignments").insert({
          source_account_id: target.id,
          replacement_account_id: replacement.id,
          customer_link_id: link.id,
        });

        if (reserveError?.code === "23505") continue;
        if (reserveError) throw reserveError;

        const matchedAt = new Date().toISOString();
        await supabase
          .from("household_pool")
          .update({ last_matched_at: matchedAt, updated_at: matchedAt })
          .in("account_id", [target.id, replacement.id]);

        return send(res, 200, resultPayload(targetDays, replacement, link));
      }
    }

    return send(res, 200, { success: true, matched: false, queued: true, target_days: targetDays });
  } catch (error) {
    console.error("Household swap failed:", error);
    return send(res, 500, {
      success: false,
      error: "household_swap_failed",
      message: String(error?.message || "تعذر البحث عن حساب بديل"),
      code: error?.code || null,
    });
  }
}
