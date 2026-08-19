import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";

function parseStorageObject(publicUrl) {
  if (!publicUrl) return null;

  try {
    const parsedUrl = new URL(publicUrl);
    const markers = ["/storage/v1/object/public/", "/storage/v1/object/sign/"];
    const marker = markers.find((candidate) => parsedUrl.pathname.includes(candidate));
    if (!marker) return null;

    const objectReference = parsedUrl.pathname.split(marker)[1] || "";
    const [rawBucket, ...rawPathParts] = objectReference.split("/");
    if (!rawBucket || rawPathParts.length === 0) return null;

    return {
      bucket: decodeURIComponent(rawBucket),
      path: rawPathParts.map((part) => decodeURIComponent(part)).join("/"),
    };
  } catch (error) {
    console.error("Extra credit attachment URL parsing failed:", error);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }

  if (req.headers["x-admin-password"] !== adminPassword) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ success: false, error: "supabase_not_configured" });
  }

  const requestId = String(req.body?.request_id || "").trim();
  const status = String(req.body?.status || "").trim();
  if (!requestId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, error: "invalid_request" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: request, error: requestError } = await supabase
    .from("extra_credit_requests")
    .select("id,image_url,status")
    .eq("id", requestId)
    .eq("status", "pending")
    .maybeSingle();

  if (requestError) {
    console.error("Extra credit request lookup failed:", requestError);
    return res.status(500).json({ success: false, error: "request_lookup_failed" });
  }

  if (!request) {
    return res.status(409).json({ success: false, error: "request_already_reviewed" });
  }

  const storageObject = parseStorageObject(request.image_url);
  if (request.image_url && !storageObject) {
    console.error("Extra credit attachment URL is not a recognized Supabase Storage URL");
    return res.status(500).json({ success: false, error: "invalid_attachment_url" });
  }

  if (storageObject) {
    const { error: removeError } = await supabase.storage
      .from(storageObject.bucket)
      .remove([storageObject.path]);

    if (removeError) {
      console.error("Extra credit attachment deletion failed:", removeError);
      return res.status(500).json({ success: false, error: "attachment_delete_failed" });
    }
  }

  const { data, error } = await supabase.rpc("review_extra_credit_request", {
    p_request_id: requestId,
    p_status: status,
  });

  if (error) {
    console.error("Extra credit request review failed:", error);
    return res.status(500).json({ success: false, error: "review_failed" });
  }

  if (!data) {
    return res.status(409).json({ success: false, error: "request_already_reviewed" });
  }

  return res.status(200).json({ success: true });
}
