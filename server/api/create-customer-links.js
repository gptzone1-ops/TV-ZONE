import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";

function send(res, status, payload) {
  return res.status(status).json(payload);
}

const PROFILE_STRUCTURES = {
  private: {
    names: ["A", "B", "C", "D", "E"],
    labels: ["A", "B", "C", "D", "E"],
  },
  shared: {
    names: ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "E1", "E2"],
    labels: ["A", "A", "B", "B", "C", "C", "D", "D", "E", "E"],
  },
};

const PROFILE_CODES = { A: "3333", B: "3334", C: "9999", D: "1212", E: "9090" };

function generateShortId(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function buildBatchProfileSlots(accountType, serviceType) {
  const labels = serviceType === "shahid" ? ["A", "B", "C", "D"] : ["A", "B", "C", "D", "E"];
  const names = accountType === "private" ? labels : labels.flatMap((label) => [`${label}1`, `${label}2`]);

  return names.map((profileName) => {
    const profileLabel = profileName.charAt(0);
    return {
      uuid: randomUUID(),
      short_id: generateShortId(),
      profile_name: profileName,
      profile_label: profileLabel,
      profile_code: serviceType === "shahid" ? "" : PROFILE_CODES[profileLabel],
      service_type: serviceType,
    };
  });
}

function normalizeBatchAccount(value) {
  return {
    email: String(value?.email || "").trim().toLowerCase(),
    password: String(value?.password || "").trim(),
    supplierCodeUrl: String(value?.supplier_code_url || "").trim(),
    expiresAt: String(value?.expires_at || "").trim(),
  };
}

function findRepeatedValues(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function isDuplicateAccountEmailError(error) {
  const details = [error?.message, error?.details, error?.hint, error?.constraint]
    .filter(Boolean)
    .join(" ");
  return /duplicate_account_email|accounts[^\n]*email|email[^\n]*(duplicate|unique)/i.test(details);
}

function replacementStatus(account, nowMs = Date.now()) {
  const expiresAtMs = new Date(account.expires_at).getTime();
  const createdAtMs = new Date(account.created_at).getTime();
  const remainingDays = Number.isFinite(expiresAtMs)
    ? Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000))
    : Number.POSITIVE_INFINITY;
  const daysPassed = Number.isFinite(createdAtMs)
    ? Math.floor((nowMs - createdAtMs) / (24 * 60 * 60 * 1000))
    : 0;

  return {
    remainingDays,
    daysPassed,
    replaceable: remainingDays <= 5 || daysPassed >= 25,
  };
}

function findReplacementCandidate(existingAccounts) {
  const sorted = [...existingAccounts].sort(
    (first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
  );
  const blockingAccount = sorted.find((account) => !replacementStatus(account).replaceable);
  if (blockingAccount) {
    return { blocked: blockingAccount, status: replacementStatus(blockingAccount), account: null };
  }

  const account = sorted.find((item) => replacementStatus(item).replaceable);
  return { blocked: null, status: account ? replacementStatus(account) : null, account: account || null };
}

async function replaceExistingAccount(supabase, existingAccount, account, serviceType, accountType) {
  const supplierCodeUrl = account.supplierCodeUrl || null;
  const links = buildBatchProfileSlots(accountType, serviceType);
  const { data: currentAccounts, error: lookupError } = await supabase
    .from("accounts")
    .select("*")
    .ilike("email", account.email);
  if (lookupError) throw lookupError;

  const candidate = findReplacementCandidate(currentAccounts || []);
  if (candidate.blocked) {
    throw new Error(`active_duplicate:${candidate.status.remainingDays}`);
  }
  if (!candidate.account || candidate.account.id !== existingAccount.id) {
    throw new Error("replacement_candidate_changed");
  }

  const oldAccountIds = (currentAccounts || []).map((item) => item.id);
  const { data: oldLinks, error: oldLinksError } = await supabase
    .from("customer_links")
    .select("id")
    .in("account_id", oldAccountIds);
  if (oldLinksError) throw oldLinksError;

  const stagedEmail = `replacement-${randomUUID()}@pending.invalid`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: freshAccount, error: accountInsertError } = await supabase
    .from("accounts")
    .insert({
      email: stagedEmail,
      password: account.password,
      account_type: accountType,
      service_type: serviceType,
      expires_at: expiresAt,
      created_at: createdAt,
      supplier_code_url: supplierCodeUrl,
      code_fetch_method: serviceType === "netflix" ? (supplierCodeUrl ? "external_link" : "auto_fetch") : null,
      use_automated_code: serviceType === "netflix" && !supplierCodeUrl,
      email_provider: "none",
      imap_enabled: false,
      normal_client_layout: true,
      hide_password_from_client: serviceType === "netflix",
      is_reported_closed: false,
      reported_closed_at: null,
    })
    .select("*")
    .single();
  if (accountInsertError || !freshAccount) throw accountInsertError || new Error("fresh_account_insert_failed");

  const cleanupFreshAccount = async () => {
    const { error } = await supabase.from("accounts").delete().eq("id", freshAccount.id);
    if (error) console.error("Fresh replacement cleanup failed:", error);
  };

  const freshLinkRows = sanitizeLinkRows(links, freshAccount.id, stagedEmail, serviceType);
  const { data: freshLinks, error: linkInsertError } = await supabase
    .from("customer_links")
    .insert(freshLinkRows)
    .select("*");
  if (linkInsertError || !Array.isArray(freshLinks) || freshLinks.length !== links.length) {
    await cleanupFreshAccount();
    throw linkInsertError || new Error("incomplete_fresh_link_batch");
  }

  const linkEmailUpdate = await supabase
    .from("customer_links")
    .update({ email: account.email })
    .eq("account_id", freshAccount.id)
    .select("*");
  if (linkEmailUpdate.error || linkEmailUpdate.data?.length !== links.length) {
    await cleanupFreshAccount();
    throw linkEmailUpdate.error || new Error("fresh_link_email_finalization_failed");
  }

  const { error: oldAccountDeleteError } = await supabase
    .from("accounts")
    .delete()
    .in("id", oldAccountIds);
  if (oldAccountDeleteError) {
    await cleanupFreshAccount();
    throw oldAccountDeleteError;
  }

  const accountEmailUpdate = await supabase
    .from("accounts")
    .update({ email: account.email })
    .eq("id", freshAccount.id)
    .select("*")
    .single();
  if (accountEmailUpdate.error || !accountEmailUpdate.data) {
    console.error("Fresh account email finalization failed after old account removal:", {
      stagedAccountId: freshAccount.id,
      error: accountEmailUpdate.error,
    });
    throw accountEmailUpdate.error || new Error("fresh_account_email_finalization_failed");
  }

  const oldLinkIds = (oldLinks || []).map((item) => item.id);
  const staleCleanupTasks = [
    supabase.from("household_pool").delete().in("account_id", oldAccountIds),
    supabase.from("household_assignments").delete().in("source_account_id", oldAccountIds),
    supabase.from("household_assignments").delete().in("replacement_account_id", oldAccountIds),
  ];
  if (oldLinkIds.length) {
    staleCleanupTasks.push(
      supabase.from("household_assignments").delete().in("customer_link_id", oldLinkIds),
    );
  }
  const staleCleanupResults = await Promise.all(staleCleanupTasks);
  staleCleanupResults.forEach(({ error }) => {
    if (error) console.error("Expired account auxiliary cleanup failed:", error);
  });

  return {
    account: accountEmailUpdate.data,
    links: linkEmailUpdate.data,
  };
}

function classifyAccounts(accounts, existingAccounts) {
  const existingByEmail = new Map();
  for (const existingAccount of existingAccounts || []) {
    const email = String(existingAccount.email || "").trim().toLowerCase();
    const matches = existingByEmail.get(email) || [];
    matches.push(existingAccount);
    existingByEmail.set(email, matches);
  }

  return accounts.map((account) => {
    const matches = existingByEmail.get(account.email) || [];
    if (!matches.length) return { email: account.email, status: "new", account: null, replacement: null };

    const candidate = findReplacementCandidate(matches);
    if (candidate.blocked) {
      return {
        email: account.email,
        status: "active",
        account: candidate.blocked,
        replacement: candidate.status,
      };
    }
    return {
      email: account.email,
      status: "replaceable",
      account: candidate.account,
      replacement: candidate.status,
    };
  });
}

async function loadExistingAccounts(supabase) {
  const { data, error } = await supabase
    .from("accounts")
    .select("*");
  if (error) throw error;
  return data || [];
}

function hasValidStructure(links, accountType, serviceType, osnSubscriptionMode) {
  const structure = PROFILE_STRUCTURES[accountType];
  if (!structure || links.length !== structure.names.length) return false;

  const requiresActivationKeys = serviceType === "osn" && osnSubscriptionMode === "telegram_keys";
  const activationKeys = requiresActivationKeys
    ? links.map((link) => String(link?.activation_key || "").trim())
    : [];
  if (requiresActivationKeys && (
    activationKeys.some((key) => !key)
    || new Set(activationKeys.map((key) => key.toLowerCase())).size !== activationKeys.length
  )) return false;

  return links.every((link, index) => (
    link
    && String(link.uuid || "").trim()
    && String(link.short_id || "").trim()
    && String(link.profile_code || "").trim()
    && String(link.service_type || "netflix") === serviceType
    && String(link.profile_name || "") === structure.names[index]
    && String(link.profile_label || "") === structure.labels[index]
  ));
}

function sanitizeLinkRows(links, accountId, email, serviceType) {
  return links.map((link) => ({
    account_id: accountId,
    email,
    uuid: String(link.uuid).trim(),
    short_id: String(link.short_id).trim(),
    service_type: serviceType,
    profile_name: String(link.profile_name).trim(),
    profile_label: String(link.profile_label).trim(),
    profile_code: String(link.profile_code).trim(),
    ...(serviceType === "osn" && String(link.activation_key || "").trim()
      ? { activation_key: String(link.activation_key).trim() }
      : {}),
  }));
}

async function createAccountsBatch(req, res, supabase) {
  const serviceType = String(req.body?.service_type || "").trim();
  const accountType = String(req.body?.account_type || "").trim();
  const requestedAccounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];

  if (!["netflix", "shahid"].includes(serviceType) || !["private", "shared"].includes(accountType)) {
    return send(res, 400, { success: false, error: "unsupported_batch_configuration" });
  }
  if (!requestedAccounts.length || requestedAccounts.length > 50) {
    return send(res, 400, { success: false, error: "invalid_batch_size" });
  }

  const accounts = requestedAccounts.map(normalizeBatchAccount);
  const emails = accounts.map((account) => account.email);
  const validEmailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const hasInvalidAccount = accounts.some((account) => (
    !validEmailPattern.test(account.email)
    || !account.password
    || !account.expiresAt
    || (account.supplierCodeUrl && !/^https?:\/\//i.test(account.supplierCodeUrl))
  ));
  if (hasInvalidAccount) return send(res, 400, { success: false, error: "invalid_batch_account" });
  const repeatedPayloadEmails = findRepeatedValues(emails);
  if (repeatedPayloadEmails.length) {
    return send(res, 409, {
      success: false,
      error: "duplicate_email",
      duplicate_emails: repeatedPayloadEmails,
    });
  }

  let existingAccounts;
  try {
    existingAccounts = await loadExistingAccounts(supabase);
  } catch (existingLookupError) {
    console.error("Batch duplicate email lookup failed:", existingLookupError);
    return send(res, 500, { success: false, error: "duplicate_lookup_failed" });
  }

  const newAccounts = [];
  const replacementPlans = [];
  const blockedAccounts = [];
  const classifications = classifyAccounts(accounts, existingAccounts);
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const classification = classifications[index];
    if (classification.status === "new") {
      newAccounts.push(account);
      continue;
    }
    if (classification.status === "active") {
      blockedAccounts.push({
        email: account.email,
        remaining_days: classification.replacement.remainingDays,
        reason: "active_account",
      });
      continue;
    }
    replacementPlans.push({ existingAccount: classification.account, account });
  }

  if (blockedAccounts.length) {
    return send(res, 409, {
      success: false,
      error: "active_duplicate",
      blocked_accounts: blockedAccounts,
      duplicate_emails: blockedAccounts.map((account) => account.email),
    });
  }

  const accountRows = newAccounts.map((account) => ({
    email: account.email,
    password: account.password,
    account_type: accountType,
    service_type: serviceType,
    expires_at: account.expiresAt,
    supplier_code_url: account.supplierCodeUrl || null,
    code_fetch_method: serviceType === "netflix" ? (account.supplierCodeUrl ? "external_link" : "auto_fetch") : null,
    use_automated_code: serviceType === "netflix" && !account.supplierCodeUrl,
    email_provider: "none",
    imap_enabled: false,
    normal_client_layout: true,
    hide_password_from_client: serviceType === "netflix",
  }));

  let createdAccounts = [];
  if (accountRows.length) {
    const { data, error: accountInsertError } = await supabase
      .from("accounts")
      .insert(accountRows)
      .select("*");
    if (accountInsertError) {
      console.error("Batch account insert failed:", accountInsertError);
      const duplicate = isDuplicateAccountEmailError(accountInsertError);
      return send(res, duplicate ? 409 : 500, {
        success: false,
        error: duplicate ? "duplicate_email" : accountInsertError.message,
        ...(duplicate ? { duplicate_emails: newAccounts.map((account) => account.email) } : {}),
      });
    }
    createdAccounts = data || [];
  }

  const created = Array.isArray(createdAccounts) ? createdAccounts : [];
  const createdIds = created.map((account) => account.id);
  if (created.length !== newAccounts.length) {
    if (createdIds.length) await supabase.from("accounts").delete().in("id", createdIds);
    return send(res, 500, { success: false, error: "incomplete_account_batch" });
  }

  const createdByEmail = new Map(created.map((account) => [String(account.email).trim().toLowerCase(), account]));
  const linkRows = newAccounts.flatMap((account) => {
    const createdAccount = createdByEmail.get(account.email);
    return buildBatchProfileSlots(accountType, serviceType).map((slot) => ({
      account_id: createdAccount.id,
      email: account.email,
      ...slot,
    }));
  });

  let createdLinks = [];
  if (linkRows.length) {
    const { data, error: linkInsertError } = await supabase
      .from("customer_links")
      .insert(linkRows)
      .select("*");
    if (linkInsertError || !Array.isArray(data) || data.length !== linkRows.length) {
      console.error("Batch customer link insert failed:", linkInsertError || "incomplete_link_batch");
      await supabase.from("accounts").delete().in("id", createdIds);
      return send(res, 500, { success: false, error: linkInsertError?.message || "incomplete_link_batch" });
    }
    createdLinks = data;
  }

  const replacedAccounts = [];
  const replacedLinks = [];
  for (const plan of replacementPlans) {
    try {
      const replacement = await replaceExistingAccount(
        supabase,
        plan.existingAccount,
        plan.account,
        serviceType,
        accountType,
      );
      replacedAccounts.push(replacement.account);
      replacedLinks.push(...replacement.links);
    } catch (replacementError) {
      console.error("Batch expired account replacement failed:", replacementError);
      return send(res, 500, {
        success: false,
        error: "account_replacement_failed",
        failed_email: plan.account.email,
      });
    }
  }

  if (!created.length && !replacedAccounts.length) {
    return send(res, 409, {
      success: false,
      error: "account_replacement_failed",
      blocked_accounts: blockedAccounts,
      duplicate_emails: blockedAccounts.map((account) => account.email),
    });
  }

  return send(res, 200, {
    success: true,
    accounts: [...created, ...replacedAccounts],
    links: [...createdLinks, ...replacedLinks],
    created_count: created.length + replacedAccounts.length,
    replaced_count: replacedAccounts.length,
    blocked_accounts: blockedAccounts,
  });
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

  if (req.body?.action === "validate_account_emails") {
    const serviceType = String(req.body?.service_type || "").trim();
    const accountType = String(req.body?.account_type || "").trim();
    const emails = Array.isArray(req.body?.emails)
      ? req.body.emails.map((email) => String(email || "").trim().toLowerCase())
      : [];
    if (
      !["netflix", "shahid"].includes(serviceType)
      || !["private", "shared"].includes(accountType)
      || !emails.length
      || emails.length > 50
    ) {
      return send(res, 400, { success: false, error: "invalid_validation_request" });
    }

    try {
      const existingAccounts = await loadExistingAccounts(supabase);
      const classifications = classifyAccounts(
        emails.map((email) => ({ email })),
        existingAccounts,
      );
      return send(res, 200, {
        success: true,
        accounts: classifications.map((item) => ({
          email: item.email,
          status: item.status,
          remaining_days: item.replacement?.remainingDays ?? null,
          days_passed: item.replacement?.daysPassed ?? null,
        })),
      });
    } catch (validationError) {
      console.error("Account validation failed:", validationError);
      return send(res, 500, { success: false, error: "account_validation_failed" });
    }
  }

  if (req.body?.action === "replace_expired_account") {
    const serviceType = String(req.body?.service_type || "").trim();
    const accountType = String(req.body?.account_type || "").trim();
    const account = normalizeBatchAccount(req.body?.account);
    if (
      !["netflix", "shahid"].includes(serviceType)
      || !["private", "shared"].includes(accountType)
      || !account.email
      || !account.password
      || (account.supplierCodeUrl && !/^https?:\/\//i.test(account.supplierCodeUrl))
    ) {
      return send(res, 400, { success: false, error: "invalid_replacement_account" });
    }

    const { data: existingAccounts, error: lookupError } = await supabase
      .from("accounts")
      .select("*")
      .ilike("email", account.email);
    if (lookupError) {
      console.error("Expired account replacement lookup failed:", lookupError);
      return send(res, 500, { success: false, error: "replacement_lookup_failed" });
    }
    if (!existingAccounts?.length) {
      return send(res, 200, { success: true, replaced: false });
    }

    const candidate = findReplacementCandidate(existingAccounts);
    if (candidate.blocked) {
      return send(res, 409, {
        success: false,
        error: "active_duplicate",
        remaining_days: candidate.status.remainingDays,
      });
    }
    try {
      const replacement = await replaceExistingAccount(supabase, candidate.account, account, serviceType, accountType);
      return send(res, 200, { success: true, replaced: true, ...replacement });
    } catch (replacementError) {
      console.error("Expired account replacement failed:", replacementError);
      return send(res, 500, { success: false, error: "account_replacement_failed" });
    }
  }

  if (req.body?.action === "batch_create_accounts") {
    return createAccountsBatch(req, res, supabase);
  }

  const accountId = String(req.body?.account_id || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const links = Array.isArray(req.body?.links) ? req.body.links : null;

  if (!accountId || !email || !links) {
    return send(res, 400, { success: false, error: "invalid_payload" });
  }

  const [accountResult, existingLinksResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,email,service_type,account_type,osn_subscription_mode")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("customer_links")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId),
  ]);
  const { data: account, error: accountError } = accountResult;
  const { count: existingCount, error: existingError } = existingLinksResult;

  if (accountError) {
    console.error("Strict customer link account lookup failed:", accountError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }

  if (!account) return send(res, 404, { success: false, error: "account_not_found" });
  const serviceType = account.service_type || "netflix";
  if (!["netflix", "osn"].includes(serviceType) || !PROFILE_STRUCTURES[account.account_type]) {
    return send(res, 409, { success: false, error: "unsupported_account_type" });
  }
  if (String(account.email || "").trim().toLowerCase() !== email) {
    return send(res, 409, { success: false, error: "account_email_mismatch" });
  }
  if (!hasValidStructure(links, account.account_type, serviceType, account.osn_subscription_mode)) {
    return send(res, 409, { success: false, error: "invalid_links_structure" });
  }

  if (existingError) {
    console.error("Strict customer link existence check failed:", existingError);
    return send(res, 500, { success: false, error: "link_check_failed" });
  }
  if ((existingCount || 0) > 0) {
    return send(res, 409, { success: false, error: "links_already_exist" });
  }

  // PostgREST sends this array as one INSERT statement, so all rows commit together.
  // Keep this payload compatible with databases that have not applied optional
  // tracking migrations. Only established customer_links columns are inserted.
  const rows = sanitizeLinkRows(links, accountId, email, serviceType);
  const { data, error } = await supabase
    .from("customer_links")
    .insert(rows)
    .select("*");

  if (error) {
    console.error("Strict customer link creation failed:", error);
    const status = /links_already_exist|invalid_|mismatch|unsupported/i.test(error.message || "") ? 409 : 500;
    return send(res, status, {
      success: false,
      error: error.message || "link_creation_failed",
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null,
    });
  }

  const createdLinks = Array.isArray(data) ? data : [];
  const expectedCount = PROFILE_STRUCTURES[account.account_type].names.length;
  if (createdLinks.length !== expectedCount) {
    console.error("Strict customer link creation returned an invalid count:", createdLinks.length);
    return send(res, 500, { success: false, error: "invalid_generated_links_count" });
  }

  return send(res, 200, { success: true, links: createdLinks });
}
