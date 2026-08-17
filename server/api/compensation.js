import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function normalizeClientCode(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function publicRequest(request) {
  return {
    client_code: request.client_code,
    status: request.status,
    replacement_link: request.status === "completed" ? request.replacement_link : null,
    created_at: request.created_at,
    updated_at: request.updated_at,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const clientCode = normalizeClientCode(req.body?.client_code);
  if (!/^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(clientCode)) {
    return send(res, 400, { success: false, error: "invalid_client_code" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: customer, error: customerError } = await supabase
      .from("customer_links")
      .select("id, client_code")
      .ilike("client_code", clientCode)
      .maybeSingle();

    if (customerError) {
      console.error("Compensation customer lookup failed:", customerError);
      return send(res, 500, {
        success: false,
        error: "customer_lookup_failed",
        message: customerError.message || null,
        code: customerError.code || null,
      });
    }
    if (!customer) {
      return send(res, 404, { success: false, error: "invalid_client_code" });
    }

    const canonicalCode = String(customer.client_code).toUpperCase();
    const { data: existingRequest, error: requestLookupError } = await supabase
      .from("compensation_requests")
      .select("client_code, status, replacement_link, created_at, updated_at")
      .ilike("client_code", canonicalCode)
      .maybeSingle();

    if (requestLookupError) {
      console.error("Compensation request lookup failed:", requestLookupError);
      return send(res, 500, {
        success: false,
        error: "request_lookup_failed",
        message: requestLookupError.message || null,
        code: requestLookupError.code || null,
      });
    }

    if (existingRequest) {
      return send(res, 200, { success: true, created: false, request: publicRequest(existingRequest) });
    }

    const { data: createdRequest, error: createError } = await supabase
      .from("compensation_requests")
      .insert({ client_code: canonicalCode, status: "pending" })
      .select("id, client_code, status, replacement_link, created_at, updated_at")
      .single();

    if (createError?.code === "23505") {
      const { data: concurrentRequest, error: concurrentError } = await supabase
        .from("compensation_requests")
        .select("client_code, status, replacement_link, created_at, updated_at")
        .ilike("client_code", canonicalCode)
        .single();

      if (!concurrentError && concurrentRequest) {
        return send(res, 200, { success: true, created: false, request: publicRequest(concurrentRequest) });
      }
    }

    if (createError || !createdRequest) {
      console.error("Compensation request creation failed:", createError);
      return send(res, 500, {
        success: false,
        error: "request_creation_failed",
        message: createError?.message || null,
        code: createError?.code || null,
      });
    }

    const { data: assignmentRows, error: assignmentError } = await supabase.rpc("assign_compensation_link", {
      p_request_id: createdRequest.id,
    });

    if (assignmentError) {
      const assignmentMessage = String(assignmentError.message || "");
      if (assignmentMessage.includes("no_available_links")) {
        return send(res, 201, {
          success: true,
          created: true,
          automatically_assigned: false,
          request: publicRequest(createdRequest),
        });
      }

      console.error("Automatic compensation assignment failed; request remains pending:", assignmentError);
      return send(res, 201, {
        success: true,
        created: true,
        automatically_assigned: false,
        request: publicRequest(createdRequest),
      });
    }

    const assignment = Array.isArray(assignmentRows) ? assignmentRows[0] : assignmentRows;
    const completedRequest = {
      ...createdRequest,
      client_code: assignment?.assigned_client_code || createdRequest.client_code,
      status: assignment?.assigned_status || "completed",
      replacement_link: assignment?.assigned_replacement_link || null,
      updated_at: assignment?.assigned_updated_at || createdRequest.updated_at,
    };

    if (!completedRequest.replacement_link) {
      console.error("Automatic compensation assignment returned no replacement link:", assignmentRows);
      return send(res, 201, {
        success: true,
        created: true,
        automatically_assigned: false,
        request: publicRequest(createdRequest),
      });
    }

    return send(res, 201, {
      success: true,
      created: true,
      automatically_assigned: true,
      request: publicRequest(completedRequest),
    });
  } catch (error) {
    console.error("Compensation endpoint failed:", error);
    return send(res, 500, { success: false, error: "unexpected_error" });
  }
}
