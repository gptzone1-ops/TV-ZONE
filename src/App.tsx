import {
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock3,
  Clipboard,
  Copy,
  Edit3,
  Eye,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  Link2,
  LogOut,
  KeyRound,
  LockKeyhole,
  Mail,
  MessageCircle,
  MonitorPlay,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
  Trash2,
  Tv,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  LEGACY_PROFILE_CODES,
  FORMER_PROFILE_CODES,
  PREVIOUS_PROFILE_CODES,
  PROFILE_CODES,
  accountTypeLabel,
  buildProfileSlots,
  generateShortId,
} from "./lib/profiles";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type {
  AccountType,
  CodeFetchMethod,
  CompensationDistribution,
  CompensationRequest,
  CustomerLink,
  ExtraCreditReason,
  ExtraCreditRequest,
  ExtraCreditRequestStatus,
  NetflixAccount,
  ServiceType,
} from "./types";

type Screen = "selector" | "netflix" | "account" | "credit-requests" | "compensations";
type DeviceView = "mobile" | "screen";
type Toast = { label: string; at: number; tone?: "success" | "error" } | null;
type StatTone = "neutral" | "green" | "red";
type AccountTypeFilter = "all" | AccountType;
type SupportIssue = "general" | "unavailable" | "expired";
type CustomerSearchResult = { link: CustomerLink; account: NetflixAccount };
type AccountFormResult = boolean | { ok: boolean; error?: string };
type AccountCreateForm = {
  email: string;
  password: string;
  account_type: AccountType;
  supplier_code_url?: string;
  code_fetch_method?: CodeFetchMethod;
  compensation_tutorial_url?: string;
  compensation_distribution?: CompensationDistribution;
};
type PublicCompensationRequest = Omit<CompensationRequest, "id">;
type CompensationPoolLink = {
  id: string;
  replacement_link: string;
  account_type: "private" | "shared" | null;
  status: "available" | "assigned";
  assigned_request_id: string | null;
  assigned_at: string | null;
  created_at: string;
};
type ServiceTheme = {
  type: ServiceType;
  name: string;
  title: string;
  accent: string;
  border: string;
  gradient: string;
  glow: string;
  soft: string;
  hoverBg: string;
};

const defaultCustomerVideoUrl = "https://www.youtube.com/embed/77PisEHo9_U?playsinline=1&rel=0&modestbranding=1";
const externalCodeCustomerVideoUrl = "https://www.youtube.com/embed/77PisEHo9_U?playsinline=1&rel=0&modestbranding=1";
const videoUrl = import.meta.env.VITE_CUSTOMER_VIDEO_URL || defaultCustomerVideoUrl;
const tvTutorialVideoUrl = import.meta.env.VITE_TV_TUTORIAL_VIDEO_URL || "https://www.youtube.com/embed/KYo3ZCyB3JY?playsinline=1&rel=0&modestbranding=1";
const defaultCompensationTutorialUrl = "https://www.youtube.com/embed/ga805aqXGH4?playsinline=1&rel=0&modestbranding=1";
const netflixServiceOutage = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_NETFLIX_SERVICE_OUTAGE ?? "true").trim().toLowerCase(),
);
const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";
const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || "admin@zonestore.sa";
const adminAuthKey = "zone-admin-auth";
const adminAuthValue = `remembered:${adminPassword}`;
const whatsappNumber = "966581688656";
const extraCreditStorageBucket = "extra_credit_requests";
const disclaimerStorageKey = "disclaimer_accepted";
const dayMs = 1000 * 60 * 60 * 24;
const verificationCodeLifetimeMs = 120 * 1000;
const verificationCodeFallbackWindowMs = 15 * 60 * 1000;
const tvApprovalFallbackWindowMs = 15 * 60 * 1000;
const tvApprovalSearchDurationMs = 15 * 1000;
const externalCodeAccessDurationMs = 30 * 60 * 1000;
const adminAccountsPageSize = 10;
const extraCreditReasons: ExtraCreditReason[] = [
  "كود خاطئ",
  "استبدال الجهاز أو الدخول بجهاز آخر",
  "عدم تطبيق الخطوات وذهاب الكود",
  "أخرى",
];
const duplicateEmailMessage = "عفواً، هذا البريد الإلكتروني مسجل مسبقاً ولا يمكن تكراره";
const duplicateEmailSaveMessage = duplicateEmailMessage;
const duplicateProfileMessage = (profileName: string) => `هذا الملف (${profileName}) مسجل مسبقاً لهذا الحساب`;
const emptyEmailMessage = "أدخل البريد الإلكتروني أولاً";
const customerAccountPublicSelect = "*,accounts(id,email,use_automated_code,code_fetch_method,compensation_tutorial_url,verification_code,verification_code_received_at,service_type,account_type,compensation_distribution,expires_at,created_at,email_provider,imap_enabled,normal_client_layout,hide_password_from_client)";
const legacyCustomerAccountSelect = "*,accounts(id,email,password,use_automated_code,supplier_code_url,compensation_tutorial_url,verification_code,verification_code_received_at,service_type,account_type,compensation_distribution,expires_at,created_at,email_provider,imap_enabled,normal_client_layout)";

const serviceThemes: Record<ServiceType, ServiceTheme> = {
  netflix: {
    type: "netflix",
    name: "نتفلكس",
    title: "إدارة نتفلكس",
    accent: "text-netflix",
    border: "border-red-100",
    gradient: "from-netflix to-red-700",
    glow: "shadow-red",
    soft: "bg-red-50 text-netflix",
    hoverBg: "hover:bg-netflix",
  },
  shahid: {
    type: "shahid",
    name: "شاهد",
    title: "إدارة شاهد",
    accent: "text-cyan-600",
    border: "border-cyan-100",
    gradient: "from-emerald-500 to-cyan-500",
    glow: "shadow-shahid",
    soft: "bg-cyan-50 text-cyan-600",
    hoverBg: "hover:bg-cyan-500",
  },
  osn: {
    type: "osn",
    name: "OSN",
    title: "إدارة OSN",
    accent: "text-fuchsia-700",
    border: "border-fuchsia-100",
    gradient: "from-fuchsia-700 to-amber-500",
    glow: "shadow-[0_16px_36px_rgba(162,28,175,0.22)]",
    soft: "bg-fuchsia-50 text-fuchsia-700",
    hoverBg: "hover:bg-fuchsia-700",
  },
};

function serviceOf(account?: NetflixAccount | null): ServiceType {
  if (account?.service_type === "shahid") return "shahid";
  if (account?.service_type === "osn") return "osn";
  return "netflix";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function defaultExpiryDate() {
  return addDays(new Date(), 30).toISOString().slice(0, 10);
}

function daysRemaining(expiresAt: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiresAt);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / dayMs);
}

function isExpired(expiresAt: string) {
  return daysRemaining(expiresAt) <= 0;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function hydrateCustomerLinkPassword(rawData: unknown) {
  const customerLink = rawData as CustomerLink;
  const account = customerLink?.accounts;
  if (!account) return customerLink;

  const needsCompensationUrl = account.account_type === "compensation";
  const needsExternalCodeUrl = account.code_fetch_method === "external_link";
  const needsPassword = account.hide_password_from_client !== true;
  if (!needsPassword && !needsCompensationUrl && !needsExternalCodeUrl) {
    return { ...customerLink, accounts: { ...account, password: "" } } as CustomerLink;
  }

  if (!supabase) return customerLink;
  const { data, error } = await supabase
    .from("accounts")
    .select("password,supplier_code_url")
    .eq("id", account.id)
    .maybeSingle();
  if (error) {
    console.error("Supabase legacy account password loading error:", error);
    return { ...customerLink, accounts: { ...account, password: "" } } as CustomerLink;
  }

  return {
    ...customerLink,
    accounts: {
      ...account,
      password: needsPassword ? String(data?.password || "") : "",
      supplier_code_url: needsCompensationUrl || needsExternalCodeUrl ? String(data?.supplier_code_url || "") : null,
    },
  } as CustomerLink;
}

async function loadCustomerLinkRecord(column: "short_id" | "uuid" | "id", value: string) {
  if (!supabase) return null;

  const primaryResult = await supabase
    .from("customer_links")
    .select(customerAccountPublicSelect)
    .eq(column, value)
    .maybeSingle();
  if (!primaryResult.error && primaryResult.data) {
    return hydrateCustomerLinkPassword(primaryResult.data);
  }

  const missingNewPublicColumn = ["hide_password_from_client", "code_fetch_method"].some((column) =>
    String(primaryResult.error?.message || "").includes(column),
  );
  if (!missingNewPublicColumn) {
    if (primaryResult.error) console.error("Supabase customer link loading error:", primaryResult.error);
    return null;
  }

  console.warn("Password visibility migration is not applied yet; using the legacy customer query.");
  const legacyResult = await supabase
    .from("customer_links")
    .select(legacyCustomerAccountSelect)
    .eq(column, value)
    .maybeSingle();
  if (legacyResult.error) {
    console.error("Supabase legacy customer link loading error:", legacyResult.error);
    return null;
  }
  return (legacyResult.data || null) as unknown as CustomerLink | null;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function youtubeVideoId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
    const segments = url.pathname.split("/").filter(Boolean);
    const embeddedIndex = segments.findIndex((segment) => segment === "embed" || segment === "shorts");
    if (embeddedIndex >= 0) return segments[embeddedIndex + 1] || null;
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

function tutorialThumbnailUrl(value: string) {
  const videoId = youtubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

function autoplayVideoUrl(value: string) {
  try {
    const url = new URL(value);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("playsinline", "1");
    return url.toString();
  } catch {
    return value;
  }
}

function getTutorialMedia(value: string | null | undefined) {
  const rawValue = String(value || "").trim();
  if (!rawValue || !isValidHttpUrl(rawValue)) return null;

  try {
    const url = new URL(rawValue);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    let youtubeId = "";

    if (hostname === "youtu.be") {
      youtubeId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts") youtubeId = parts[1] || "";
      if (url.pathname === "/watch") youtubeId = url.searchParams.get("v") || "";
    }

    if (youtubeId && /^[A-Za-z0-9_-]{6,}$/.test(youtubeId)) {
      return {
        kind: "embed" as const,
        src: `https://www.youtube.com/embed/${youtubeId}?playsinline=1&rel=0&modestbranding=1`,
      };
    }

    if (/\.(mp4|webm|ogg|mov)(?:$|[?#])/i.test(rawValue)) {
      return { kind: "video" as const, src: rawValue };
    }

    return { kind: "embed" as const, src: rawValue };
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncEmailInLinkedUrl(url: string | null | undefined, previousEmail: string, nextEmail: string) {
  const trimmedUrl = String(url || "").trim();
  const normalizedPreviousEmail = normalizeEmail(previousEmail);
  const normalizedNextEmail = normalizeEmail(nextEmail);

  if (!trimmedUrl || !normalizedPreviousEmail || normalizedPreviousEmail === normalizedNextEmail) {
    return trimmedUrl || null;
  }

  const replaceIgnoringCase = (value: string, search: string, replacement: string) =>
    value.replace(new RegExp(escapeRegExp(search), "gi"), replacement);

  const withPlainEmail = replaceIgnoringCase(trimmedUrl, normalizedPreviousEmail, normalizedNextEmail);
  return replaceIgnoringCase(
    withPlainEmail,
    encodeURIComponent(normalizedPreviousEmail),
    encodeURIComponent(normalizedNextEmail),
  );
}

function processExtraCreditRequestInBackground(requestId: string) {
  void fetch("/api/notify-extra-credit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
    keepalive: true,
  })
    .then(async (response) => {
      if (response.ok) return;
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(result?.error || `extra_credit_ai_processing_failed_${response.status}`);
    })
    .catch((error) => {
      console.error("Extra credit AI processing failed:", error);
    });
}

function buildSupportWhatsAppUrl({
  issue,
  email,
  customerCode,
  deviceType,
}: {
  issue: SupportIssue;
  email: string;
  customerCode: string;
  deviceType: DeviceView;
}) {
  const deviceName = deviceType === "screen" ? "شاشة / سوني" : "جوال / آيباد / بي سي / لابتوب";
  void issue;
  const message = `مرحباً، أواجه مشكلة/استفسار في الحساب:
- البريد الإلكتروني: ${email}
- رقم العميل (ID/Code): ${customerCode}
- نوع الجهاز: ${deviceName}
- نوع المشكلة: استنفاذ المحاولات`;

  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function isDuplicateEmailError(error: unknown) {
  const supabaseError = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""}`.toLowerCase();
  return (
    supabaseError?.code === "23505" &&
    (message.includes("email") || message.includes("accounts_email"))
  );
}

function formatDatabaseError(error: unknown) {
  const databaseError = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null;
  const parts = [databaseError?.message, databaseError?.details, databaseError?.hint]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const uniqueParts = Array.from(new Set(parts));
  const errorCode = String(databaseError?.code || "").trim();
  return `${uniqueParts.join(" - ") || "خطأ غير معروف من قاعدة البيانات"}${errorCode ? ` (${errorCode})` : ""}`;
}

function isCustomerLinksEmailConstraintError(error: unknown) {
  const supabaseError = error as { message?: string; details?: string } | null;
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""}`.toLowerCase();
  return message.includes("unique_customer_email") || message.includes("customer_links_email");
}

function isShortIdConflictError(error: unknown) {
  const supabaseError = error as { code?: string; message?: string; details?: string } | null;
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""}`.toLowerCase();
  return (
    supabaseError?.code === "23505" &&
    (message.includes("short_id") || message.includes("customer_links_short_id"))
  );
}

function accountFormSucceeded(result: AccountFormResult) {
  return typeof result === "boolean" ? result : result.ok;
}

function accountFormError(result: AccountFormResult) {
  return typeof result === "boolean" ? undefined : result.error;
}

function remainingLabel(expiresAt: string) {
  const remaining = daysRemaining(expiresAt);
  if (remaining <= 0) return "منتهي";
  if (remaining === 1) return "متبقي يوم واحد";
  if (remaining === 2) return "متبقي يومان";
  if (remaining <= 10) return `متبقي ${remaining} أيام`;
  return `متبقي ${remaining} يوم`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(date));
}

function formatDateTime(date?: string | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function getBaseUrl() {
  return window.location.origin;
}

function getCustomerUrl(link: CustomerLink) {
  return link.short_id ? `${getBaseUrl()}/v/${link.short_id}` : `${getBaseUrl()}/view/${link.uuid}`;
}

function getTemporaryAccountUrl(account: NetflixAccount) {
  return account.temporary_short_id ? `${getBaseUrl()}/t/${account.temporary_short_id}` : "";
}

function getProfilePin(link: CustomerLink) {
  const storedPin = `${link.profile_code ?? ""}`.trim();
  if (STORED_PROFILE_PINS.has(storedPin)) return storedPin;

  const profileKey = `${link.profile_label || link.profile_name || ""}`.toUpperCase().match(/[A-E]/)?.[0];
  return profileKey ? LEGACY_PROFILE_CODES[profileKey] : "";
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyText(text: string, setToast: (toast: Toast) => void) {
  await writeClipboardText(text);
  setToast({ label: "تم النسخ بنجاح", at: Date.now() });
}

async function copyTextSilent(text: string) {
  await writeClipboardText(text);
}

type VerificationCodeResult = {
  messageId: string | null;
  code: string | null;
  receivedAt: string | null;
  error: unknown;
};

type TvApprovalSnapshot = {
  messageId: string | null;
  url: string;
  receivedAt: string | null;
  receivedAtMs: number;
};

type VerificationMessageRow = {
  id?: string | null;
  code?: string | null;
  tv_approval_url?: string | null;
  received_at?: string | null;
  is_used?: boolean | null;
};

const STORED_PROFILE_PINS = new Set([
  ...Object.values(PREVIOUS_PROFILE_CODES),
  ...Object.values(FORMER_PROFILE_CODES),
  ...Object.values(PROFILE_CODES),
]);

async function readLatestVerificationCode(
  accountId: string,
  customerLinkId?: string,
  onlyUnused = false,
): Promise<VerificationCodeResult> {
  if (!supabase) {
    return { messageId: null, code: null, receivedAt: null, error: null };
  }

  if (customerLinkId && onlyUnused) {
    const recentMessageCutoff = new Date(Date.now() - verificationCodeFallbackWindowMs).toISOString();
    const { data, error } = await supabase.rpc("get_latest_customer_message", {
      p_customer_link_id: customerLinkId,
      p_message_type: "code",
      p_since: recentMessageCutoff,
    });

    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as VerificationMessageRow | null;
      if (row?.id && row.code) {
        return {
          messageId: row.id,
          code: row.code,
          receivedAt: row.received_at || null,
          error: null,
        };
      }

      return { messageId: null, code: null, receivedAt: null, error: null };
    }

    console.error("Supabase verification message RPC error:", error);
    return { messageId: null, code: null, receivedAt: null, error };
  }

  const [accountResult, linkResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("verification_code,verification_code_received_at")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("customer_links")
      .select("verification_code,verification_code_received_at")
      .eq("account_id", accountId)
      .not("verification_code", "is", null)
      .order("verification_code_received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (accountResult.error) {
    console.error("Supabase verification code read error:", accountResult.error);
  }
  if (linkResult.error) {
    console.error("Supabase customer link code fallback error:", linkResult.error);
  }

  const candidates = [accountResult.data, linkResult.data]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate?.verification_code))
    .sort((first, second) => {
      const firstTime = first.verification_code_received_at
        ? new Date(first.verification_code_received_at).getTime()
        : 0;
      const secondTime = second.verification_code_received_at
        ? new Date(second.verification_code_received_at).getTime()
        : 0;
      return secondTime - firstTime;
    });

  const latest = candidates[0];
  if (latest?.verification_code) {
    return {
      messageId: null,
      code: latest.verification_code,
      receivedAt: latest.verification_code_received_at || null,
      error: null,
    };
  }

  return {
    messageId: null,
    code: null,
    receivedAt: null,
    error: accountResult.error || linkResult.error || null,
  };
}

async function consumeVerificationMessage(messageId: string, customerLinkId: string, usedAt: string) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("consume_customer_message", {
    p_message_id: messageId,
    p_customer_link_id: customerLinkId,
    p_used_at: usedAt,
  });

  if (error) {
    console.error("Supabase verification message consumption error:", error);
    throw error;
  }

  return (Array.isArray(data) ? data[0] : data) as
    | (VerificationMessageRow & { message_id?: string; message_type?: string })
    | null;
}

const demoAccount: NetflixAccount = {
  id: "demo-account",
  email: "zone.netflix@example.com",
  password: "Zone@2026",
  use_automated_code: true,
  service_type: "netflix",
  account_type: "private",
  expires_at: defaultExpiryDate(),
  created_at: new Date().toISOString(),
};

const demoLinks: CustomerLink[] = buildProfileSlots("private").map((slot, index) => ({
  id: `demo-link-${index}`,
  account_id: demoAccount.id,
  created_at: new Date().toISOString(),
  ...slot,
}));

export default function App() {
  const [route, setRoute] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shortMatch = route.match(/^\/v\/([^/]+)$/);
  const viewMatch = route.match(/^\/view\/([^/]+)$/);
  const temporaryMatch = route.match(/^\/t\/([^/]+)$/);
  if (shortMatch) return <CustomerView identifier={shortMatch[1]} lookup="short" navigate={navigate} />;
  if (viewMatch) return <CustomerView identifier={viewMatch[1]} lookup="uuid" navigate={navigate} />;
  if (temporaryMatch) return <TemporaryAccountView identifier={temporaryMatch[1]} />;
  if (route === "/compensation" || route === "/compensation/") return <CompensationPage />;
  return <AdminApp navigate={navigate} />;
}

function TemporaryAccountView({ identifier }: { identifier: string }) {
  const [account, setAccount] = useState<{ email: string; password: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"email" | "password" | null>(null);

  useEffect(() => {
    let active = true;
    async function loadTemporaryAccount() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/temporary-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: identifier }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success || !payload?.account) {
          throw new Error(payload?.error || "temporary_account_not_found");
        }
        if (active) setAccount(payload.account);
      } catch (loadError) {
        console.error("Temporary account page load failed:", loadError);
        if (active) setError("الرابط غير صحيح أو لم يعد متاحاً");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadTemporaryAccount();
    return () => {
      active = false;
    };
  }, [identifier]);

  async function copyValue(value: string, field: "email" | "password") {
    try {
      await writeClipboardText(value);
      setCopied(field);
      window.setTimeout(() => setCopied(null), 1800);
    } catch (copyError) {
      console.error("Temporary account copy failed:", copyError);
    }
  }

  return (
    <main
      className="min-h-screen bg-[linear-gradient(180deg,#F3F4F6_0%,#FFFFFF_70%)] px-4 py-6 font-cairo text-zinc-950 sm:py-10"
      dir="rtl"
    >
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center justify-between rounded-3xl border border-red-100 bg-white px-5 py-4 shadow-[0_18px_55px_rgba(40,20,25,0.10)] sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-netflix text-xl font-black text-white shadow-red">
              زون
            </div>
            <div>
              <p className="text-xs font-black text-netflix">ZONE STORE</p>
              <h1 className="text-xl font-black sm:text-2xl">حساب نتفليكس المؤقت</h1>
            </div>
          </div>
          <LockKeyhole className="h-6 w-6 text-netflix" />
        </header>

        <section className="overflow-hidden rounded-3xl border border-red-100 bg-white p-5 shadow-[0_24px_70px_rgba(40,20,25,0.12)] sm:p-8">
          {loading && (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-netflix" />
              <p className="text-sm font-black text-zinc-600">جاري تحميل بيانات الحساب...</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <CircleX className="h-12 w-12 text-netflix" />
              <p className="text-base font-black text-zinc-700">{error}</p>
            </div>
          )}

          {!loading && account && (
            <div className="animate-rise">
              <div className="mb-7 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-netflix">
                  <KeyRound className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-2xl font-black sm:text-3xl">بيانات تسجيل الدخول</h2>
                <p className="mt-2 text-sm font-bold text-zinc-500">انسخ البيانات التالية واستخدمها داخل تطبيق نتفليكس.</p>
              </div>

              <div className="space-y-4">
                {[
                  { field: "email" as const, label: "البريد الإلكتروني", value: account.email, icon: Mail },
                  { field: "password" as const, label: "كلمة المرور", value: account.password, icon: KeyRound },
                ].map((item) => (
                  <div key={item.field} className="rounded-2xl border border-zinc-200 bg-[#FAFAFA] p-4 sm:p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-netflix">
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <p className="min-w-0 flex-1 break-all text-left text-base font-black text-zinc-950 sm:text-lg" dir="ltr">
                        {item.value}
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyValue(item.value, item.field)}
                        className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-netflix px-4 text-sm font-black text-white transition hover:bg-red-700"
                      >
                        {copied === item.field ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied === item.field ? "تم النسخ" : "نسخ"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-red-100 bg-red-50/70 p-5">
                <div className="mb-3 flex items-center gap-2 text-netflix">
                  <MonitorPlay className="h-5 w-5" />
                  <h3 className="text-lg font-black">شرح طريقة الدخول</h3>
                </div>
                <p className="text-sm font-bold leading-8 text-zinc-800 sm:text-base">
                  ضع الإيميل في نتفليكس ثم اضغط الحصول على مساعدة واختار المتابعة بكلمة مرور وحط كلمة المرور الموجودة عندك
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CompensationPage() {
  const storageKey = "zone-compensation-client-code";
  const [clientCode, setClientCode] = useState(() => localStorage.getItem(storageKey) || "");
  const [request, setRequest] = useState<PublicCompensationRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function checkCompensation(rawCode: string) {
    const normalizedCode = rawCode.replace(/\s+/g, "").toUpperCase();
    setClientCode(normalizedCode);
    setError("");

    if (!/^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(normalizedCode)) {
      setError("رمز التعويض غير صحيح، يرجى نسخه من صفحة بيانات اشتراكك والمحاولة مجدداً.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/compensation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_code: normalizedCode }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success || !payload?.request) {
        if (payload?.error === "invalid_client_code") {
          setError("رمز التعويض غير صحيح، يرجى نسخه من صفحة بيانات اشتراكك والمحاولة مجدداً.");
          localStorage.removeItem(storageKey);
        } else {
          setError("تعذر التحقق من الطلب حالياً، يرجى المحاولة مرة أخرى بعد قليل.");
        }
        return;
      }

      localStorage.setItem(storageKey, normalizedCode);
      setRequest(payload.request as PublicCompensationRequest);
    } catch (lookupError) {
      console.error("Compensation lookup failed:", lookupError);
      setError("تعذر الاتصال بالخادم، يرجى التحقق من الإنترنت والمحاولة مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const storedCode = localStorage.getItem(storageKey);
    if (storedCode) void checkCompensation(storedCode);
  }, []);

  async function copyReplacementLink() {
    if (!request?.replacement_link) return;
    try {
      await copyTextSilent(request.replacement_link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      console.error("Replacement link copy failed:", copyError);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#F7F3FF] via-[#FAFAFC] to-white px-4 py-8 text-[#17141F]" dir="rtl">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 flex items-center justify-between rounded-3xl border border-white bg-white px-5 py-4 shadow-[0_18px_55px_rgba(70,40,120,0.12)]">
          <div>
            <p className="text-xs font-black text-[#8B35F5]">Zone Store</p>
            <h1 className="mt-1 text-xl font-black">نظام التعويضات</h1>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#8B35F5] text-lg font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.28)]">زون</div>
        </header>

        <section className="overflow-hidden rounded-[2rem] border border-[#E7D9FC] bg-white shadow-[0_24px_70px_rgba(70,40,120,0.14)]">
          <div className="border-b border-[#EEE7F8] bg-[#FCFAFF] p-6 text-center md:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1E7FF] text-[#8B35F5]">
              <RefreshCw className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-2xl font-black">طلب ومتابعة التعويض</h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-7 text-zinc-500">
              أدخل رمز التعويض المكون من 6 خانات لتقديم طلبك ومتابعة حالته حتى استلام رابط الحساب الجديد.
            </p>
          </div>

          <div className="p-5 md:p-8">
            {!request && (
              <div className="mb-5 rounded-2xl border border-[#DCCBFA] bg-[#F8F4FF] p-4 text-right md:p-5">
                <h3 className="flex items-center gap-2 text-base font-black text-[#6E25CF]">
                  <KeyRound className="h-5 w-5" />
                  كيف تحصل على رمز التعويض؟
                </h3>
                <ol className="mt-3 space-y-3 text-sm font-bold leading-7 text-zinc-700">
                  <li className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8B35F5] text-xs font-black text-white">1</span>
                    <span>افتح رابط بيانات الاشتراك الذي استلمته من المتجر.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8B35F5] text-xs font-black text-white">2</span>
                    <span>ستجد بطاقة واضحة باسم «رمز التعويض الخاص بك» أعلى الصفحة وتحت البريد الإلكتروني. اضغط زر «نسخ الرمز».</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8B35F5] text-xs font-black text-white">3</span>
                    <span>الصق الرمز في الحقل أدناه واضغط «إرسال / متابعة» لتقديم الطلب أو معرفة حالته.</span>
                  </li>
                </ol>
                <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-black leading-6 text-emerald-800">
                  عند اكتمال التعويض سيظهر لك رابط الحساب الجديد في هذه الصفحة مع زر لنسخه وفتحه مباشرة.
                </p>
              </div>
            )}
            {!request ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void checkCompensation(clientCode);
                }}
                className="space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-black">رمز التعويض</span>
                  <input
                    autoFocus
                    maxLength={6}
                    value={clientCode}
                    onChange={(event) => {
                      setClientCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase());
                      setError("");
                    }}
                    placeholder="A2C4X9"
                    dir="ltr"
                    className="h-14 w-full rounded-2xl border-2 border-[#DCCBFA] bg-[#FCFAFF] px-4 text-center text-xl font-black uppercase tracking-[0.18em] outline-none transition focus:border-[#8B35F5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(139,53,245,0.10)]"
                  />
                </label>
                {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black leading-6 text-rose-700">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || clientCode.length !== 6}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] px-5 text-base font-black text-white shadow-[0_14px_30px_rgba(139,53,245,0.28)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5 rotate-180" />}
                  {loading ? "جاري التحقق..." : "إرسال / متابعة"}
                </button>
              </form>
            ) : request.status === "pending" ? (
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Clock3 className="h-8 w-8" />
                </div>
                <h2 className="mt-4 text-xl font-black">طلبك قيد المراجعة</h2>
                <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-8 text-amber-900">
                  تم استلام طلبك، سيتم التعويض وتوفير الرابط خلال مدة تتراوح من ساعة إلى 24 ساعة كحد أقصى.
                </p>
                <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[#FFF8E7] px-4 py-3 text-sm font-black text-amber-800">
                  <Clock3 className="h-4 w-4" />
                  مدة الانتظار المتوقعة: من ساعة إلى 24 ساعة
                </div>
                <div className="mt-4">
                  <CompensationCodeCard code={request.client_code} compact />
                </div>
                <button
                  type="button"
                  onClick={() => void checkCompensation(request.client_code)}
                  disabled={loading}
                  className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-[#F8F4FF] text-sm font-black text-[#7C2CE8] transition hover:bg-[#F1E7FF] disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  تحديث حالة الطلب
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                  <CircleCheck className="h-8 w-8" />
                </div>
                <h2 className="mt-4 text-2xl font-black text-emerald-700">تم التعويض بنجاح!</h2>
                <p className="mt-2 text-sm font-bold text-zinc-600">تفضل رابط حسابك الجديد:</p>
                <div className="mt-4 text-right">
                  <CompensationCodeCard code={request.client_code} compact />
                </div>
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="break-all text-sm font-black leading-7 text-emerald-900" dir="ltr">{request.replacement_link}</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void copyReplacementLink()}
                    className="flex h-13 items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-white text-sm font-black text-[#7C2CE8] transition hover:bg-[#F8F4FF]"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? "تم نسخ الرابط" : "نسخ الرابط"}
                  </button>
                  <a
                    href={request.replacement_link || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-13 items-center justify-center gap-2 rounded-xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_12px_26px_rgba(139,53,245,0.22)] transition hover:bg-[#7626DD]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    فتح الرابط الجديد
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function AdminApp({ navigate }: { navigate: (path: string) => void }) {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem(adminAuthKey) === adminAuthValue);
  const [screen, setScreen] = useState<Screen>(() => (localStorage.getItem("zone-admin-screen") as Screen) || "selector");
  const [selectedService, setSelectedService] = useState<ServiceType>(() => {
    const storedService = localStorage.getItem("zone-selected-service");
    return storedService === "shahid" || storedService === "osn" ? storedService : "netflix";
  });
  const [accounts, setAccounts] = useState<NetflixAccount[]>([]);
  const [links, setLinks] = useState<CustomerLink[]>([]);
  const [extraCreditRequests, setExtraCreditRequests] = useState<ExtraCreditRequest[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!authenticated) return;
    void loadData();
  }, [authenticated, currentPage, selectedService, debouncedQuery]);

  useEffect(() => {
    localStorage.setItem("zone-admin-screen", screen);
  }, [screen]);

  useEffect(() => {
    localStorage.setItem("zone-selected-service", selectedService);
  }, [selectedService]);

  useEffect(() => {
    if (screen === "account" && selectedAccountId && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(null);
      setScreen("netflix");
    }
  }, [accounts, screen, selectedAccountId]);

  useEffect(() => {
    if (!authenticated) return;
    if (!supabase) return;
    const client = supabase;

    const channel = client
      .channel("zone-store-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_links" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "extra_credit_requests" }, () => void loadData())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [authenticated, currentPage, selectedService, debouncedQuery]);

  async function loadData() {
    const requestId = ++loadRequestIdRef.current;
    if (!supabase) {
      setAccounts([demoAccount]);
      setLinks(demoLinks);
      setExtraCreditRequests([]);
      setTotalAccounts(1);
      return;
    }

    setLoading(true);
    const from = (currentPage - 1) * adminAccountsPageSize;
    const to = currentPage * adminAccountsPageSize - 1;
    const rawSearchTerm = debouncedQuery.replace(/^#/, "").trim();
    const searchTerm = rawSearchTerm.replace(/[,()*]/g, " ").trim();
    const matchingAccountIds = new Set<string>();

    if (searchTerm) {
      const linkSearches = [
        supabase
          .from("customer_links")
          .select("account_id")
          .ilike("short_id", `%${searchTerm}%`),
      ];

      if (/^\d+$/.test(searchTerm)) {
        linkSearches.push(
          supabase
            .from("customer_links")
            .select("account_id")
            .eq("link_number", Number(searchTerm)),
        );
      }

      const linkSearchResults = await Promise.all(linkSearches);
      linkSearchResults.forEach(({ data, error }) => {
        if (error) {
          console.error("Supabase customer number/code search error:", error);
          return;
        }
        (data || []).forEach((item) => matchingAccountIds.add(item.account_id));
      });
    }

    let accountsQuery = supabase
      .from("accounts")
      .select("*", { count: "exact" });

    accountsQuery = selectedService === "netflix"
      ? accountsQuery.or("service_type.eq.netflix,service_type.is.null")
      : accountsQuery.eq("service_type", selectedService);

    if (searchTerm) {
      const accountIds = Array.from(matchingAccountIds);
      accountsQuery = accountIds.length
        ? accountsQuery.or(`email.ilike.%${searchTerm}%,id.in.(${accountIds.join(",")})`)
        : accountsQuery.ilike("email", `%${searchTerm}%`);
    }

    const [
      { data: accountsData, error: accountsError, count: accountsCount },
      { data: creditRequestsData, error: creditRequestsError },
    ] = await Promise.all([
      accountsQuery
        .order("created_at", { ascending: false })
        .range(from, to),
      supabase
        .from("extra_credit_requests")
        .select("*,customer_links(*,accounts(*))")
        .order("created_at", { ascending: false }),
    ]);

    const pageAccountIds = (accountsData || []).map((account) => account.id);
    const { data: linksData, error: linksError } = pageAccountIds.length
      ? await supabase
          .from("customer_links")
          .select("*")
          .in("account_id", pageAccountIds)
          .order("account_id", { ascending: true })
          .order("profile_name", { ascending: true })
      : { data: [] as CustomerLink[], error: null };

    // Realtime events can start overlapping loads. Only the newest response may
    // replace the dashboard state, so an older request cannot restore a partial view.
    if (requestId !== loadRequestIdRef.current) return;

    if (accountsError || linksError) {
      setToast({ label: "تعذر تحميل بيانات Supabase", at: Date.now() });
    } else {
      setAccounts((accountsData || []) as NetflixAccount[]);
      setLinks((linksData || []) as CustomerLink[]);
      setTotalAccounts(accountsCount || 0);
      if ((accountsCount || 0) > 0 && !(accountsData || []).length && currentPage > 1) {
        setCurrentPage((page) => Math.max(1, page - 1));
      }
    }
    if (creditRequestsError) {
      console.error("Supabase extra credit requests load error:", creditRequestsError);
      setExtraCreditRequests([]);
    } else {
      setExtraCreditRequests((creditRequestsData || []) as unknown as ExtraCreditRequest[]);
    }
    setLoading(false);
  }

  async function emailAlreadyExists(email: string, exceptAccountId?: string, serviceScope?: ServiceType) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    if (
      accounts.some(
        (account) =>
          account.id !== exceptAccountId &&
          normalizeEmail(account.email) === normalized &&
          (!serviceScope || serviceOf(account) === serviceScope),
      ) ||
      links.some(
        (link) =>
          link.account_id !== exceptAccountId &&
          normalizeEmail(link.email || "") === normalized &&
          (!serviceScope || link.service_type === serviceScope),
      )
    ) {
      return true;
    }

    if (!supabase) return false;

    let customerLinksQuery = supabase
      .from("customer_links")
      .select("id,account_id")
      .eq("email", normalized);
    let accountsQuery = supabase
      .from("accounts")
      .select("id")
      .eq("email", normalized);
    if (serviceScope) {
      customerLinksQuery = customerLinksQuery.eq("service_type", serviceScope);
      accountsQuery = accountsQuery.eq("service_type", serviceScope);
    }

    const [{ data, error }, { data: accountRows, error: accountError }] = await Promise.all([
      customerLinksQuery,
      accountsQuery,
    ]);

    if (error || accountError) {
      console.error("Supabase duplicate email validation error:", error || accountError);
      throw new Error("duplicate_email_lookup_failed");
    }

    const existing = (data || []).filter((link) => link.account_id !== exceptAccountId);
    const existingAccounts = (accountRows || []).filter((account) => account.id !== exceptAccountId);
    return existing.length > 0 || existingAccounts.length > 0;
  }

  async function duplicateProfileForEmail(
    email: string,
    profileNames: string[],
    exceptAccountId?: string,
    serviceScope?: ServiceType,
  ) {
    const normalized = normalizeEmail(email);
    const uniqueProfiles = Array.from(new Set(profileNames.filter(Boolean)));
    if (!normalized || !uniqueProfiles.length) return null;

    const localDuplicate = links.find(
      (link) =>
        link.account_id !== exceptAccountId &&
        normalizeEmail(link.email || "") === normalized &&
        (!serviceScope || link.service_type === serviceScope) &&
        uniqueProfiles.includes(link.profile_name),
    );
    if (localDuplicate) return localDuplicate.profile_name;

    if (!supabase) return null;

    let duplicateQuery = supabase
      .from("customer_links")
      .select("id,account_id,profile_name")
      .eq("email", normalized)
      .in("profile_name", uniqueProfiles);
    if (serviceScope) duplicateQuery = duplicateQuery.eq("service_type", serviceScope);
    const { data, error } = await duplicateQuery;

    if (error) {
      console.error("Supabase duplicate profile validation error:", error);
      throw new Error("duplicate_profile_lookup_failed");
    }

    const existing = (data || []).filter((link) => link.account_id !== exceptAccountId);
    return existing.length > 0 ? existing[0].profile_name : null;
  }

  async function validateAccountEmailAndProfiles(
    email: string,
    accountType: AccountType,
    profileNames: string[],
    exceptAccountId?: string,
    serviceScope?: ServiceType,
  ): Promise<AccountFormResult> {
    if (accountType === "private" || accountType === "temporary" || accountType === "compensation") {
      if (await emailAlreadyExists(email, exceptAccountId, serviceScope)) {
        return { ok: false, error: duplicateEmailMessage };
      }
      return true;
    }

    const duplicateProfile = await duplicateProfileForEmail(email, profileNames, exceptAccountId, serviceScope);
    if (duplicateProfile) {
      return { ok: false, error: duplicateProfileMessage(duplicateProfile) };
    }
    return true;
  }

  async function createUniqueShortIds(count: number) {
    const reserved = new Set(
      links
        .map((link) => String(link.short_id || "").trim())
        .filter(Boolean),
    );
    const generated: string[] = [];

    while (generated.length < count) {
      const candidates = new Set<string>();
      const required = count - generated.length;

      while (candidates.size < Math.max(required * 2, 8)) {
        const candidate = generateShortId();
        if (!reserved.has(candidate)) candidates.add(candidate);
      }

      let existing = new Set<string>();
      if (supabase) {
        const candidateList = Array.from(candidates);
        const { data, error } = await supabase
          .from("customer_links")
          .select("short_id")
          .in("short_id", candidateList);

        if (error) {
          console.error("Supabase short ID uniqueness check error:", error);
          throw new Error("short_id_lookup_failed");
        }

        existing = new Set(
          (data || [])
            .map((item) => String(item.short_id || "").trim())
            .filter(Boolean),
        );
      }

      for (const candidate of candidates) {
        if (existing.has(candidate) || reserved.has(candidate)) continue;
        reserved.add(candidate);
        generated.push(candidate);
        if (generated.length === count) break;
      }
    }

    return generated;
  }

  async function createUniqueTemporaryId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateShortId(7);
      const localMatch = accounts.some((account) => account.temporary_short_id === candidate);
      if (localMatch) continue;
      if (!supabase) return candidate;

      const { data, error } = await supabase
        .from("accounts")
        .select("id")
        .eq("temporary_short_id", candidate)
        .limit(1);
      if (error) {
        console.error("Supabase temporary ID uniqueness check error:", error);
        throw new Error("temporary_id_lookup_failed");
      }
      if (!data?.length) return candidate;
    }
    throw new Error("temporary_id_generation_failed");
  }

  async function addAccount(form: AccountCreateForm): Promise<AccountFormResult> {
    const allowedNewAccountTypes: AccountType[] = ["private", "shared"];
    if (!allowedNewAccountTypes.includes(form.account_type)) {
      const error = "إنشاء الحسابات الجديدة متاح للنوع الخاص أو المشترك فقط.";
      setToast({ label: error, at: Date.now(), tone: "error" });
      return { ok: false, error };
    }

    const expires_at = defaultExpiryDate();
    let slots = buildProfileSlots(form.account_type, selectedService, form.compensation_distribution);
    const normalizedEmail = normalizeEmail(form.email);
    let temporaryShortId: string | null = null;
    const hidePasswordFromClient = selectedService === "netflix" && (form.account_type === "private" || form.account_type === "shared");
    const codeFetchMethod: CodeFetchMethod | null = selectedService === "netflix" && (form.account_type === "private" || form.account_type === "shared")
      ? form.code_fetch_method || "auto_fetch"
      : null;
    const expectedNewLinks = selectedService === "netflix" && form.account_type === "private"
      ? 5
      : selectedService === "netflix" && form.account_type === "shared"
        ? 10
        : null;
    const expectedCreatedLinks = expectedNewLinks ?? (
      selectedService === "osn"
        ? form.account_type === "private" ? 5 : 10
        : null
    );

    if (!normalizedEmail) {
      setToast({ label: emptyEmailMessage, at: Date.now(), tone: "error" });
      return { ok: false, error: emptyEmailMessage };
    }

    if (expectedCreatedLinks !== null && slots.length !== expectedCreatedLinks) {
      console.error("Unexpected customer link count before account creation:", {
        accountType: form.account_type,
        expected: expectedCreatedLinks,
        received: slots.length,
      });
      setToast({ label: "تعذر تجهيز العدد الصحيح من روابط العملاء", at: Date.now(), tone: "error" });
      return { ok: false, error: "تعذر تجهيز العدد الصحيح من روابط العملاء" };
    }

    if (form.account_type === "temporary") {
      try {
        temporaryShortId = await createUniqueTemporaryId();
      } catch (error) {
        console.error("Temporary account ID generation failed:", error);
        setToast({ label: "تعذر توليد رابط الحساب المؤقت، حاول مرة أخرى", at: Date.now(), tone: "error" });
        return { ok: false, error: "تعذر توليد رابط الحساب المؤقت، حاول مرة أخرى" };
      }
    }

    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticAccount: NetflixAccount = {
      id: optimisticId,
      email: normalizedEmail,
      password: form.password,
      account_type: form.account_type,
      supplier_code_url: form.supplier_code_url,
      code_fetch_method: codeFetchMethod,
      compensation_tutorial_url: form.account_type === "compensation" ? form.compensation_tutorial_url || null : null,
      temporary_short_id: temporaryShortId,
      email_provider: "none",
      imap_enabled: false,
      normal_client_layout: form.account_type !== "temporary" && form.account_type !== "compensation",
      hide_password_from_client: hidePasswordFromClient,
      compensation_distribution: form.account_type === "compensation" ? form.compensation_distribution : null,
      expires_at,
      service_type: selectedService,
      use_automated_code: selectedService === "netflix" && form.account_type !== "compensation" && codeFetchMethod !== "external_link",
      created_at: new Date().toISOString(),
    };
    let optimisticAccountVisible = true;
    const rollbackOptimisticAccount = () => {
      if (!optimisticAccountVisible) return;
      optimisticAccountVisible = false;
      setAccounts((current) => current.filter((item) => item.id !== optimisticId));
      setTotalAccounts((current) => Math.max(0, current - 1));
    };

    setAccounts((current) => [optimisticAccount, ...current]);
    setTotalAccounts((current) => current + 1);
    setToast({ label: "تمت إضافة الحساب، جاري الحفظ في الخلفية", at: Date.now() });

    try {
      const validation = await validateAccountEmailAndProfiles(
        normalizedEmail,
        form.account_type,
        slots.map((slot) => slot.profile_name),
        undefined,
        selectedService === "osn" ? "osn" : undefined,
      );
      if (!accountFormSucceeded(validation)) {
        const error = accountFormError(validation) || duplicateEmailMessage;
        rollbackOptimisticAccount();
        setToast({ label: error, at: Date.now(), tone: "error" });
        return { ok: false, error };
      }
    } catch {
      rollbackOptimisticAccount();
      setToast({ label: "تعذر التحقق من البريد الإلكتروني، حاول مرة أخرى", at: Date.now(), tone: "error" });
      return { ok: false, error: "تعذر التحقق من البريد الإلكتروني، حاول مرة أخرى" };
    }

    try {
      const shortIds = await createUniqueShortIds(slots.length);
      slots = slots.map((slot, index) => ({ ...slot, short_id: shortIds[index] }));
    } catch {
      rollbackOptimisticAccount();
      setToast({ label: "تعذر توليد روابط قصيرة فريدة، حاول مرة أخرى", at: Date.now(), tone: "error" });
      return { ok: false, error: "تعذر توليد روابط قصيرة فريدة، حاول مرة أخرى" };
    }

    if (!supabase) {
      const createdLinks = slots.map((slot) => ({
        id: crypto.randomUUID(),
        account_id: optimisticAccount.id,
        email: optimisticAccount.email,
        created_at: new Date().toISOString(),
        ...slot,
      }));
      setLinks((current) => [...current, ...createdLinks]);
      optimisticAccountVisible = false;
      setAccounts((current) => current.slice(0, adminAccountsPageSize));
      setToast({ label: "تم إنشاء الحساب محلياً للمعاينة", at: Date.now() });
      return true;
    }

    setLoading(true);
    let account: NetflixAccount | null = null;
    try {
      const { data, error: accountError } = await supabase
        .from("accounts")
        .insert({
          ...form,
          email: normalizedEmail,
          expires_at,
          service_type: selectedService,
          use_automated_code: selectedService === "netflix" && form.account_type !== "temporary" && form.account_type !== "compensation" && codeFetchMethod !== "external_link",
          code_fetch_method: codeFetchMethod,
          temporary_short_id: temporaryShortId,
          email_provider: "none",
          imap_enabled: false,
          normal_client_layout: form.account_type !== "temporary" && form.account_type !== "compensation",
          hide_password_from_client: hidePasswordFromClient,
          compensation_distribution: form.account_type === "compensation" ? form.compensation_distribution : null,
          compensation_tutorial_url: form.account_type === "compensation" ? form.compensation_tutorial_url || null : null,
        })
        .select("id,email,password,account_type,compensation_distribution,compensation_tutorial_url,expires_at,created_at,service_type,use_automated_code,supplier_code_url,code_fetch_method,temporary_short_id,email_provider,imap_enabled,normal_client_layout,hide_password_from_client")
        .single();

      if (accountError) throw accountError;
      account = data as NetflixAccount;
    } catch (error) {
      setLoading(false);
      rollbackOptimisticAccount();
      if (isDuplicateEmailError(error)) {
        setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: duplicateEmailSaveMessage };
      }
      console.error("Supabase account insert error:", error);
      setToast({ label: "تعذر إنشاء الحساب", at: Date.now(), tone: "error" });
      return false;
    }

    if (!account) {
      setLoading(false);
      rollbackOptimisticAccount();
      setToast({ label: "تعذر إنشاء الحساب", at: Date.now(), tone: "error" });
      return false;
    }

    if (form.account_type === "temporary") {
      optimisticAccountVisible = false;
      setAccounts((current) => [
        account,
        ...current.filter((item) => item.id !== optimisticId && item.id !== account?.id),
      ].slice(0, adminAccountsPageSize));
      setLoading(false);
      setToast({ label: "تم حفظ الحساب المؤقت وأصبح رابطه جاهزاً للنسخ", at: Date.now() });
      return true;
    }

    let linksError: unknown = null;
    let createdLinks: CustomerLink[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (expectedNewLinks !== null) {
          const response = await fetch("/api/create-customer-links", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-password": adminPassword,
            },
            body: JSON.stringify({
              account_id: account.id,
              email: normalizedEmail,
              links: slots,
            }),
          });
          const responseText = await response.text();
          const result = (() => {
            try {
              return JSON.parse(responseText) as {
                success?: boolean;
                error?: string;
                code?: string | null;
                details?: string | null;
                hint?: string | null;
                links?: CustomerLink[];
              };
            } catch {
              return null;
            }
          })();
          if (!response.ok || !result?.success) {
            throw {
              code: result?.code || undefined,
              message: result?.error || `create_customer_links_http_${response.status}`,
              details: result?.details || responseText.slice(0, 300) || undefined,
              hint: result?.hint || undefined,
            };
          }
          createdLinks = result.links || [];
        } else {
          const { data, error } = await supabase
            .from("customer_links")
            .insert(
              slots.map((slot) => ({
                account_id: account.id,
                email: normalizedEmail,
                ...slot,
              })),
            )
            .select("*");
          if (error) throw error;
          createdLinks = (data || []) as CustomerLink[];
        }
        linksError = null;
        break;
      } catch (error) {
        linksError = error;
        if (!isShortIdConflictError(error) || attempt === 2) break;

        try {
          const shortIds = await createUniqueShortIds(slots.length);
          slots = slots.map((slot, index) => ({ ...slot, short_id: shortIds[index] }));
        } catch (shortIdError) {
          linksError = shortIdError;
          break;
        }
      }
    }

    if (linksError) {
      await supabase.from("accounts").delete().eq("id", account.id);
      rollbackOptimisticAccount();
      setAccounts((current) => current.filter((item) => item.id !== account?.id));
      if (isCustomerLinksEmailConstraintError(linksError)) {
        setLoading(false);
        setToast({
          label: "يوجد قيد مكرر خاطئ على روابط العملاء. نفّذ SQL إزالة unique_customer_email ثم أعد المحاولة.",
          at: Date.now(),
          tone: "error",
        });
        return {
          ok: false,
          error: "يوجد قيد مكرر خاطئ على روابط العملاء. نفّذ SQL إزالة unique_customer_email ثم أعد المحاولة.",
        };
      }

      if (isShortIdConflictError(linksError)) {
        setLoading(false);
        setToast({ label: "تعذر حجز رابط قصير فريد، أعد المحاولة", at: Date.now(), tone: "error" });
        return { ok: false, error: "تعذر حجز رابط قصير فريد، أعد المحاولة" };
      }

      if (isDuplicateEmailError(linksError)) {
        setLoading(false);
        setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: duplicateEmailSaveMessage };
      }

      const databaseError = formatDatabaseError(linksError);
      console.error("Supabase customer links insert error:", {
        error: linksError,
        formattedError: databaseError,
        accountId: account.id,
        accountType: form.account_type,
        expectedLinks: expectedCreatedLinks,
      });
      setLoading(false);
      const errorMessage = `تعذر حفظ روابط الحساب: ${databaseError}`;
      setToast({ label: errorMessage, at: Date.now(), tone: "error" });
      return { ok: false, error: errorMessage };
    }

    if (expectedCreatedLinks !== null && createdLinks.length !== expectedCreatedLinks) {
      await supabase.from("accounts").delete().eq("id", account.id);
      rollbackOptimisticAccount();
      setAccounts((current) => current.filter((item) => item.id !== account?.id));
      setLoading(false);
      console.error("Unexpected customer link count after account creation:", {
        accountId: account.id,
        expected: expectedCreatedLinks,
        received: createdLinks.length,
      });
      setToast({ label: "لم يُحفظ العدد الكامل من الروابط؛ تم إلغاء إنشاء الحساب لحمايته", at: Date.now(), tone: "error" });
      return { ok: false, error: "لم يُحفظ العدد الكامل من الروابط؛ تم إلغاء إنشاء الحساب لحمايته" };
    }

    optimisticAccountVisible = false;
    setAccounts((current) => [
      account as NetflixAccount,
      ...current.filter((item) => item.id !== optimisticId && item.id !== account?.id),
    ].slice(0, adminAccountsPageSize));
    setLinks((current) => [
      ...current.filter((item) => !createdLinks.some((createdLink) => createdLink.id === item.id)),
      ...createdLinks,
    ]);
    setSelectedAccountId((current) => (current === optimisticId ? account?.id || null : current));
    setLoading(false);
    setToast({ label: "تم حفظ الحساب والروابط بنجاح", at: Date.now() });
    return true;
  }

  async function updateAccount(
    accountId: string,
    form: { email: string; password: string; supplier_code_url?: string | null; code_fetch_method?: CodeFetchMethod; compensation_tutorial_url?: string | null; created_at?: string; expires_at?: string },
  ): Promise<AccountFormResult> {
    const normalizedEmail = normalizeEmail(form.email);
    const currentAccount = accounts.find((account) => account.id === accountId);
    const syncedSupplierCodeUrl = syncEmailInLinkedUrl(
      form.supplier_code_url,
      currentAccount?.email || normalizedEmail,
      normalizedEmail,
    );
    const currentProfileNames = links
      .filter((link) => link.account_id === accountId)
      .map((link) => link.profile_name);

    if (!normalizedEmail) {
      setToast({ label: emptyEmailMessage, at: Date.now(), tone: "error" });
      return { ok: false, error: emptyEmailMessage };
    }

    try {
      const validation = await validateAccountEmailAndProfiles(
        normalizedEmail,
        currentAccount?.account_type || "private",
        currentProfileNames,
        accountId,
        serviceOf(currentAccount) === "osn" ? "osn" : undefined,
      );
      if (!accountFormSucceeded(validation)) {
        const error = accountFormError(validation) || duplicateEmailMessage;
        setToast({ label: error, at: Date.now(), tone: "error" });
        return { ok: false, error };
      }
    } catch {
      setToast({ label: "تعذر التحقق من البريد الإلكتروني، حاول مرة أخرى", at: Date.now(), tone: "error" });
      return { ok: false, error: "تعذر التحقق من البريد الإلكتروني، حاول مرة أخرى" };
    }

    if (!supabase) {
      setAccounts((current) =>
        current.map((account) =>
          account.id === accountId
            ? {
                ...account,
                ...form,
                email: normalizedEmail,
                supplier_code_url: syncedSupplierCodeUrl,
                code_fetch_method: form.code_fetch_method ?? account.code_fetch_method,
                use_automated_code: form.code_fetch_method
                  ? form.code_fetch_method !== "external_link"
                  : account.use_automated_code,
                created_at: form.created_at || account.created_at,
                expires_at: form.expires_at || account.expires_at,
              }
            : account,
        ),
      );
      setLinks((current) =>
        current.map((link) => (link.account_id === accountId ? { ...link, email: normalizedEmail } : link)),
      );
      setToast({ label: "تم حفظ التعديلات محلياً", at: Date.now() });
      return true;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/update-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword,
        },
        body: JSON.stringify({
          account_id: accountId,
          email: normalizedEmail,
          password: form.password,
          supplier_code_url: syncedSupplierCodeUrl,
          code_fetch_method: form.code_fetch_method,
          compensation_tutorial_url: form.compensation_tutorial_url,
          created_at: form.created_at,
          expires_at: form.expires_at,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        account?: NetflixAccount;
        links?: CustomerLink[];
      } | null;

      if (!response.ok || !result?.success || !result.account) {
        if (result?.error === "duplicate_email") {
          setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
          return { ok: false, error: duplicateEmailSaveMessage };
        }
        const rlsMessage = result?.error === "account_update_returned_no_row"
          ? "تعذر تعديل الحساب بسبب صلاحيات Supabase (RLS)"
          : "تعذر حفظ تعديلات الحساب في قاعدة البيانات";
        console.error("Verified account update failed:", result?.error || response.statusText);
        setToast({ label: rlsMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: rlsMessage };
      }

      setAccounts((current) =>
        current.map((account) => (account.id === accountId ? result.account as NetflixAccount : account)),
      );
      setLinks((current) => {
        const refreshedLinks = result.links || [];
        return refreshedLinks.length
          ? [...current.filter((link) => link.account_id !== accountId), ...refreshedLinks]
          : current.map((link) => (link.account_id === accountId ? { ...link, email: normalizedEmail } : link));
      });

      await loadData();
      setToast({ label: "تم حفظ إعدادات الحساب دون تغيير روابط العملاء", at: Date.now() });
      return true;
    } catch (error) {
      console.error("Account update request failed:", error);
      const message = "تعذر الاتصال بالخادم لحفظ تعديلات الحساب";
      setToast({ label: message, at: Date.now(), tone: "error" });
      return { ok: false, error: message };
    } finally {
      setLoading(false);
    }
  }

  async function updateAccountDates(accountId: string, form: { created_at: string; expires_at: string }) {
    if (!supabase) {
      setAccounts((current) => current.map((account) => (account.id === accountId ? { ...account, ...form } : account)));
      setToast({ label: "تم حفظ التواريخ", at: Date.now() });
      return true;
    }

    setLoading(true);
    const { error } = await supabase.from("accounts").update(form).eq("id", accountId);
    setLoading(false);

    if (error) {
      setToast({ label: "تعذر حفظ التواريخ", at: Date.now() });
      return false;
    }

    setAccounts((current) => current.map((account) => (account.id === accountId ? { ...account, ...form } : account)));
    setToast({ label: "تم حفظ التواريخ", at: Date.now() });
    return true;
  }

  async function deleteCustomerLinks(ids: string[]) {
    if (!ids.length) return true;

    if (!supabase) {
      setLinks((current) => current.filter((link) => !ids.includes(link.id)));
      setToast({ label: ids.length > 1 ? "تم حذف الروابط" : "تم حذف الرابط", at: Date.now() });
      return true;
    }

    setLoading(true);
    const { error } = await supabase.from("customer_links").delete().in("id", ids);
    setLoading(false);

    if (error) {
      setToast({ label: "تعذر حذف الروابط", at: Date.now() });
      return false;
    }

    setLinks((current) => current.filter((link) => !ids.includes(link.id)));
    setToast({ label: ids.length > 1 ? "تم حذف الروابط" : "تم حذف الرابط", at: Date.now() });
    return true;
  }

  async function updateCustomerCodeBalance(
    linkId: string,
    codeRequestLimit: number,
    _resetRequestedCount: boolean,
  ) {
    const normalizedLimit = Math.max(0, Math.floor(codeRequestLimit));
    const updates = {
      code_request_limit: normalizedLimit,
      code_requested_count: 0,
      has_used_tv_link: normalizedLimit === 0,
      tv_link_used_at: null,
    };

    if (supabase) {
      const { error } = await supabase.from("customer_links").update(updates).eq("id", linkId);
      if (error) {
        console.error("Supabase customer code balance update error:", error);
        setToast({ label: "تعذر تحديث رصيد أكواد العميل", at: Date.now() });
        return false;
      }
    }

    setLinks((current) =>
      current.map((link) =>
        link.id === linkId
          ? {
              ...link,
              code_request_limit: normalizedLimit,
              code_requested_count: 0,
              has_used_tv_link: normalizedLimit === 0,
              tv_link_used_at: null,
            }
          : link,
      ),
    );
    setToast({ label: "تم تحديث رصيد أكواد العميل", at: Date.now() });
    return true;
  }

  async function resetCustomerDevice(linkId: string) {
    if (supabase) {
      const { error } = await supabase
        .from("customer_links")
        .update({ selected_device: null })
        .eq("id", linkId);

      if (error) {
        console.error("Supabase customer device reset error:", error);
        setToast({ label: "تعذر إعادة ضبط الجهاز المختار", at: Date.now() });
        return false;
      }
    }

    setLinks((current) =>
      current.map((link) => (link.id === linkId ? { ...link, selected_device: null } : link)),
    );
    setToast({ label: "تم إعادة إتاحة اختيار الجهاز للعميل بنجاح", at: Date.now() });
    return true;
  }

  async function resetExternalCodeAccess(linkId: string) {
    if (!supabase) {
      setLinks((current) =>
        current.map((link) =>
          link.id === linkId
            ? {
                ...link,
                external_code_used: false,
                external_code_used_at: null,
                external_code_first_opened_at: null,
              }
            : link,
        ),
      );
      setToast({ label: "تمت إعادة تفعيل رابط الكود لهذا العميل", at: Date.now() });
      return true;
    }

    try {
      const response = await fetch("/api/reset-external-code-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword,
        },
        body: JSON.stringify({ link_id: linkId }),
      });
      const responseText = await response.text();
      const result = (() => {
        try {
          return JSON.parse(responseText) as {
            success?: boolean;
            link?: CustomerLink;
            error?: string;
            code?: string | null;
            details?: string | null;
            hint?: string | null;
          };
        } catch {
          return null;
        }
      })();
      if (!response.ok || !result?.success || !result.link) {
        throw {
          message: result?.error || `reset_external_code_http_${response.status}`,
          code: result?.code || undefined,
          details: result?.details || responseText.slice(0, 300) || undefined,
          hint: result?.hint || undefined,
        };
      }

      setLinks((current) =>
        current.map((link) => (link.id === linkId ? { ...link, ...result.link } : link)),
      );
      setToast({ label: "تمت إعادة تفعيل رابط الكود لهذا العميل", at: Date.now() });
      return true;
    } catch (error) {
      const databaseError = formatDatabaseError(error);
      console.error("External code access reset request failed:", { error, formattedError: databaseError, linkId });
      setToast({ label: `تعذرت إعادة تفعيل رابط الكود: ${databaseError}`, at: Date.now(), tone: "error" });
      return false;
    }
  }

  async function reviewExtraCreditRequest(
    requestId: string,
    status: Exclude<ExtraCreditRequestStatus, "pending">,
  ) {
    if (!supabase) {
      const request = extraCreditRequests.find((item) => item.id === requestId);
      setExtraCreditRequests((current) =>
        current.map((item) =>
          item.id === requestId
            ? { ...item, status, reviewed_at: new Date().toISOString(), image_url: null }
            : item,
        ),
      );
      if (status === "approved" && request) {
        setLinks((current) =>
          current.map((item) =>
            item.id === request.customer_id
              ? {
                  ...item,
                  code_request_limit: Math.max(
                    Number(item.code_request_limit ?? 1),
                    Number(item.code_requested_count ?? 0),
                  ) + 1,
                  has_used_tv_link: false,
                  tv_link_used_at: null,
                  code_used_at: null,
                }
              : item,
          ),
        );
      }
      setToast({
        label: status === "approved" ? "تم قبول الطلب وإضافة محاولة للعميل" : "تم رفض طلب الرصيد",
        at: Date.now(),
      });
      return true;
    }

    try {
      const response = await fetch("/api/review-credit-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword,
        },
        body: JSON.stringify({ request_id: requestId, status }),
      });
      const result = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error || "review_failed");

      await loadData();
      setToast({
        label: status === "approved" ? "تم قبول الطلب وإضافة محاولة للعميل" : "تم رفض طلب الرصيد",
        at: Date.now(),
      });
      return true;
    } catch (error) {
      console.error("Extra credit request review error:", error);
      setToast({ label: "تعذر تحديث طلب الرصيد الإضافي", tone: "error", at: Date.now() });
      return false;
    }
  }

  async function copyAllCustomerLinksForAccount(accountId: string) {
    let accountLinks = links.filter((link) => link.account_id === accountId);

    // Always read the authoritative set before copying; local paginated/realtime
    // state may briefly contain only part of an account's links.
    if (supabase) {
      const { data, error } = await supabase
        .from("customer_links")
        .select("*")
        .eq("account_id", accountId)
        .order("profile_name", { ascending: true });

      if (error) {
        console.error("Customer links bulk copy fetch failed:", error);
        setToast({ label: "تعذر جلب روابط هذا الحساب", at: Date.now(), tone: "error" });
        return;
      }
      accountLinks = (data || []) as CustomerLink[];
    }

    if (!accountLinks.length) {
      setToast({ label: "لا توجد روابط مرتبطة بهذا الحساب", at: Date.now(), tone: "error" });
      return;
    }

    const account = accounts.find((item) => item.id === accountId);
    const accountService = serviceOf(account);
    const expectedCount = account?.account_type === "private"
      ? accountService === "shahid" ? 4 : 5
      : account?.account_type === "shared"
        ? accountService === "shahid" ? 8 : 10
        : null;
    if (expectedCount !== null && accountLinks.length !== expectedCount) {
      console.error("Refusing to copy an incomplete customer link set:", {
        accountId,
        expected: expectedCount,
        received: accountLinks.length,
      });
      setToast({
        label: `تعذر النسخ: العدد المحفوظ ${accountLinks.length} من ${expectedCount}. لم يتم تغيير أي رابط.`,
        at: Date.now(),
        tone: "error",
      });
      return;
    }

    const linksText = [...accountLinks]
      .sort((first, second) => first.profile_name.localeCompare(second.profile_name, "en", { numeric: true }))
      .map((link) => `للحصول على بيانات الحساب ادخل على الرابط التالي: ${getCustomerUrl(link)}`)
      .join("\n");

    try {
      await writeClipboardText(linksText);
      setToast({ label: "تم نسخ جميع الروابط بالتنسيق الإرشادي بنجاح", at: Date.now() });
    } catch (error) {
      console.error("Customer links bulk copy failed:", error);
      setToast({ label: "تعذر نسخ الروابط، حاول مرة أخرى", at: Date.now(), tone: "error" });
    }
  }

  async function resetSharedCompensationLinks(accountId: string) {
    const account = accounts.find((item) => item.id === accountId);
    if (account?.account_type !== "compensation" || account.compensation_distribution !== "shared") {
      setToast({ label: "إعادة التعيين متاحة لحسابات التعويضات المشتركة فقط", at: Date.now(), tone: "error" });
      return;
    }

    const confirmed = window.confirm(
      "هل أنت أصلًا تريد إعادة تعيين وإنشاء 8 روابط جديدة لهذا الحساب؟ (سيتم استبدال الروابط الحالية لهذا الحساب فقط)",
    );
    if (!confirmed) return;

    if (!supabase) {
      const now = new Date().toISOString();
      const generatedLinks = buildProfileSlots("compensation", "netflix", "shared").map((slot) => ({
        ...slot,
        id: crypto.randomUUID(),
        account_id: accountId,
        email: account.email,
        created_at: now,
      })) as CustomerLink[];
      setLinks((current) => [...current.filter((link) => link.account_id !== accountId), ...generatedLinks]);
      setToast({ label: "تم إعادة تعيين 8 روابط جديدة بنجاح", at: Date.now() });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/reset-compensation-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword,
        },
        body: JSON.stringify({ account_id: accountId }),
      });
      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        links?: CustomerLink[];
      } | null;

      if (!response.ok || !result?.success || result.links?.length !== 8) {
        throw new Error(result?.error || "reset_failed");
      }

      setLinks((current) => [
        ...current.filter((link) => link.account_id !== accountId),
        ...(result.links || []),
      ]);
      setToast({ label: "تم إعادة تعيين 8 روابط جديدة بنجاح", at: Date.now() });
    } catch (error) {
      console.error("Shared compensation links reset request failed:", error);
      setToast({ label: "تعذر إعادة تعيين الروابط، بقيت الروابط الحالية دون تغيير", at: Date.now(), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function deleteAccount(accountId: string) {
    if (!window.confirm("هل تريد حذف هذا الحساب وجميع روابط العملاء التابعة له؟")) return;

    if (!supabase) {
      setAccounts((current) => current.filter((account) => account.id !== accountId));
      setLinks((current) => current.filter((link) => link.account_id !== accountId));
      setSelectedAccountId(null);
      setScreen("netflix");
      setToast({ label: "تم حذف الحساب", at: Date.now() });
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("accounts").delete().eq("id", accountId);
    setLoading(false);

    if (error) {
      setToast({ label: "تعذر حذف الحساب", at: Date.now() });
      return;
    }

    setAccounts((current) => current.filter((account) => account.id !== accountId));
    setLinks((current) => current.filter((link) => link.account_id !== accountId));
    setSelectedAccountId(null);
    setScreen("netflix");
    setToast({ label: "تم حذف الحساب", at: Date.now() });
  }

  function logout() {
    localStorage.removeItem(adminAuthKey);
    sessionStorage.removeItem("zone-admin-auth");
    setAuthenticated(false);
    setSelectedAccountId(null);
    setScreen("selector");
    setToast({ label: "تم تسجيل الخروج", at: Date.now() });
  }

  const serviceAccounts = accounts.filter((account) => serviceOf(account) === selectedService);
  const filteredAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return serviceAccounts;
    const normalizedCustomerNumber = normalized.replace(/^#/, "");
    const matchingAccountIds = new Set(
      links
        .filter(
          (link) =>
            (link.link_number != null && String(link.link_number).includes(normalizedCustomerNumber)) ||
            String(link.short_id || "").toLowerCase().includes(normalizedCustomerNumber),
        )
        .map((link) => link.account_id),
    );
    return serviceAccounts.filter(
      (account) =>
        account.email.toLowerCase().includes(normalized) ||
        account.id.toLowerCase().includes(normalized) ||
        matchingAccountIds.has(account.id),
    );
  }, [serviceAccounts, links, query]);

  const linksByAccount = useMemo(() => {
    const grouped = new Map<string, CustomerLink[]>();

    links.forEach((link) => {
      const accountLinks = grouped.get(link.account_id) || [];
      accountLinks.push(link);
      grouped.set(link.account_id, accountLinks);
    });

    grouped.forEach((accountLinks) => {
      accountLinks.sort((first, second) =>
        first.profile_name.localeCompare(second.profile_name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    });

    return grouped;
  }, [links]);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null;
  const activeLinks = selectedAccountId ? linksByAccount.get(selectedAccountId) || [] : [];
  const customerNumberMatch = query.trim().match(/^#?(\d+)$/);
  const customerSearchResult = customerNumberMatch
    ? (() => {
        const link = links.find((item) => item.link_number === Number(customerNumberMatch[1]));
        const account = link ? accounts.find((item) => item.id === link.account_id) : null;
        return link && account ? { link, account } : null;
      })()
    : null;
  const activeAccounts = serviceAccounts.filter((account) => !isExpired(account.expires_at)).length;
  const expiredAccounts = serviceAccounts.filter((account) => isExpired(account.expires_at)).length;
  const privateAccounts = serviceAccounts.filter((account) => account.account_type === "private").length;
  const totalPages = Math.max(1, Math.ceil(totalAccounts / adminAccountsPageSize));

  if (!authenticated) {
    return (
      <Shell toast={toast}>
        <AdminLogin
          onLogin={(password) => {
            if (password === adminPassword) {
              localStorage.setItem(adminAuthKey, adminAuthValue);
              sessionStorage.removeItem("zone-admin-auth");
              setAuthenticated(true);
              setToast({ label: "تم تسجيل الدخول بنجاح", at: Date.now() });
            } else {
              setToast({ label: "كلمة المرور غير صحيحة", at: Date.now() });
            }
          }}
        />
      </Shell>
    );
  }

  if (screen === "selector") {
    return (
      <ServiceSelector
        onLogout={logout}
        onNetflix={() => {
          setCurrentPage(1);
          setSelectedService("netflix");
          setScreen("netflix");
        }}
        onShahid={() => {
          setCurrentPage(1);
          setSelectedService("shahid");
          setScreen("netflix");
        }}
        onOsn={() => {
          setCurrentPage(1);
          setSelectedService("osn");
          setScreen("netflix");
        }}
      />
    );
  }

  if (screen === "credit-requests") {
    return (
      <Shell toast={toast}>
        <ExtraCreditRequestsPage
          requests={extraCreditRequests}
          service={selectedService}
          loading={loading}
          onBack={() => setScreen("netflix")}
          onReview={reviewExtraCreditRequest}
          onLogout={logout}
        />
      </Shell>
    );
  }

  if (screen === "compensations") {
    return (
      <Shell toast={toast}>
        <CompensationAdminPage
          service={selectedService}
          onBack={() => setScreen("netflix")}
          onLogout={logout}
          setToast={setToast}
        />
      </Shell>
    );
  }

  if (screen === "account" && selectedAccount) {
    return (
      <Shell toast={toast}>
        <AccountDetail
          account={selectedAccount}
          links={activeLinks}
          onBack={() => setScreen("netflix")}
          setToast={setToast}
          onDelete={deleteAccount}
          onDeleteLinks={deleteCustomerLinks}
          onUpdateCustomerCodeBalance={updateCustomerCodeBalance}
          onResetCustomerDevice={resetCustomerDevice}
          onResetExternalCodeAccess={resetExternalCodeAccess}
          onUpdateDates={updateAccountDates}
          onUpdate={updateAccount}
          onLogout={logout}
        />
      </Shell>
    );
  }

  return (
    <Shell toast={toast}>
      <Dashboard
        accounts={filteredAccounts}
        loading={loading}
        currentPage={currentPage}
        totalPages={totalPages}
        totalAccounts={totalAccounts}
        query={query}
        customerSearchResult={customerSearchResult}
        stats={[
          { label: "الحسابات", value: serviceAccounts.length, icon: Users, tone: "neutral" },
          { label: "الحسابات الفعالة", value: activeAccounts, icon: CircleCheck, tone: "green" },
          { label: "الحسابات المنتهية", value: expiredAccounts, icon: CircleX, tone: "red" },
          { label: "حسابات خاصة", value: privateAccounts, icon: ShieldCheck, tone: "neutral" },
        ]}
        service={selectedService}
        onBackToServices={() => {
          setSelectedAccountId(null);
          setScreen("selector");
          localStorage.setItem("zone-admin-screen", "selector");
        }}
        onQuery={(value) => {
          setQuery(value);
          setCurrentPage(1);
        }}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
        onAdd={addAccount}
        onUpdate={updateAccount}
        onSelect={(id) => {
          setSelectedAccountId(id);
          setScreen("account");
        }}
        onDelete={deleteAccount}
        onCopyTemporaryLink={(account) => {
          const url = getTemporaryAccountUrl(account);
          if (url) void copyText(url, setToast);
        }}
        onCopyAllLinks={copyAllCustomerLinksForAccount}
        onResetCompensationLinks={resetSharedCompensationLinks}
        onUpdateCustomerCodeBalance={updateCustomerCodeBalance}
        onResetCustomerDevice={resetCustomerDevice}
        pendingCreditRequests={extraCreditRequests.filter((request) => request.status === "pending").length}
        onOpenCreditRequests={() => setScreen("credit-requests")}
        onOpenCompensations={() => setScreen("compensations")}
        onLogout={logout}
      />
    </Shell>
  );
}

function Shell({ children, toast }: { children: React.ReactNode; toast: Toast }) {
  return (
    <main className="min-h-screen bg-white text-ink" dir="rtl">
      {children}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-rise items-center gap-2 rounded-full px-5 py-3 text-center text-sm font-bold text-white shadow-premium",
            toast.tone === "error" ? "bg-rose-600" : "bg-emerald-600",
          )}
        >
          {toast.tone === "error" ? <CircleX className="h-4 w-4 shrink-0 text-white" /> : <Check className="h-4 w-4 shrink-0 text-white" />}
          {toast.label}
        </div>
      )}
    </main>
  );
}

function AdminLogin({ onLogin }: { onLogin: (password: string) => void }) {
  const [password, setPassword] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onLogin(password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#F3F4F6] via-[#F9FAFB] to-white px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-md animate-rise rounded-[2rem] border border-white bg-white p-7 text-center shadow-premium-lg"
      >
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#8B35F5] text-xl font-black text-white shadow-[0_16px_36px_rgba(139,53,245,0.28)]">
          زون
        </div>
        <p className="text-sm font-black text-[#8B35F5]">Zone Store</p>
        <h1 className="mt-2 text-3xl font-black">دخول لوحة التحكم</h1>
        <p className="mt-2 text-sm font-bold text-zinc-500">أدخل كلمة المرور لعرض وإدارة حسابات نتفلكس.</p>

        <label className="mt-7 block text-right">
          <span className="mb-2 flex items-center gap-2 text-sm font-black">
            <LockKeyhole className="h-4 w-4 text-[#8B35F5]" />
            كلمة المرور
          </span>
          <input
            autoFocus
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-13 w-full rounded-xl border-2 border-[#DDCEF4] bg-[#FAF8FD] px-4 text-center text-lg font-black outline-none transition duration-300 focus:border-[#8B35F5] focus:bg-white focus:shadow-[0_0_0_4px_rgba(139,53,245,0.10)]"
          />
        </label>

        <button className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_16px_36px_rgba(139,53,245,0.26)] transition duration-300 hover:-translate-y-1 hover:bg-[#7626DD]">
          <KeyRound className="h-5 w-5" />
          دخول
        </button>
      </form>
    </div>
  );
}

function ServiceSelector({
  onNetflix,
  onShahid,
  onOsn,
  onLogout,
}: {
  onNetflix: () => void;
  onShahid: () => void;
  onOsn: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#F9FAFB] text-ink" dir="rtl">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-5 py-8">
        <div className="mb-10 flex items-center justify-between gap-4 animate-rise">
          <div>
            <p className="text-sm font-extrabold text-[#8B35F5]">Zone Store</p>
            <h1 className="mt-2 text-3xl font-black tracking-normal md:text-5xl">لوحة إدارة الاشتراكات</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              className="rounded-xl border border-[#DDCEF4] bg-[#F7F2FF] px-4 py-3 text-sm font-black text-[#7C2CE8] transition duration-300 hover:bg-[#8B35F5] hover:text-white"
            >
              تسجيل الخروج
            </button>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#8B35F5] text-2xl font-black text-white shadow-[0_16px_36px_rgba(139,53,245,0.24)]">
              Z
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <button
            onClick={onNetflix}
            className="group animate-rise rounded-3xl border border-red-100 bg-white p-8 text-right shadow-premium transition duration-300 hover:-translate-y-1 hover:border-netflix hover:shadow-premium-lg active:scale-[0.98]"
          >
            <div className="mb-10 flex items-center justify-between">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-netflix text-white shadow-red">
                <MonitorPlay className="h-8 w-8" />
              </div>
              <ChevronLeft className="h-6 w-6 text-netflix transition duration-300 group-hover:-translate-x-1" />
            </div>
            <h2 className="text-2xl font-black">إدارة نتفلكس</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-zinc-500">
              إنشاء الحسابات، توليد روابط العملاء، ونسخ بيانات الملفات من مكان واحد.
            </p>
          </button>

          <button
            onClick={onShahid}
            className="group animate-rise rounded-3xl border border-cyan-100 bg-white p-8 text-right shadow-premium transition duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-shahid"
          >
            <div className="mb-10 flex items-center justify-between">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-shahid">
                <Sparkles className="h-8 w-8" />
              </div>
              <ChevronLeft className="h-6 w-6 text-cyan-600 transition duration-300 group-hover:-translate-x-1" />
            </div>
            <h2 className="text-2xl font-black">إدارة شاهد</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-zinc-500">
              إدارة حسابات شاهد بروابط مختصرة وصفحة عميل بدون رمز ملف.
            </p>
          </button>

          <button
            onClick={onOsn}
            className="group animate-rise rounded-3xl border border-fuchsia-100 bg-white p-8 text-right shadow-premium transition duration-300 hover:-translate-y-1 hover:border-fuchsia-400 hover:shadow-[0_20px_55px_rgba(162,28,175,0.16)] active:scale-[0.98]"
          >
            <div className="mb-10 flex items-center justify-between">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-700 to-amber-500 text-white shadow-[0_16px_36px_rgba(162,28,175,0.24)]">
                <Tv className="h-8 w-8" />
              </div>
              <ChevronLeft className="h-6 w-6 text-fuchsia-700 transition duration-300 group-hover:-translate-x-1" />
            </div>
            <h2 className="text-2xl font-black">إدارة OSN</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-zinc-500">
              إدارة وتوليد روابط حسابات OSN للعملاء.
            </p>
          </button>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  accounts,
  stats,
  service,
  query,
  customerSearchResult,
  loading,
  currentPage,
  totalPages,
  totalAccounts,
  onQuery,
  onPreviousPage,
  onNextPage,
  onAdd,
  onUpdate,
  onSelect,
  onDelete,
  onCopyTemporaryLink,
  onCopyAllLinks,
  onResetCompensationLinks,
  onUpdateCustomerCodeBalance,
  onResetCustomerDevice,
  pendingCreditRequests,
  onOpenCreditRequests,
  onOpenCompensations,
  onBackToServices,
  onLogout,
}: {
  accounts: NetflixAccount[];
  stats: Array<{ label: string; value: number; icon: LucideIcon; tone: StatTone }>;
  service: ServiceType;
  query: string;
  customerSearchResult: CustomerSearchResult | null;
  loading: boolean;
  currentPage: number;
  totalPages: number;
  totalAccounts: number;
  onQuery: (query: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onAdd: Parameters<typeof AccountForm>[0]["onAdd"];
  onUpdate: Parameters<typeof AccountForm>[0]["onUpdate"];
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTemporaryLink: (account: NetflixAccount) => void;
  onCopyAllLinks: (accountId: string) => Promise<void>;
  onResetCompensationLinks: (accountId: string) => Promise<void>;
  onUpdateCustomerCodeBalance: (
    linkId: string,
    codeRequestLimit: number,
    resetRequestedCount: boolean,
  ) => Promise<boolean>;
  onResetCustomerDevice: (linkId: string) => Promise<boolean>;
  pendingCreditRequests: number;
  onOpenCreditRequests: () => void;
  onOpenCompensations: () => void;
  onBackToServices: () => void;
  onLogout: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<NetflixAccount | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>("all");
  const [editingCustomerBalance, setEditingCustomerBalance] = useState<CustomerLink | null>(null);

  const openAddForm = () => {
    setEditingAccount(null);
    setFormOpen(true);
  };

  const openEditForm = (account: NetflixAccount) => {
    setEditingAccount(account);
    setFormOpen(true);
  };

  const visibleAccounts = useMemo(() => {
    if (accountTypeFilter === "all") return accounts;
    return accounts.filter((account) => account.account_type === accountTypeFilter);
  }, [accounts, accountTypeFilter]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.("[data-filter-popover]")) setFilterOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const filterLabel =
    accountTypeFilter === "private"
      ? "خاص"
      : accountTypeFilter === "shared"
        ? "مشترك"
        : accountTypeFilter === "temporary"
          ? "مؤقت"
          : accountTypeFilter === "compensation"
            ? "التعويضات"
            : "فلترة";

  return (
    <div className="min-h-screen bg-white text-[#17141F]">
      <Header service={service} onBack={onBackToServices} onLogout={onLogout} />

      <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 pt-7 md:px-8 md:pt-10">
        {!hasSupabaseConfig && <ConfigNotice />}

        <section className="mb-7 rounded-[2rem] border border-[#E8DCFF] bg-white p-4 shadow-[0_18px_50px_rgba(70,40,120,0.10)] md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative shrink-0 md:w-48">
              <button
                type="button"
                onClick={openAddForm}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#8B35F5] px-7 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.28)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#7626DD] active:translate-y-0"
              >
                <Plus className="h-5 w-5" />
                إضافة حساب جديد
              </button>
            </div>

            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8B35F5]" />
              <input
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="ابحث بالبريد الإلكتروني أو رقم العميل أو الكود..."
                className="h-13 w-full rounded-xl border-2 border-[#D8C1FF] bg-white px-4 pr-12 text-sm font-bold outline-none transition duration-300 placeholder:text-zinc-400 focus:border-[#8B35F5] focus:shadow-[0_0_0_4px_rgba(139,53,245,0.10)]"
              />
            </div>

            {service !== "osn" && (
              <>
                <button
                  type="button"
                  onClick={onOpenCreditRequests}
                  className="relative flex h-13 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#D8C1FF] bg-[#F8F4FF] px-5 text-sm font-black text-[#7C2CE8] transition hover:border-[#8B35F5] hover:bg-[#8B35F5] hover:text-white"
                >
                  <Inbox className="h-4 w-4" />
                  طلبات الرصيد الإضافي
                  {pendingCreditRequests > 0 && (
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">
                      {pendingCreditRequests}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onOpenCompensations}
                  className="flex h-13 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#D8C1FF] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:border-[#8B35F5] hover:bg-[#8B35F5] hover:text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                  طلبات التعويض
                </button>
              </>
            )}

            <div className="relative shrink-0 md:w-36" data-filter-popover>
              <button
                type="button"
                onClick={() => setFilterOpen((current) => !current)}
                className={cn(
                  "flex h-13 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black transition duration-300",
                  accountTypeFilter === "all"
                    ? "border-[#E3D5FA] bg-[#F8F4FF] text-[#7C2CE8]"
                    : "border-[#8B35F5] bg-[#8B35F5] text-white shadow-[0_12px_26px_rgba(139,53,245,0.22)]",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {filterLabel}
                <ChevronDown className="h-4 w-4" />
              </button>

              {filterOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-48 overflow-hidden rounded-2xl border border-[#E4D6FA] bg-white p-2 shadow-premium-lg">
                  {[
                    { key: "all", label: "جميع الحسابات" },
                    { key: "private", label: "خاص" },
                    { key: "shared", label: "مشترك" },
                    { key: "temporary", label: "حساب مؤقت" },
                    { key: "compensation", label: "التعويضات" },
                  ]
                    .filter((option) => service !== "osn" || ["all", "private", "shared"].includes(option.key))
                    .map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setAccountTypeFilter(option.key as AccountTypeFilter);
                        setFilterOpen(false);
                      }}
                      className={cn(
                        "flex h-11 w-full items-center justify-between rounded-xl px-3 text-right text-sm font-black transition",
                        accountTypeFilter === option.key ? "bg-[#F4EDFF] text-[#7C2CE8]" : "text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      <span>{option.label}</span>
                      {accountTypeFilter === option.key && <Check className="h-4 w-4" />}
                    </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {customerSearchResult && (
          <section className="rounded-[2rem] border border-[#E8DCFF] bg-white p-5 shadow-[0_18px_55px_rgba(70,40,120,0.10)] md:p-7">
            <div className="mb-5">
              <p className="text-xs font-black text-[#8B35F5]">نتيجة البحث برقم العميل</p>
              <h2 className="mt-1 text-2xl font-black">عميل #{customerSearchResult.link.link_number}</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div className="min-w-0 rounded-2xl border border-[#E8DDF8] bg-[#FCFAFF] p-4">
                <p className="text-xs font-black text-zinc-500">البريد الإلكتروني</p>
                <p className="mt-2 break-all text-lg font-black text-zinc-950" dir="ltr">
                  {customerSearchResult.account.email}
                </p>
              </div>

              {(() => {
                const limit = Math.max(0, customerSearchResult.link.code_request_limit ?? 1);
                const used = Math.max(0, customerSearchResult.link.code_requested_count ?? 0);
                const remaining = Math.max(0, limit - used);
                return (
                  <div
                    className={cn(
                      "rounded-2xl border px-5 py-4 text-center",
                      remaining > 0
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700",
                    )}
                  >
                    <p className="text-xs font-black">الرصيد المتبقي</p>
                    <p className="mt-1 text-3xl font-black">{remaining}</p>
                  </div>
                );
              })()}

              <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setEditingCustomerBalance(customerSearchResult.link)}
                className="h-13 rounded-2xl bg-[#8B35F5] px-6 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD]"
                >
                  تعديل الرصيد
                </button>
                {customerSearchResult.link.tv_approval_url && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyTextSilent(customerSearchResult.link.tv_approval_url || "")
                    }
                    className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-white px-4 text-xs font-black text-[#7C2CE8] transition hover:bg-[#F8F4FF]"
                  >
                    <Link2 className="h-4 w-4" />
                    نسخ رابط الموافقة
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("هل تريد إعادة ضبط الجهاز المختار لهذا العميل؟")) return;
                    await onResetCustomerDevice(customerSearchResult.link.id);
                  }}
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 text-xs font-black text-amber-700 transition hover:bg-amber-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة ضبط الجهاز
                </button>
              </div>
            </div>
          </section>
        )}

        {!customerSearchResult && (
        <section className="overflow-hidden rounded-[2rem] border border-[#E8DCFF] bg-white shadow-[0_18px_55px_rgba(70,40,120,0.10)]">
          <div className="flex flex-col gap-4 border-b border-[#EEE7F8] px-5 py-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-[#8B35F5]">ZONE STORE</p>
              <h2 className="mt-1 text-xl font-black">قائمة الحسابات</h2>
              <p className="mt-1 text-xs font-semibold text-zinc-500">عرض {visibleAccounts.length} من {totalAccounts} حساب</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-[#F3ECFF] px-3 py-2 text-xs font-black text-[#6F22D6]">
                {visibleAccounts.length} حساب
              </span>
              <button
                type="button"
                title="خيارات العرض"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2D4F8] text-[#7C2CE8] transition hover:bg-[#F7F2FF]"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1040px] border-collapse text-right">
              <thead>
                <tr className="border-b border-[#EEE7F8] bg-[#FCFAFF] text-xs font-black text-zinc-600">
                  <th className="w-[42%] px-5 py-4">الحساب</th>
                  <th className="w-[14%] px-4 py-4">النوع</th>
                  <th className="w-[12%] px-4 py-4">الحالة</th>
                  <th className="w-[14%] px-4 py-4">تاريخ الانتهاء</th>
                  <th className="w-[10%] px-4 py-4">المتبقي</th>
                  <th className="px-5 py-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((account, index) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    index={index}
                    onSelect={onSelect}
                    onEdit={openEditForm}
                    onDelete={onDelete}
                    onCopyTemporaryLink={onCopyTemporaryLink}
                    onCopyAllLinks={onCopyAllLinks}
                    onResetCompensationLinks={onResetCompensationLinks}
                    onOpenSupplierCode={(url) => window.open(url, "_blank", "noopener,noreferrer")}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 px-2 py-3 sm:px-4 lg:hidden">
            {visibleAccounts.map((account, index) => (
              <AccountCard
                key={account.id}
                account={account}
                index={index}
                onSelect={onSelect}
                onEdit={openEditForm}
                onDelete={onDelete}
                onCopyTemporaryLink={onCopyTemporaryLink}
                onCopyAllLinks={onCopyAllLinks}
                onResetCompensationLinks={onResetCompensationLinks}
                onOpenSupplierCode={(url) => window.open(url, "_blank", "noopener,noreferrer")}
              />
            ))}
          </div>

          {!visibleAccounts.length && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3ECFF] text-[#8B35F5]">
                <Search className="h-6 w-6" />
              </div>
              <p className="text-sm font-black text-zinc-700">لا توجد حسابات مطابقة</p>
              <p className="text-xs font-semibold text-zinc-400">جرّب تغيير عبارة البحث أو الفلتر أو أضف حساباً جديداً.</p>
            </div>
          )}

          {totalAccounts > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-[#EEE7F8] bg-[#FCFAFF] px-4 py-4 sm:flex-row sm:px-5">
              <p className="text-xs font-bold text-zinc-500">
                عرض {Math.min((currentPage - 1) * adminAccountsPageSize + 1, totalAccounts)} إلى{" "}
                {Math.min(currentPage * adminAccountsPageSize, totalAccounts)} من {totalAccounts}
              </p>

              <div className="flex items-center gap-2" dir="rtl">
                <button
                  type="button"
                  onClick={onPreviousPage}
                  disabled={currentPage <= 1 || loading}
                  className="h-10 min-w-20 rounded-xl border border-[#DCCBFA] bg-white px-4 text-sm font-black text-[#7427D9] transition hover:border-[#B98AF5] hover:bg-[#F7F2FF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  السابق
                </button>
                <span className="min-w-28 rounded-xl bg-[#F1E8FF] px-4 py-2.5 text-center text-sm font-black text-[#6F22D6]">
                  صفحة {currentPage} من {totalPages}
                </span>
                <button
                  type="button"
                  onClick={onNextPage}
                  disabled={currentPage >= totalPages || loading}
                  className="h-10 min-w-20 rounded-xl bg-[#8B35F5] px-4 text-sm font-black text-white shadow-[0_8px_20px_rgba(139,53,245,0.22)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:bg-[#D9C2F6] disabled:shadow-none"
                >
                  التالي
                </button>
              </div>
            </div>
          )}
        </section>
        )}
      </div>

      {formOpen && (
        <AccountForm
          onAdd={onAdd}
          onUpdate={onUpdate}
          loading={loading}
          service={service}
          initialAccount={editingAccount}
          onClose={() => setFormOpen(false)}
        />
      )}
      {editingCustomerBalance && (
        <CustomerBalanceModal
          link={editingCustomerBalance}
          onClose={() => setEditingCustomerBalance(null)}
          onSave={onUpdateCustomerCodeBalance}
        />
      )}
    </div>
  );
}

function CustomerBalanceModal({
  link,
  onClose,
  onSave,
}: {
  link: CustomerLink;
  onClose: () => void;
  onSave: (linkId: string, codeRequestLimit: number, resetRequestedCount: boolean) => Promise<boolean>;
}) {
  const [limit, setLimit] = useState(String(link.code_request_limit ?? 1));
  const [saving, setSaving] = useState(false);
  const currentLimit = Math.max(0, link.code_request_limit ?? 1);
  const currentUsed = Math.max(0, link.code_requested_count ?? 0);
  const currentRemaining = Math.max(0, currentLimit - currentUsed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[2rem] border border-[#E4D6FA] bg-white p-6 shadow-premium-lg" role="dialog" aria-modal="true">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black text-[#8B35F5]">عميل رقم #{link.link_number ?? "—"}</p>
            <h2 className="mt-1 text-2xl font-black text-zinc-950">تعديل رصيد الأكواد</h2>
            <p className="mt-2 text-sm font-bold text-zinc-500">الرصيد المتبقي: {currentRemaining}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E4D6FA] text-zinc-500 transition hover:bg-[#F8F4FF]"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-black text-zinc-700">رفع حد المحاولات</span>
          <input
            type="number"
            min="0"
            step="1"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="admin-modal-input"
          />
        </label>

        <p className="mt-4 rounded-2xl border border-[#E4D6FA] bg-[#FCFAFF] p-4 text-sm font-bold text-zinc-600">
          الرقم المدخل سيصبح الرصيد المتاح مباشرة، وسيتم تصفير المحاولات المستهلكة تلقائياً.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl border border-[#E4D6FA] px-5 text-sm font-black text-zinc-600 transition hover:bg-zinc-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={saving || limit.trim() === ""}
            onClick={async () => {
              const numericLimit = Number(limit);
              if (!Number.isInteger(numericLimit) || numericLimit < 0) return;
              setSaving(true);
              const succeeded = await onSave(link.id, numericLimit, true);
              setSaving(false);
              if (succeeded) onClose();
            }}
            className="h-12 flex-1 rounded-xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.22)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "جاري الحفظ..." : "حفظ الرصيد"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  stat,
  index,
}: {
  stat: { label: string; value: number; icon: LucideIcon; tone: StatTone };
  index: number;
}) {
  const toneClass = {
    neutral: "bg-[#F4EDFF] text-[#8B35F5]",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-rose-50 text-rose-500",
  }[stat.tone];

  const valueClass = {
    neutral: "text-[#8B35F5]",
    green: "text-emerald-600",
    red: "text-rose-500",
  }[stat.tone];

  return (
    <article
      className="animate-rise rounded-2xl border border-[#ECE5F6] bg-white p-5 shadow-[0_12px_34px_rgba(70,40,120,0.08)] transition duration-300 hover:-translate-y-1 hover:border-[#DCC9FA] hover:shadow-[0_18px_42px_rgba(70,40,120,0.12)]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={cn("text-4xl font-black leading-none", valueClass)}>{stat.value}</p>
          <p className="mt-5 text-sm font-extrabold text-zinc-600">{stat.label}</p>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl border border-white shadow-sm", toneClass)}>
          <stat.icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function AccountCard({
  account,
  index,
  onSelect,
  onEdit,
  onDelete,
  onCopyTemporaryLink,
  onCopyAllLinks,
  onResetCompensationLinks,
  onOpenSupplierCode,
}: {
  account: NetflixAccount;
  index: number;
  onSelect: (id: string) => void;
  onEdit: (account: NetflixAccount) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTemporaryLink: (account: NetflixAccount) => void;
  onCopyAllLinks: (accountId: string) => Promise<void>;
  onResetCompensationLinks: (accountId: string) => Promise<void>;
  onOpenSupplierCode: (url: string) => void;
}) {
  const expired = isExpired(account.expires_at);
  const canOpenSupplierCode = Boolean(account.supplier_code_url);

  return (
    <article
      className="group min-w-0 animate-rise rounded-2xl border border-[#E9E0F5] bg-white p-3 text-right shadow-[0_10px_28px_rgba(70,40,120,0.07)] transition duration-300 hover:-translate-y-0.5 hover:border-[#D5BDF6] sm:p-4"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="mb-3 min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-all text-[15px] font-black leading-6 text-[#17141F] sm:text-lg" dir="ltr">
              {account.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyTextSilent(account.email)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-[#E0D4F8] bg-[#F8F4FF] px-2 text-[11px] font-black text-[#7C2CE8] transition hover:bg-[#F1E9FF]"
          >
            <Clipboard className="h-3.5 w-3.5" />
            نسخ
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-black",
              expired ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-600",
            )}
          >
            {expired ? <CircleX className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
            {expired ? "منتهي" : "فعال"}
          </span>
          <span className="rounded-full border border-[#DCC9FA] bg-[#F4EDFF] px-3 py-1 text-xs font-black text-[#6F22D6]">
            {accountTypeLabel(account.account_type)}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-[#E8DDF8] bg-[#FAF8FD] p-3">
          <p className="text-xs font-black text-zinc-400">كلمة المرور</p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 break-all text-left text-[15px] font-black leading-6 text-zinc-900" dir="ltr">
              {account.password}
            </p>
            <button
              type="button"
              onClick={() => void copyTextSilent(account.password)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E0D4F8] bg-white text-[#7C2CE8] transition hover:bg-[#F4EDFF]"
              title="نسخ كلمة المرور"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-[#E8DDF8] bg-white p-3">
          <p className="text-xs font-black text-zinc-400">تاريخ الانتهاء</p>
          <p className="mt-2 truncate text-[15px] font-black text-zinc-900">{formatDate(account.expires_at)}</p>
          <p className={cn("mt-1 text-xs font-black", expired ? "text-amber-700" : "text-emerald-600")}>
            {remainingLabel(account.expires_at)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {account.account_type === "temporary" && account.temporary_short_id && (
          <button
            type="button"
            onClick={() => onCopyTemporaryLink(account)}
            title="نسخ رابط الحساب المؤقت"
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8B35F5] px-3 text-xs font-black text-white transition hover:bg-[#7626DD]"
          >
            <Link2 className="h-4 w-4" />
            نسخ الرابط
          </button>
        )}
        <button
          type="button"
          onClick={() => void onSelect(account.id)}
          title="فتح تفاصيل الحساب"
          className={cn(
            "flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl text-xs font-black transition",
            account.account_type === "temporary"
              ? "w-11 shrink-0 border border-[#DDCEF4] text-[#7C2CE8] hover:bg-[#F4EDFF]"
              : "flex-1 bg-[#8B35F5] text-white hover:bg-[#7626DD]",
          )}
        >
          <Eye className="h-4 w-4" />
          التفاصيل
        </button>
        <button
          type="button"
          onClick={() => onEdit(account)}
          title="تعديل الحساب"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#DDCEF4] text-[#7C2CE8] transition hover:bg-[#F4EDFF]"
        >
          <Edit3 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void onCopyAllLinks(account.id)}
          title="نسخ جميع الروابط"
          aria-label="نسخ جميع الروابط"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#DDCEF4] text-[#7C2CE8] transition hover:bg-[#F4EDFF]"
        >
          <Clipboard className="h-4 w-4" />
        </button>
        {account.account_type === "compensation" && account.compensation_distribution === "shared" && (
          <button
            type="button"
            onClick={() => void onResetCompensationLinks(account.id)}
            title="إعادة تعيين الروابط"
            aria-label="إعادة تعيين الروابط"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenSupplierCode(account.supplier_code_url || "")}
          disabled={!canOpenSupplierCode}
          title="فتح رابط الأكواد"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#DDCEF4] text-[#7C2CE8] transition hover:bg-[#F4EDFF] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void onDelete(account.id)}
          title="حذف الحساب"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-100 text-rose-500 transition hover:bg-rose-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function AccountRow({
  account,
  index,
  onSelect,
  onEdit,
  onDelete,
  onCopyTemporaryLink,
  onCopyAllLinks,
  onResetCompensationLinks,
  onOpenSupplierCode,
}: {
  account: NetflixAccount;
  index: number;
  onSelect: (id: string) => void;
  onEdit: (account: NetflixAccount) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTemporaryLink: (account: NetflixAccount) => void;
  onCopyAllLinks: (accountId: string) => Promise<void>;
  onResetCompensationLinks: (accountId: string) => Promise<void>;
  onOpenSupplierCode: (url: string) => void;
}) {
  const expired = isExpired(account.expires_at);
  const canOpenSupplierCode = Boolean(account.supplier_code_url);
  const service = serviceOf(account);

  return (
    <tr
      className="animate-rise border-b border-[#F0EAF7] text-base transition hover:bg-[#FCFAFF]"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <td className="px-5 py-5">
        <div className="flex min-w-0 items-start gap-3 text-right">
          <button
            type="button"
            onClick={() => onSelect(account.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2E9FF] text-[#7D2DE8] transition hover:bg-[#E8DAFF]"
            title="فتح التفاصيل"
          >
            <UserRound className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyTextSilent(account.email)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E0D4F8] bg-[#F8F4FF] text-[#7C2CE8] transition hover:bg-[#F1E9FF]"
                title="نسخ البريد"
              >
                <Copy className="h-4 w-4" />
              </button>
              <span className="block min-w-0 flex-1 truncate rounded-lg bg-[#FAF8FD] px-3 py-2 text-left text-[15px] font-black text-zinc-800" dir="ltr">
                {account.email}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyTextSilent(account.password)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E0D4F8] bg-[#F8F4FF] text-[#7C2CE8] transition hover:bg-[#F1E9FF]"
                title="نسخ كلمة المرور"
              >
                <Copy className="h-4 w-4" />
              </button>
              <span className="block min-w-0 flex-1 truncate rounded-lg bg-[#FAF8FD] px-3 py-2 text-left text-[15px] font-black text-zinc-800" dir="ltr">
                {account.password}
              </span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-5">
        <div className="flex flex-col items-start gap-1.5">
          <span className="rounded-full bg-[#F1E9FF] px-3 py-1 text-xs font-black text-[#6F22D6]">
            {accountTypeLabel(account.account_type)}
          </span>
          <span className={cn("text-[11px] font-black", service === "shahid" ? "text-cyan-600" : service === "osn" ? "text-fuchsia-700" : "text-[#8B35F5]")}>
            {service === "shahid" ? "شاهد" : service === "osn" ? "OSN" : "Netflix"}
          </span>
        </div>
      </td>
      <td className="px-4 py-5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black",
            expired ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-600",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", expired ? "bg-amber-500" : "bg-emerald-500")} />
          {expired ? "منتهي" : "فعال"}
        </span>
      </td>
      <td className="px-4 py-5 text-[15px] font-bold text-zinc-700">{formatDate(account.expires_at)}</td>
      <td className="px-4 py-5">
        <span className={cn("text-sm font-black", expired ? "text-amber-700" : "text-emerald-600")}>
          {remainingLabel(account.expires_at)}
        </span>
      </td>
      <td className="px-5 py-5">
        <div className="flex items-center justify-center gap-1.5">
          {account.account_type === "temporary" && account.temporary_short_id && (
            <button
              type="button"
              onClick={() => onCopyTemporaryLink(account)}
              title="نسخ رابط الحساب المؤقت"
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#8B35F5] px-3 text-xs font-black text-white transition hover:bg-[#7626DD]"
            >
              <Link2 className="h-4 w-4" />
              نسخ الرابط
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect(account.id)}
            title="فتح التفاصيل"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7C2CE8] transition hover:bg-[#F2E9FF]"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onCopyAllLinks(account.id)}
            title="نسخ جميع الروابط"
            aria-label="نسخ جميع الروابط"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7C2CE8] transition hover:bg-[#F2E9FF]"
          >
            <Clipboard className="h-4 w-4" />
          </button>
          {account.account_type === "compensation" && account.compensation_distribution === "shared" && (
            <button
              type="button"
              onClick={() => void onResetCompensationLinks(account.id)}
              title="إعادة تعيين الروابط"
              aria-label="إعادة تعيين الروابط"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-amber-700 transition hover:bg-amber-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(account)}
            title="تعديل الحساب"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-[#F2E9FF] hover:text-[#7C2CE8]"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onOpenSupplierCode(account.supplier_code_url || "")}
            disabled={!canOpenSupplierCode}
            title="فتح رابط الأكواد"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-[#F2E9FF] hover:text-[#7C2CE8] disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onDelete(account.id)}
            title="حذف الحساب"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CompensationAdminPage({
  service,
  onBack,
  onLogout,
  setToast,
}: {
  service: ServiceType;
  onBack: () => void;
  onLogout: () => void;
  setToast: (toast: Toast) => void;
}) {
  const [requests, setRequests] = useState<CompensationRequest[]>([]);
  const [availableLinks, setAvailableLinks] = useState<CompensationPoolLink[]>([]);
  const [availableCounts, setAvailableCounts] = useState({ private: 0, shared: 0, unclassified: 0, total: 0 });
  const [pendingCounts, setPendingCounts] = useState({ private: 0, shared: 0, unknown: 0 });
  const [privateLinksInput, setPrivateLinksInput] = useState("");
  const [sharedLinksInput, setSharedLinksInput] = useState("");
  const [showDistributionModal, setShowDistributionModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  async function callAdminApi(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch("/api/admin-compensations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      const apiError = new Error(payload?.error || "operation_failed");
      (apiError as Error & { code?: string }).code = payload?.error;
      throw apiError;
    }
    return payload;
  }

  function applySnapshot(payload: {
    requests?: CompensationRequest[];
    available_links?: CompensationPoolLink[];
    available_count?: number;
    available_counts?: { private?: number; shared?: number; unclassified?: number; total?: number };
    pending_counts?: { private?: number; shared?: number; unknown?: number };
  }) {
    setRequests(Array.isArray(payload.requests) ? payload.requests : []);
    setAvailableLinks(Array.isArray(payload.available_links) ? payload.available_links : []);
    setAvailableCounts({
      private: Number(payload.available_counts?.private || 0),
      shared: Number(payload.available_counts?.shared || 0),
      unclassified: Number(payload.available_counts?.unclassified || 0),
      total: Number(payload.available_counts?.total || payload.available_count || 0),
    });
    setPendingCounts({
      private: Number(payload.pending_counts?.private || 0),
      shared: Number(payload.pending_counts?.shared || 0),
      unknown: Number(payload.pending_counts?.unknown || 0),
    });
  }

  async function loadRequests() {
    setLoading(true);
    try {
      applySnapshot(await callAdminApi("list"));
    } catch (loadError) {
      console.error("Compensation dashboard loading failed:", loadError);
      setToast({ label: "تعذر تحميل طلبات التعويض", tone: "error", at: Date.now() });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  async function importLinks(linkType: "private" | "shared") {
    const input = linkType === "private" ? privateLinksInput : sharedLinksInput;
    const links = input
      .split(/\r?\n|,/)
      .map((link) => link.trim())
      .filter(Boolean);
    if (links.length === 0) {
      setToast({ label: "أدخل رابطاً واحداً على الأقل", tone: "error", at: Date.now() });
      return;
    }

    setProcessing(`import-${linkType}`);
    try {
      const payload = await callAdminApi("import_links", { links, link_type: linkType });
      applySnapshot(payload);
      if (linkType === "private") setPrivateLinksInput("");
      else setSharedLinksInput("");
      setToast({
        label: `تمت إضافة ${Number(payload.imported_count || 0)} رابط ${linkType === "private" ? "خاص" : "مشترك"}`,
        at: Date.now(),
      });
    } catch (importError) {
      console.error("Compensation links import failed:", importError);
      setToast({ label: "تعذر استيراد الروابط، تأكد من صحتها", tone: "error", at: Date.now() });
    } finally {
      setProcessing(null);
    }
  }

  async function assignLink(requestId: string) {
    setProcessing(requestId);
    try {
      applySnapshot(await callAdminApi("assign", { request_id: requestId }));
      setToast({ label: "تم إسناد رابط التعويض بنجاح", at: Date.now() });
    } catch (assignError) {
      console.error("Compensation assignment failed:", assignError);
      const errorCode = (assignError as Error & { code?: string }).code;
      const noLinks = errorCode === "no_available_links";
      const unknownType = errorCode === "request_account_type_not_found";
      setToast({
        label: noLinks
          ? "لا توجد روابط تعويض متاحة من النوع المطابق"
          : unknownType
            ? "تعذر تحديد نوع الحساب؛ لم يتم تعديل الطلب"
            : "تعذر إسناد رابط التعويض",
        tone: "error",
        at: Date.now(),
      });
    } finally {
      setProcessing(null);
    }
  }

  async function deleteAvailableLink(linkId: string) {
    if (!window.confirm("هل أنت متأكد من حذف هذا الرابط من المخزن؟")) return;

    setProcessing(`delete-link-${linkId}`);
    try {
      const payload = await callAdminApi("delete_available_link", { link_id: linkId });
      applySnapshot(payload);
      setToast({ label: "تم حذف الرابط من المخزن", at: Date.now() });
    } catch (deleteError) {
      console.error("Available compensation link deletion failed:", deleteError);
      const errorCode = (deleteError as Error & { code?: string }).code;
      setToast({
        label: errorCode === "link_not_available"
          ? "هذا الرابط لم يعد متاحاً للحذف"
          : "تعذر حذف الرابط من المخزن",
        tone: "error",
        at: Date.now(),
      });
    } finally {
      setProcessing(null);
    }
  }

  async function deleteAllAvailableLinks(linkType: "private" | "shared") {
    if (!window.confirm("هل أنت متأكد من حذف جميع الروابط غير الموزعة من هذا المخزن؟")) return;

    setProcessing(`delete-all-${linkType}`);
    try {
      const payload = await callAdminApi("delete_all_available_links", { link_type: linkType });
      applySnapshot(payload);
      setToast({
        label: `تم حذف ${Number(payload.deleted_count || 0)} رابط غير مسند`,
        at: Date.now(),
      });
    } catch (deleteError) {
      console.error("Available compensation links deletion failed:", deleteError);
      setToast({ label: "تعذر حذف الروابط غير المسندة", tone: "error", at: Date.now() });
    } finally {
      setProcessing(null);
    }
  }

  async function distributeLinks(mode: "private" | "shared" | "all") {
    setProcessing(`distribute-${mode}`);
    try {
      const payload = await callAdminApi("distribute", { mode });
      applySnapshot(payload);
      setShowDistributionModal(false);
      const remainingPrivate = Number(payload.remaining_counts?.private || 0);
      const remainingShared = Number(payload.remaining_counts?.shared || 0);
      const remainingText = remainingPrivate || remainingShared
        ? `، المتبقي: ${remainingPrivate} خاص و${remainingShared} مشترك`
        : "";
      setToast({
        label: `تم توزيع ${Number(payload.assigned_count || 0)} رابط${remainingText}`,
        tone: remainingText ? "error" : "success",
        at: Date.now(),
      });
    } catch (distributionError) {
      console.error("Compensation distribution failed:", distributionError);
      setToast({ label: "تعذر توزيع الروابط", tone: "error", at: Date.now() });
    } finally {
      setProcessing(null);
    }
  }

  const pendingCount = requests.filter((request) => request.status === "pending").length;
  const completedCount = requests.length - pendingCount;

  return (
    <div className="min-h-screen bg-[#FAF9FC] text-[#17141F]">
      <Header service={service} onBack={onBack} onLogout={onLogout} />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-7 md:px-8 md:py-10">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black text-[#8B35F5]">إدارة التعويضات</p>
            <h1 className="mt-1 text-2xl font-black md:text-3xl">طلبات التعويض</h1>
            <p className="mt-2 text-sm font-bold text-zinc-500">أدر مخزون الروابط ووزعه على الطلبات المعلقة بأمان.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/compensation"
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
            >
              <ExternalLink className="h-4 w-4" />
              فتح صفحة العميل
            </a>
            <button
              type="button"
              onClick={onBack}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
            >
              <ArrowRight className="h-4 w-4" />
              العودة للحسابات
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "طلبات معلقة", value: pendingCount, tone: "text-amber-700 bg-amber-100" },
            { label: "تم تعويضها", value: completedCount, tone: "text-emerald-700 bg-emerald-100" },
            { label: "روابط خاصة متاحة", value: availableCounts.private, tone: "text-[#7C2CE8] bg-[#F1E7FF]" },
            { label: "روابط مشتركة متاحة", value: availableCounts.shared, tone: "text-sky-700 bg-sky-100" },
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-[#E8DCFF] bg-white p-5 shadow-[0_16px_44px_rgba(70,40,120,0.08)]">
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", item.tone)}>
                <Link2 className="h-5 w-5" />
              </div>
              <p className="mt-4 text-3xl font-black">{item.value}</p>
              <p className="mt-1 text-sm font-black text-zinc-500">{item.label}</p>
            </div>
          ))}
        </div>

        <section className="mb-6 rounded-3xl border border-[#E8DCFF] bg-white p-5 shadow-[0_18px_50px_rgba(70,40,120,0.09)] md:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-black">مخزن الروابط التعويضية</h2>
            <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">كل مخزن مستقل، ولن يُسند أي رابط إلا لطلب يطابق نوع حسابه.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {([
              {
                type: "private" as const,
                title: "روابط تعويض حسابات خاصة",
                value: privateLinksInput,
                setValue: setPrivateLinksInput,
                count: availableCounts.private,
              },
              {
                type: "shared" as const,
                title: "روابط تعويض حسابات مشتركة",
                value: sharedLinksInput,
                setValue: setSharedLinksInput,
                count: availableCounts.shared,
              },
            ]).map((pool) => (
              <div key={pool.type} className="rounded-2xl border border-[#E8DCFF] bg-[#FCFAFF] p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-black">{pool.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void deleteAllAvailableLinks(pool.type)}
                      disabled={processing !== null || pool.count === 0}
                      title="حذف الكل غير المسند"
                      className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {processing === `delete-all-${pool.type}` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      حذف الكل غير المسند
                    </button>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-[#7C2CE8] shadow-sm">متاح: {pool.count}</span>
                  </div>
                </div>
                <textarea
                  value={pool.value}
                  onChange={(event) => pool.setValue(event.target.value)}
                  placeholder={"ألصق الروابط هنا، كل رابط في سطر منفصل\nhttps://tv-zone.vercel.app/v/example"}
                  dir="ltr"
                  className="min-h-32 w-full resize-y rounded-2xl border-2 border-[#DCCBFA] bg-white p-4 text-left text-sm font-bold leading-7 outline-none transition focus:border-[#8B35F5]"
                />
                <button
                  type="button"
                  onClick={() => void importLinks(pool.type)}
                  disabled={processing !== null}
                  className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-[#F8F4FF] px-4 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F1E7FF] disabled:opacity-50"
                >
                  {processing === `import-${pool.type}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  استيراد {pool.type === "private" ? "الروابط الخاصة" : "الروابط المشتركة"}
                </button>
                <div className="mt-4 border-t border-[#E8DCFF] pt-4">
                  <p className="mb-2 text-xs font-black text-zinc-500">الروابط المتاحة غير المسندة</p>
                  {availableLinks.filter((link) => link.account_type === pool.type).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#DCCBFA] bg-white px-3 py-5 text-center text-xs font-bold text-zinc-400">
                      لا توجد روابط متاحة في هذا المخزن
                    </div>
                  ) : (
                    <div className="max-h-52 space-y-2 overflow-y-auto pe-1">
                      {availableLinks
                        .filter((link) => link.account_type === pool.type)
                        .map((link) => (
                          <div key={link.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-[#E8DCFF] bg-white p-2">
                            <span className="min-w-0 flex-1 truncate text-left text-xs font-bold text-zinc-600" dir="ltr" title={link.replacement_link}>
                              {link.replacement_link}
                            </span>
                            <button
                              type="button"
                              onClick={() => void deleteAvailableLink(link.id)}
                              disabled={processing !== null}
                              title="حذف الرابط غير المسند"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {processing === `delete-link-${link.id}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#E8DCFF] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black">التوزيع المطابق لنوع الحساب</p>
              <p className="mt-1 text-xs font-bold text-zinc-500">معلق: {pendingCounts.private} خاص، {pendingCounts.shared} مشترك</p>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setShowDistributionModal(true)}
                disabled={processing !== null || pendingCount === 0 || (availableCounts.private + availableCounts.shared) === 0}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.25)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
              >
                <Link2 className="h-4 w-4" />
                توزيع المتاح تلقائياً
              </button>
            </div>
          </div>
          {availableCounts.unclassified > 0 && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black text-amber-800">
              يوجد {availableCounts.unclassified} رابط قديم غير مصنف. لم يتم تغييره أو استخدامه حفاظاً على البيانات السابقة.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-[#E8DCFF] bg-white shadow-[0_18px_50px_rgba(70,40,120,0.09)]">
          <div className="flex items-center justify-between border-b border-[#EEE7F8] px-5 py-4 md:px-6">
            <div>
              <h2 className="text-lg font-black">سجل الطلبات</h2>
              <p className="mt-1 text-xs font-bold text-zinc-500">{requests.length} طلب إجمالاً</p>
            </div>
            <button
              type="button"
              onClick={() => void loadRequests()}
              disabled={loading}
              title="تحديث"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#DCCBFA] text-[#7C2CE8] transition hover:bg-[#F8F4FF] disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>

          {loading && requests.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-[#8B35F5]" /></div>
          ) : requests.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <Inbox className="h-10 w-10 text-[#B58BEF]" />
              <h3 className="mt-3 text-lg font-black">لا توجد طلبات تعويض حتى الآن</h3>
            </div>
          ) : (
            <div className="divide-y divide-[#EEE7F8]">
              {requests.map((request) => (
                <article key={request.id} className="grid gap-4 p-5 transition hover:bg-[#FCFAFF] md:grid-cols-[150px_1fr_160px_190px] md:items-center md:px-6">
                  <div>
                    <p className="text-xs font-bold text-zinc-500">رمز التعويض</p>
                    <p className="mt-1 text-lg font-black text-[#7C2CE8]" dir="ltr">{request.client_code}</p>
                    <span className={cn(
                      "mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-black",
                      request.account_type === "private"
                        ? "bg-violet-100 text-violet-700"
                        : request.account_type === "shared"
                          ? "bg-sky-100 text-sky-700"
                          : "bg-zinc-100 text-zinc-500",
                    )}>
                      {request.account_type === "private" ? "حساب خاص" : request.account_type === "shared" ? "حساب مشترك" : "النوع غير معروف"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-500">تاريخ الطلب</p>
                    <p className="mt-1 text-sm font-black">{formatDateTime(request.created_at)}</p>
                    {request.replacement_link && (
                      <button
                        type="button"
                        onClick={() => void copyTextSilent(request.replacement_link || "")}
                        className="mt-2 flex max-w-full items-center gap-2 text-xs font-black text-[#7C2CE8]"
                      >
                        <Copy className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" dir="ltr">{request.replacement_link}</span>
                      </button>
                    )}
                  </div>
                  <div>
                    <span className={cn(
                      "inline-flex rounded-full px-3 py-1.5 text-xs font-black",
                      request.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                    )}>
                      {request.status === "completed" ? "تم التعويض" : "قيد المراجعة"}
                    </span>
                  </div>
                  <div>
                    {request.status === "pending" ? (
                      <button
                        type="button"
                        onClick={() => void assignLink(request.id)}
                        disabled={
                          processing !== null ||
                          !request.account_type ||
                          (request.account_type === "private" ? availableCounts.private : availableCounts.shared) === 0
                        }
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8B35F5] px-4 text-sm font-black text-white transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {processing === request.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                        إسناد تعويض
                      </button>
                    ) : (
                      <a
                        href={request.replacement_link || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700"
                      >
                        <ExternalLink className="h-4 w-4" />
                        فتح الرابط
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {showDistributionModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#17141F]/70 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="اختيار نوع توزيع التعويضات"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !processing) setShowDistributionModal(false);
            }}
          >
            <div className="w-full max-w-lg rounded-3xl border border-[#DCCBFA] bg-white p-5 shadow-[0_30px_90px_rgba(20,10,35,0.28)] md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black text-[#8B35F5]">توزيع مطابق وآمن</p>
                  <h2 className="mt-1 text-xl font-black">اختر نوع التعويضات</h2>
                  <p className="mt-2 text-xs font-bold leading-6 text-zinc-500">يتم فحص نوع الحساب للطلبات المعلقة بالقراءة فقط، ثم يُسند رابط من المخزن المطابق.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDistributionModal(false)}
                  disabled={processing !== null}
                  title="إغلاق"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E8DCFF] text-zinc-500 hover:bg-[#F8F4FF]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                {([
                  {
                    mode: "private" as const,
                    title: "توزيع التعويضات الخاصة",
                    detail: `${pendingCounts.private} طلب معلق / ${availableCounts.private} رابط متاح`,
                    disabled: pendingCounts.private === 0 || availableCounts.private === 0,
                  },
                  {
                    mode: "shared" as const,
                    title: "توزيع التعويضات المشتركة",
                    detail: `${pendingCounts.shared} طلب معلق / ${availableCounts.shared} رابط متاح`,
                    disabled: pendingCounts.shared === 0 || availableCounts.shared === 0,
                  },
                  {
                    mode: "all" as const,
                    title: "توزيع الكل بشرط مطابقة النوع",
                    detail: "الخاص للخاص والمشترك للمشترك فقط",
                    disabled:
                      (pendingCounts.private === 0 || availableCounts.private === 0) &&
                      (pendingCounts.shared === 0 || availableCounts.shared === 0),
                  },
                ]).map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => void distributeLinks(option.mode)}
                    disabled={processing !== null || option.disabled}
                    className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-[#DCCBFA] bg-[#FCFAFF] px-4 py-3 text-right transition hover:border-[#8B35F5] hover:bg-[#F6F0FF] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span>
                      <span className="block text-sm font-black">{option.title}</span>
                      <span className="mt-1 block text-xs font-bold text-zinc-500">{option.detail}</span>
                    </span>
                    {processing === `distribute-${option.mode}` ? (
                      <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-[#8B35F5]" />
                    ) : (
                      <ArrowLeft className="h-5 w-5 shrink-0 text-[#8B35F5]" />
                    )}
                  </button>
                ))}
              </div>

              {pendingCounts.unknown > 0 && (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black leading-6 text-amber-800">
                  يوجد {pendingCounts.unknown} طلب تعذر تحديد نوعه. لن يتم تغييره أو إسناد رابط له تلقائياً.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExtraCreditRequestsPage({
  requests,
  service,
  loading,
  onBack,
  onReview,
  onLogout,
}: {
  requests: ExtraCreditRequest[];
  service: ServiceType;
  loading: boolean;
  onBack: () => void;
  onReview: (requestId: string, status: Exclude<ExtraCreditRequestStatus, "pending">) => Promise<boolean>;
  onLogout: () => void;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const pendingRequests = requests.filter((request) => request.status === "pending");

  async function review(requestId: string, status: Exclude<ExtraCreditRequestStatus, "pending">) {
    setProcessingId(requestId);
    await onReview(requestId, status);
    setProcessingId(null);
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC] text-[#17141F]">
      <Header service={service} onBack={onBack} onLogout={onLogout} />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-7 md:px-8 md:py-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-black text-[#8B35F5]">إدارة المراجعات</p>
            <h1 className="mt-1 text-2xl font-black md:text-3xl">طلبات الرصيد الإضافي</h1>
            <p className="mt-2 text-sm font-bold text-zinc-500">راجع سبب الطلب والإثبات قبل إضافة محاولة جديدة للعميل.</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#DCCBFA] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
          >
            <ArrowRight className="h-4 w-4" />
            العودة للحسابات
          </button>
        </div>

        {loading && pendingRequests.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center rounded-3xl border border-[#E8DCFF] bg-white shadow-card">
            <RefreshCw className="h-7 w-7 animate-spin text-[#8B35F5]" />
          </div>
        ) : pendingRequests.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-[#E8DCFF] bg-white p-8 text-center shadow-card">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1E7FF] text-[#8B35F5]">
              <Inbox className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-xl font-black">لا توجد طلبات معلقة</h2>
            <p className="mt-2 text-sm font-bold text-zinc-500">ستظهر طلبات العملاء الجديدة هنا فور إرسالها.</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {pendingRequests.map((request) => {
              const customer = request.customer_links;
              const customerEmail = customer?.accounts?.email || customer?.email || "غير متوفر";
              const customerNumber = customer?.link_number ? `#${customer.link_number}` : "غير متوفر";
              const device = customer?.selected_device === "screen" ? "شاشة / سوني" : customer?.selected_device === "mobile" ? "جوال / آيباد / بي سي" : "غير محدد";
              const isProcessing = processingId === request.id;
              const attachmentUrl = request.image_url || "";
              const isVideoAttachment =
                request.attachment_type === "video" ||
                /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(attachmentUrl.split("?")[0]);

              return (
                <article key={request.id} className="overflow-hidden rounded-3xl border border-[#E8DCFF] bg-white shadow-[0_18px_48px_rgba(70,40,120,0.10)]">
                  <div className="border-b border-[#EEE7F8] bg-[#FCFAFF] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-[#8B35F5]">عميل {customerNumber}</p>
                        <p className="mt-1 break-all text-base font-black" dir="ltr">{customerEmail}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-700">قيد المراجعة</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-[#E8DDF8] bg-white p-3">
                        <p className="text-xs font-bold text-zinc-500">نوع الجهاز</p>
                        <p className="mt-1 font-black">{device}</p>
                      </div>
                      <div className="rounded-xl border border-[#E8DDF8] bg-white p-3">
                        <p className="text-xs font-bold text-zinc-500">وقت الطلب</p>
                        <p className="mt-1 text-xs font-black">{formatDateTime(request.created_at)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <div>
                      <p className="text-xs font-bold text-zinc-500">سبب المشكلة</p>
                      <p className="mt-1 font-black text-[#7C2CE8]">{request.reason_type}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500">وصف العميل</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm font-bold leading-7 text-zinc-700">{request.description}</p>
                    </div>
                    {request.ai_decision === "processing" ? (
                      <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-800">
                        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
                        جارٍ فحص المرفق تلقائياً عبر Gemini
                      </div>
                    ) : request.ai_analysis ? (
                      <div className="rounded-2xl border border-[#DCCBFA] bg-[#F8F4FF] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-black text-[#7C2CE8]">تحليل Gemini</p>
                          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-[#6E25CF]">
                            الثقة {Math.round((request.ai_confidence || 0) * 100)}%
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-bold leading-7 text-zinc-700">{request.ai_analysis}</p>
                        {request.ai_decision === "manual_review" && (
                          <p className="mt-2 text-xs font-black text-amber-700">أحيل للمراجعة اليدوية بسبب عدم حسم الدليل آلياً.</p>
                        )}
                      </div>
                    ) : null}
                    {attachmentUrl ? (
                      <div className="overflow-hidden rounded-2xl border border-[#E8DDF8] bg-zinc-50">
                        {isVideoAttachment ? (
                          <video
                            src={attachmentUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="aspect-video w-full bg-black object-contain"
                          />
                        ) : (
                          <img src={attachmentUrl} alt="إثبات المشكلة" className="aspect-video w-full object-contain" />
                        )}
                        <a
                          href={attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-11 items-center justify-center gap-2 bg-white text-xs font-black text-[#7C2CE8] transition hover:bg-[#F8F4FF]"
                        >
                          <Eye className="h-4 w-4" />
                          {isVideoAttachment ? "فتح الفيديو في نافذة جديدة" : "فتح الصورة بالحجم الكامل"}
                        </a>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-xs font-black text-zinc-500">
                        تم حذف المرفق من التخزين بعد معالجة الطلب
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={Boolean(processingId)}
                        onClick={() => void review(request.id, "approved")}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                        قبول الطلب
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(processingId)}
                        onClick={() => void review(request.id, "rejected")}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        <CircleX className="h-4 w-4" />
                        رفض الطلب
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ service, onBack, onLogout }: { service: ServiceType; onBack: () => void; onLogout: () => void }) {
  const theme = serviceThemes[service];
  return (
    <header className="border-b border-[#EEE7F8] bg-white">
      <div className="mx-auto flex min-h-20 w-full max-w-[1280px] flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-8 md:py-0">
        <div className="flex items-center justify-between gap-5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-3 text-right"
            title="الرجوع لاختيار الخدمة"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#DFD0F6] bg-[#F7F2FF] text-[#8B35F5] shadow-[0_8px_20px_rgba(139,53,245,0.10)]">
              <LayoutDashboard className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-lg font-black leading-tight">ZONE STORE</span>
              <span className="block text-[11px] font-bold text-zinc-500">{theme.title}</span>
            </span>
          </button>

          <nav className="hidden items-center gap-2 border-r border-[#EEE7F8] pr-5 md:flex">
            <button className="flex h-10 items-center gap-2 rounded-lg bg-[#8B35F5] px-4 text-xs font-black text-white">
              <Users className="h-4 w-4" />
              إدارة الحسابات
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-black text-zinc-500 transition hover:bg-[#F7F2FF] hover:text-[#7C2CE8]"
            >
              <Settings className="h-4 w-4" />
              الخدمات
            </button>
          </nav>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#F0EAF7] pt-3 md:border-0 md:pt-0">
          <div className="text-left">
            <p className="text-xs font-black text-zinc-700" dir="ltr">{adminEmail}</p>
            <p className="mt-0.5 text-[10px] font-bold text-zinc-400">حساب المسؤول</p>
          </div>
          <span className="h-8 w-px bg-[#EEE7F8]" />
          <button
            onClick={onLogout}
            className="flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-black text-zinc-500 transition hover:bg-[#F5EEFF] hover:text-[#7C2CE8]"
          >
            <LogOut className="h-4 w-4" />
            خروج
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1E7FF] text-sm font-black text-[#7C2CE8]">
            Z
          </div>
        </div>
      </div>
    </header>
  );
}

function ConfigNotice() {
  return (
    <div className="mb-6 rounded-3xl border border-[#E4D6FA] bg-[#F7F2FF] p-4 text-sm font-bold leading-7 text-[#5F2AC8] shadow-card">
      التطبيق يعمل الآن بوضع معاينة محلي. أضف `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` في ملف `.env`
      ثم شغل جداول Supabase الموجودة في `supabase/schema.sql` لتفعيل التخزين الحقيقي.
    </div>
  );
}

function AccountForm({
  onAdd,
  onUpdate,
  loading,
  service,
  initialAccount,
  onClose,
}: {
  onAdd: (form: AccountCreateForm) => Promise<AccountFormResult>;
  onUpdate: (
    accountId: string,
    form: { email: string; password: string; supplier_code_url?: string | null; code_fetch_method?: CodeFetchMethod; compensation_tutorial_url?: string | null },
  ) => Promise<AccountFormResult>;
  loading: boolean;
  service: ServiceType;
  initialAccount: NetflixAccount | null;
  onClose: () => void;
}) {
  const editing = Boolean(initialAccount);
  const [accountType, setAccountType] = useState<AccountType>(initialAccount?.account_type || "private");
  const [email, setEmail] = useState(initialAccount?.email || "");
  const [password, setPassword] = useState(initialAccount?.password || "");
  const [supplierCodeUrl, setSupplierCodeUrl] = useState(initialAccount?.supplier_code_url || "");
  const [externalCodeLinkEnabled, setExternalCodeLinkEnabled] = useState(
    initialAccount?.code_fetch_method === "external_link",
  );
  const [compensationTutorialUrl, setCompensationTutorialUrl] = useState(initialAccount?.compensation_tutorial_url || "");
  const [formError, setFormError] = useState("");
  const [showCompensationDistribution, setShowCompensationDistribution] = useState(false);
  const calculatedExpiry = defaultExpiryDate();
  const theme = serviceThemes[service];
  const canConfigureCodeFetch = service === "netflix" && (accountType === "private" || accountType === "shared");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const supplier_code_url = supplierCodeUrl.trim() || undefined;
    const cleanEmail = normalizeEmail(email);
    const usingExternalLink = canConfigureCodeFetch && externalCodeLinkEnabled;

    if (!cleanEmail) {
      setFormError(emptyEmailMessage);
      return;
    }

    if (usingExternalLink && !supplier_code_url) {
      setFormError("أدخل رابط جلب الكود الخارجي قبل حفظ الحساب.");
      return;
    }
    if (usingExternalLink && supplier_code_url && !isValidHttpUrl(supplier_code_url)) {
      setFormError("رابط جلب الكود غير صحيح. يجب أن يبدأ بـ https:// أو http://.");
      return;
    }


    if (accountType === "compensation" && !supplier_code_url) {
      setFormError("أدخل رابط جلب الكود قبل متابعة إنشاء حساب التعويضات.");
      return;
    }
    if (accountType === "compensation" && supplier_code_url && !isValidHttpUrl(supplier_code_url)) {
      setFormError("رابط جلب الكود غير صحيح. يجب أن يبدأ بـ https:// أو http://.");
      return;
    }
    if (accountType === "compensation" && compensationTutorialUrl.trim() && !isValidHttpUrl(compensationTutorialUrl.trim())) {
      setFormError("رابط فيديو الشرح غير صحيح. يجب أن يبدأ بـ https:// أو http://.");
      return;
    }

    if (!initialAccount) {
      if (accountType === "compensation") {
        setShowCompensationDistribution(true);
        return;
      }
      submitNewAccount();
      return;
    }

    const result = await onUpdate(initialAccount.id, {
      email: cleanEmail,
      password,
      supplier_code_url: canConfigureCodeFetch ? (usingExternalLink ? supplier_code_url : null) : supplier_code_url,
      code_fetch_method: canConfigureCodeFetch ? (usingExternalLink ? "external_link" : "auto_fetch") : undefined,
      compensation_tutorial_url: accountType === "compensation" ? compensationTutorialUrl.trim() || null : undefined,
    });

    if (accountFormSucceeded(result)) {
      onClose();
    } else {
      setFormError(accountFormError(result) || "تعذر حفظ الحساب، حاول مرة أخرى");
    }
  }

  function submitNewAccount(compensationDistribution?: CompensationDistribution) {
    const cleanEmail = normalizeEmail(email);
    const useExternalLink = service === "netflix" && externalCodeLinkEnabled;
    const supplier_code_url = useExternalLink ? supplierCodeUrl.trim() || undefined : undefined;
    onClose();
    void onAdd({
      email: cleanEmail,
      password,
      account_type: accountType,
      supplier_code_url,
      code_fetch_method: service === "netflix" ? (useExternalLink ? "external_link" : "auto_fetch") : undefined,
      compensation_tutorial_url: accountType === "compensation" ? compensationTutorialUrl.trim() || undefined : undefined,
      compensation_distribution: accountType === "compensation" ? compensationDistribution : undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#17141F]/70 px-4 py-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "تعديل الحساب" : "إضافة حساب جديد"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="animate-rise max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#DCC9FA] bg-white p-5 shadow-[0_30px_90px_rgba(20,10,35,0.28)] scrollbar-thin md:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8B35F5]">ZONE STORE</p>
            <h2 className="mt-2 text-2xl font-black md:text-3xl">
              {editing ? "تعديل بيانات الحساب" : "إضافة حساب جديد"}
            </h2>
            <p className="mt-1 text-xs font-bold text-zinc-500">
              {editing ? "حدّث البيانات الأساسية دون تغيير روابط العملاء الحالية." : `إنشاء حساب ${theme.name} وروابط العملاء تلقائياً.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            title="إغلاق"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E7DDF5] text-zinc-500 transition hover:bg-[#F5EEFF] hover:text-[#7C2CE8]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5">
          <p className="mb-2 text-sm font-black text-zinc-700">نوع الحساب</p>
          <div className={cn(
            "grid rounded-2xl border-2 border-[#E0D0FB] bg-[#F8F4FF] p-1.5",
            "sm:grid-cols-2",
          )}>
            {(editing
              ? ([accountType] as AccountType[])
              : (["private", "shared"] as AccountType[])
            ).map((type) => (
              <button
                key={type}
                type="button"
                disabled={editing}
                onClick={() => setAccountType(type)}
                className={cn(
                  "h-12 rounded-xl text-sm font-black transition duration-300 disabled:cursor-not-allowed",
                  accountType === type
                    ? "bg-[#8B35F5] text-white shadow-[0_10px_24px_rgba(139,53,245,0.22)]"
                    : "text-zinc-600 hover:bg-white",
                )}
              >
                {accountTypeLabel(type)}
              </button>
            ))}
          </div>
          {editing && <p className="mt-2 text-[11px] font-bold text-zinc-400">نوع الحساب ثابت لحماية روابط العملاء المنشأة.</p>}
        </div>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field icon={Mail} label="البريد الإلكتروني">
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              className="admin-modal-input"
              dir="ltr"
            />
          </Field>

          <Field icon={KeyRound} label="كلمة المرور">
            <input
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="أدخل كلمة مرور الحساب"
              className="admin-modal-input"
              dir="ltr"
            />
          </Field>
        </div>

        {canConfigureCodeFetch && (
          <div className="mb-5 rounded-2xl border border-[#E0D0FB] bg-[#F8F4FF] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-zinc-800">رابط جلب الكود الخارجي</p>
                <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                  {externalCodeLinkEnabled
                    ? "سيتم تحويل العميل مباشرة إلى الرابط الخارجي عند طلب الكود."
                    : "سيستخدم الحساب نظام جلب كود التحقق الافتراضي مع بقاء روابط العملاء الحالية."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={externalCodeLinkEnabled}
                onClick={() => {
                  setExternalCodeLinkEnabled((current) => !current);
                  setFormError("");
                }}
                className={cn(
                  "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200",
                  externalCodeLinkEnabled ? "bg-[#8B35F5]" : "bg-zinc-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200",
                    externalCodeLinkEnabled ? "right-7" : "right-1",
                  )}
                />
              </button>
            </div>
          </div>
        )}

        {formError && (
          <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">
            {formError}
          </p>
        )}

        {accountType !== "temporary" && (
          <>
            {((canConfigureCodeFetch && externalCodeLinkEnabled) || (!canConfigureCodeFetch && editing)) && (
              <Field icon={Link2} label="رابط جلب الكود الخارجي">
                <input
                  required={canConfigureCodeFetch && externalCodeLinkEnabled}
                  value={supplierCodeUrl}
                  onChange={(event) => setSupplierCodeUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="admin-modal-input"
                  dir="ltr"
                />
                <p className="mt-2 text-[11px] font-bold text-zinc-400">
                  {canConfigureCodeFetch
                    ? "سيظهر التغيير فور تحديث العميل لصفحته الحالية، دون إعادة توليد الرابط."
                    : accountType === "compensation"
                    ? "سيظهر للعميل كزر جلب الكود ويفتح هذا الرابط مباشرة."
                    : "خاص بالمسؤول فقط ولا يظهر في صفحة العميل."}
                </p>
              </Field>
            )}

            {accountType === "compensation" && (
              <Field icon={MonitorPlay} label="رابط فيديو شرح الدخول">
                <input
                  value={compensationTutorialUrl}
                  onChange={(event) => setCompensationTutorialUrl(event.target.value)}
                  placeholder="https://youtube.com/shorts/... أو رابط MP4"
                  className="admin-modal-input"
                  dir="ltr"
                />
                <p className="mt-2 text-[11px] font-bold leading-6 text-zinc-400">
                  يقبل روابط YouTube وShorts وملفات MP4. عند تركه فارغاً سيظهر فيديو الشرح الافتراضي.
                </p>
              </Field>
            )}
          </>
        )}

        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-[#E8DDF8] bg-[#FAF8FD] p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-zinc-700">
              <CalendarDays className="h-4 w-4 text-[#8B35F5]" />
              {editing ? "تاريخ انتهاء الحساب" : "تاريخ الانتهاء التلقائي"}
            </div>
            <p className="mt-1 text-[11px] font-bold text-zinc-400">
              {editing ? "يبقى تاريخ الانتهاء الحالي دون تغيير." : "يتم احتسابه بعد 30 يوماً من تاريخ الإضافة."}
            </p>
          </div>
          <p className="shrink-0 text-sm font-black text-[#6F22D6]">
            {formatDate(initialAccount?.expires_at || calculatedExpiry)}
          </p>
        </div>

        {!editing && (
          <p className="mb-5 rounded-xl bg-[#F4EDFF] px-4 py-3 text-xs font-bold text-[#6F22D6]">
            {accountType === "temporary"
              ? "سيتم إنشاء رابط مباشر واحد يعرض البريد الإلكتروني وكلمة المرور وتعليمات الدخول فقط."
              : accountType === "compensation"
                ? "بعد الضغط على الإضافة ستختار توزيعاً خاصاً (5 روابط) أو مشتركاً (8 روابط من B إلى E)."
              : service === "shahid"
              ? accountType === "private"
                ? "سيتم إنشاء 4 روابط تلقائياً بدون رمز ملف."
                : "سيتم إنشاء 8 روابط تلقائياً بدون رمز ملف."
              : service === "osn"
                ? accountType === "private"
                  ? "سيتم إنشاء 5 روابط OSN مستقلة تلقائياً."
                  : "سيتم إنشاء 10 روابط OSN مستقلة تلقائياً، رابطان لكل ملف."
              : accountType === "private"
                ? "سيتم إنشاء 5 روابط تلقائياً."
                : "سيتم إنشاء 10 روابط تلقائياً: رابطان مستقلان لكل ملف من A إلى E."}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-12 rounded-xl border border-[#E5DBF2] px-6 text-sm font-black text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            disabled={loading}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_30px_rgba(139,53,245,0.26)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {editing ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {loading ? "جاري الحفظ..." : editing ? "حفظ التعديلات" : "إضافة حساب جديد"}
          </button>
        </div>
      </form>

      {showCompensationDistribution && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#17141F]/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="اختيار توزيع حساب التعويضات"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) setShowCompensationDistribution(false);
          }}
        >
          <div className="w-full max-w-lg rounded-3xl border border-[#DCC9FA] bg-white p-5 shadow-[0_30px_90px_rgba(20,10,35,0.30)] md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black text-[#8B35F5]">الخطوة الأخيرة</p>
                <h3 className="mt-1 text-2xl font-black">اختر نوع توزيع التعويضات</h3>
                <p className="mt-2 text-sm font-bold leading-7 text-zinc-500">
                  سيُنشئ النظام روابط العملاء الآن وفق التوزيع الذي تختاره فقط.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompensationDistribution(false)}
                disabled={loading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E7DDF5] text-zinc-500 transition hover:bg-[#F5EEFF]"
                title="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setShowCompensationDistribution(false);
                  submitNewAccount("private");
                }}
                disabled={loading}
                className="rounded-2xl border-2 border-[#DCC9FA] bg-[#FCFAFF] p-5 text-right transition hover:border-[#8B35F5] hover:bg-[#F5EEFF] disabled:opacity-50"
              >
                <span className="block text-lg font-black text-[#6F22D6]">خاص</span>
                <span className="mt-2 block text-xs font-bold leading-6 text-zinc-500">5 روابط منفصلة للملفات A وB وC وD وE.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCompensationDistribution(false);
                  submitNewAccount("shared");
                }}
                disabled={loading}
                className="rounded-2xl border-2 border-[#DCC9FA] bg-[#FCFAFF] p-5 text-right transition hover:border-[#8B35F5] hover:bg-[#F5EEFF] disabled:opacity-50"
              >
                <span className="block text-lg font-black text-[#6F22D6]">مشترك</span>
                <span className="mt-2 block text-xs font-bold leading-6 text-zinc-500">8 روابط: رابطان لكل ملف من B إلى E، والملف A محجوز.</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 flex items-center gap-2 text-sm font-black text-zinc-700">
        <Icon className="h-4 w-4 text-[#8B35F5]" />
        {label}
      </span>
      {children}
    </label>
  );
}

function AccountDetail({
  account,
  links,
  onBack,
  setToast,
  onDelete,
  onDeleteLinks,
  onUpdateCustomerCodeBalance,
  onResetCustomerDevice,
  onResetExternalCodeAccess,
  onUpdateDates,
  onUpdate,
  onLogout,
}: {
  account: NetflixAccount;
  links: CustomerLink[];
  onBack: () => void;
  setToast: (toast: Toast) => void;
  onDelete: (accountId: string) => Promise<void>;
  onDeleteLinks: (ids: string[]) => Promise<boolean>;
  onUpdateCustomerCodeBalance: (
    linkId: string,
    codeRequestLimit: number,
    resetRequestedCount: boolean,
  ) => Promise<boolean>;
  onResetCustomerDevice: (linkId: string) => Promise<boolean>;
  onResetExternalCodeAccess: (linkId: string) => Promise<boolean>;
  onUpdateDates: (accountId: string, form: { created_at: string; expires_at: string }) => Promise<boolean>;
  onUpdate: Parameters<typeof AccountForm>[0]["onUpdate"];
  onLogout: () => void;
}) {
  const expired = isExpired(account.expires_at);
  const service = serviceOf(account);
  const fallbackGeneratedLimit = account.account_type === "temporary"
    ? 0
    : account.account_type === "compensation"
      ? account.compensation_distribution === "shared" ? 8 : 5
    : service === "shahid"
      ? account.account_type === "private" ? 4 : 8
      : service === "osn"
        ? account.account_type === "private" ? 5 : 10
      : account.account_type === "private" ? 5 : 10;
  const generatedLimit = links.length || fallbackGeneratedLimit;
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"customers" | "twofa">("customers");
  const [startDate, setStartDate] = useState(() => new Date(account.created_at).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date(account.expires_at).toISOString().slice(0, 10));
  const [savingDates, setSavingDates] = useState(false);
  const [supplierCodeUrl, setSupplierCodeUrl] = useState(account.supplier_code_url || "");
  const [savingSupplierCode, setSavingSupplierCode] = useState(false);
  const [adminVerificationCode, setAdminVerificationCode] = useState(account.verification_code || "");
  const [adminVerificationCodeReceivedAt, setAdminVerificationCodeReceivedAt] = useState(
    account.verification_code_received_at || "",
  );
  const [loadingAdminVerificationCode, setLoadingAdminVerificationCode] = useState(false);
  const [editingCodeBalanceLink, setEditingCodeBalanceLink] = useState<CustomerLink | null>(null);
  const [codeBalanceLimit, setCodeBalanceLimit] = useState("1");
  const [savingCodeBalance, setSavingCodeBalance] = useState(false);

  useEffect(() => {
    setSelectedLinkIds([]);
    setActiveTab("customers");
    setStartDate(new Date(account.created_at).toISOString().slice(0, 10));
    setEndDate(new Date(account.expires_at).toISOString().slice(0, 10));
    setSupplierCodeUrl(account.supplier_code_url || "");
    setAdminVerificationCode(account.verification_code || "");
    setAdminVerificationCodeReceivedAt(account.verification_code_received_at || "");
    setEditingCodeBalanceLink(null);
  }, [account.created_at, account.expires_at, account.id]);

  const linksToCopy = selectedLinkIds.length ? links.filter((link) => selectedLinkIds.includes(link.id)) : links;
  const linksToCopyText = linksToCopy
    .map((link) => `للحصول على بيانات الحساب ادخل على الرابط التالي: ${getCustomerUrl(link)} يجب الإحتفاظ بالرابط`)
    .join("\n");
  const openSupplierCode = () => {
    const url = supplierCodeUrl.trim();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const allSelected = links.length > 0 && selectedLinkIds.length === links.length;
  const selectedCount = selectedLinkIds.length;

  async function fetchAdminVerificationCode() {
    if (!supabase) {
      setToast({
        label: adminVerificationCode ? "تم عرض آخر كود محفوظ محلياً" : "لا يوجد كود محفوظ لهذا الحساب",
        at: Date.now(),
      });
      return;
    }

    setLoadingAdminVerificationCode(true);
    const latestCode = await readLatestVerificationCode(account.id, links[0]?.id, false);

    if (latestCode.code) {
      const { error: saveError } = await supabase
        .from("customer_links")
        .update({
          verification_code: latestCode.code,
          verification_code_received_at: latestCode.receivedAt || new Date().toISOString(),
        })
        .eq("account_id", account.id);

      if (saveError) {
        console.error("Supabase customer link verification code sync error:", saveError);
      }

      setAdminVerificationCode(latestCode.code);
      setAdminVerificationCodeReceivedAt(latestCode.receivedAt || "");
      setLoadingAdminVerificationCode(false);
      setToast({
        label: saveError ? "تم جلب الكود لكن تعذر مزامنته مع روابط العملاء" : "تم جلب كود التحقق للمشرف",
        at: Date.now(),
      });
      return;
    }

    setLoadingAdminVerificationCode(false);
    setToast({ label: "لا يوجد كود تحقق محفوظ لهذا الحساب", at: Date.now() });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-full border border-[#E4D6FA] bg-white px-4 py-2 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
        >
          <ArrowRight className="h-4 w-4" />
          العودة للرئيسية
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={openSupplierCode}
            disabled={!account.supplier_code_url}
            className="rounded-full border border-[#E4D6FA] bg-[#F5EEFF] px-4 py-2 text-sm font-black text-[#7C2CE8] transition hover:bg-[#8B35F5] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            فتح رابط الأكواد
          </button>
          <button
            onClick={onLogout}
            className="rounded-full border border-[#E4D6FA] bg-white px-4 py-2 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
          >
            تسجيل الخروج
          </button>
        </div>
      </div>

      <section className="mb-6 rounded-[2rem] border border-[#E8DCFF] bg-white p-5 shadow-premium">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8B35F5]">تفاصيل الحساب</p>
            <h1 className="mt-2 text-3xl font-black md:text-4xl">إدارة الحساب والعملاء</h1>
            <p className="mt-2 text-sm font-semibold text-zinc-500">حساب {account.email} وتفاصيل الروابط من لوحة واحدة.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:min-w-72">
            <div className="rounded-2xl bg-[#F7F2FF] p-4">
              <p className="text-3xl font-black text-[#7C2CE8]">{links.length}</p>
              <p className="text-xs font-bold text-zinc-500">العملاء</p>
            </div>
            <div className="rounded-2xl bg-[#F7F2FF] p-4">
              <p className="text-3xl font-black text-[#7C2CE8]">{generatedLimit}</p>
              <p className="text-xs font-bold text-zinc-500">الخطة</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#E0D4F8] bg-[#FCFAFF] p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-black text-zinc-700">البريد الإلكتروني</span>
              <button
                onClick={() => void copyText(account.email, setToast)}
                className="flex h-10 items-center gap-2 rounded-xl border border-[#E0D4F8] bg-white px-4 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
              >
                <Clipboard className="h-4 w-4" />
                نسخ
              </button>
            </div>
            <p className="truncate text-lg font-black text-zinc-950" dir="ltr">
              {account.email}
            </p>
          </div>

          <div className="rounded-2xl border border-[#E0D4F8] bg-[#FCFAFF] p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-black text-zinc-700">كلمة المرور</span>
              <button
                onClick={() => void copyText(account.password, setToast)}
                className="flex h-10 items-center gap-2 rounded-xl border border-[#E0D4F8] bg-white px-4 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
              >
                <Clipboard className="h-4 w-4" />
                نسخ
              </button>
            </div>
            <p className="truncate text-lg font-black text-zinc-950" dir="ltr">
              {account.password}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "اسم الحساب", value: account.email, valueClass: "text-sm" },
            {
              label: "نوع الحساب",
              value: account.account_type === "compensation"
                ? `التعويضات - ${account.compensation_distribution === "shared" ? "مشترك" : "خاص"}`
                : accountTypeLabel(account.account_type),
            },
            { label: "الخطة", value: `${generatedLimit} روابط` },
            { label: "الحالة", value: expired ? "منتهي" : "فعال", valueClass: expired ? "text-amber-700" : "text-emerald-600" },
            { label: "تاريخ الانتهاء", value: formatDate(account.expires_at) },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-[#E7DCF9] bg-white p-4 shadow-[0_8px_24px_rgba(70,40,120,0.05)]">
              <p className="text-xs font-bold text-zinc-500">{item.label}</p>
              <p className={cn("mt-2 truncate text-base font-black text-zinc-900", item.valueClass)} dir="ltr">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 rounded-[2rem] border border-[#E8DCFF] bg-white p-5 shadow-premium">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-zinc-700">تاريخ بداية الاشتراك</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="admin-modal-input"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-zinc-700">تاريخ نهاية الاشتراك</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="admin-modal-input"
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              setSavingDates(true);
              const succeeded = await onUpdateDates(account.id, {
                created_at: new Date(`${startDate}T00:00:00`).toISOString(),
                expires_at: new Date(`${endDate}T00:00:00`).toISOString(),
              });
              setSavingDates(false);
              if (succeeded) setToast({ label: "تم حفظ التواريخ", at: Date.now() });
            }}
            disabled={savingDates}
            className="h-13 rounded-2xl bg-[#8B35F5] px-7 text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
          >
            حفظ التواريخ
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-[2rem] border border-[#E8DCFF] bg-white shadow-premium">
        <div className="flex flex-col gap-4 border-b border-[#EEE7F8] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "customers", label: "العملاء" },
              { key: "twofa", label: "المصادقة الثنائية 2FA" },
            ]
              .filter((tab) => service !== "osn" || tab.key === "customers")
              .map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-black transition",
                  activeTab === tab.key ? "bg-[#8B35F5] text-white shadow-[0_10px_24px_rgba(139,53,245,0.18)]" : "bg-[#F5EEFF] text-[#7C2CE8] hover:bg-[#EDE1FF]",
                )}
              >
                {tab.label}
              </button>
              ))}
          </div>
          <div className="text-sm font-bold text-[#7C2CE8]">
            {selectedCount ? `تم تحديد ${selectedCount} عميل.` : "لم يتم تحديد أي عميل، سيتم تطبيق الإجراءات على جميع العملاء."}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-[#EEE7F8] bg-[#F8F4FF] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 text-sm font-bold text-zinc-700">
            <label className="flex items-center gap-2 rounded-full border border-[#E4D6FA] bg-white px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => setSelectedLinkIds(event.target.checked ? links.map((link) => link.id) : [])}
                className="h-4 w-4 rounded border-[#CDBAF2] text-[#8B35F5] focus:ring-[#8B35F5]"
              />
              تحديد الكل
            </label>
            <span className="text-zinc-500">عرض {links.length} من {links.length} عميل</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {service !== "osn" && (
              <button
                type="button"
                onClick={() => setToast({ label: "ميزة تعديل الرصيد قيد الإعداد", at: Date.now() })}
                className="rounded-full border border-[#E4D6FA] bg-white px-4 py-2 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
              >
                تعديل الرصيد
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!linksToCopyText) return;
                await copyText(linksToCopyText, setToast);
              }}
              className="rounded-full bg-[#8B35F5] px-4 py-2 text-sm font-black text-white shadow-[0_10px_24px_rgba(139,53,245,0.18)] transition hover:bg-[#7626DD]"
            >
              نسخ الروابط
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!selectedLinkIds.length) {
                  setToast({ label: "حدد روابط أولاً", at: Date.now() });
                  return;
                }
                await onDeleteLinks(selectedLinkIds);
                setSelectedLinkIds([]);
              }}
              disabled={!selectedLinkIds.length}
              className="rounded-full border border-[#E4D6FA] bg-white px-4 py-2 text-sm font-black text-zinc-600 transition hover:bg-[#F5EEFF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              حذف
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!links.length) return;
                await onDeleteLinks(links.map((link) => link.id));
                setSelectedLinkIds([]);
              }}
              disabled={!links.length}
              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              حذف الكل
            </button>
          </div>
        </div>

        {activeTab === "customers" ? (
          <>
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
              {links.map((link, index) => {
                const customerUrl = getCustomerUrl(link);
                const checked = selectedLinkIds.includes(link.id);
                return (
                  <article
                    key={link.id}
                    className="animate-rise rounded-[1.75rem] border border-[#E4D6FA] bg-white p-4 shadow-[0_10px_28px_rgba(70,40,120,0.06)] transition duration-300 hover:-translate-y-1 hover:border-[#CDBAF2]"
                    style={{ animationDelay: `${index * 45}ms` }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedLinkIds((current) =>
                              event.target.checked
                                ? [...current, link.id]
                                : current.filter((item) => item !== link.id),
                            )
                          }
                          className="mt-1 h-4 w-4 rounded border-[#CDBAF2] text-[#8B35F5] focus:ring-[#8B35F5]"
                        />
                        <div>
                          <p className="text-xs font-bold text-zinc-500">اسم الملف</p>
                          <h3 className="text-2xl font-black text-zinc-950">{link.profile_name}</h3>
                          <p className="mt-1 text-xs font-bold text-[#7C2CE8]">{link.profile_label}</p>
                          <p className="mt-2 inline-flex rounded-full bg-[#F3ECFF] px-3 py-1 text-xs font-black text-[#7C2CE8]">
                            عميل رقم #{link.link_number ?? "—"}
                          </p>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteLinks([link.id]);
                          setSelectedLinkIds((current) => current.filter((item) => item !== link.id));
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                        title="حذف العميل"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {link.client_code && (
                      <div className="mb-3">
                        <CompensationCodeCard code={link.client_code} compact />
                      </div>
                    )}

                    <p className="truncate rounded-2xl bg-[#F8F4FF] px-3 py-3 text-left text-xs font-bold text-zinc-500" dir="ltr">
                      {customerUrl}
                    </p>

                    <button
                      onClick={() => copyText(customerUrl, setToast)}
                      className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.20)] transition hover:bg-[#7626DD]"
                    >
                      <Copy className="h-4 w-4" />
                      نسخ الرابط
                    </button>
                    {link.tv_approval_url && (
                      <button
                        type="button"
                        onClick={() => copyText(link.tv_approval_url || "", setToast)}
                        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-white text-sm font-black text-[#7C2CE8] transition hover:border-[#8B35F5] hover:bg-[#F8F4FF]"
                      >
                        <Link2 className="h-4 w-4" />
                        نسخ رابط الموافقة
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCodeBalanceLink(link);
                        setCodeBalanceLimit(String(link.code_request_limit ?? 1));
                      }}
                      className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-[#F8F4FF] text-sm font-black text-[#7C2CE8] transition hover:border-[#8B35F5] hover:bg-[#F3ECFF]"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      تعديل رصيد الأكواد
                      <span className="rounded-full bg-white px-2 py-1 text-xs text-zinc-600">
                        {Math.max(
                          0,
                          (link.code_request_limit ?? 1) - (link.code_requested_count ?? 0),
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm("هل تريد إعادة ضبط الجهاز المختار لهذا العميل؟")) return;
                        await onResetCustomerDevice(link.id);
                      }}
                      className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 text-sm font-black text-amber-700 transition hover:bg-amber-100"
                    >
                      <RefreshCw className="h-4 w-4" />
                      إعادة ضبط الجهاز المختار
                    </button>
                    {account.code_fetch_method === "external_link" && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm("هل تريد إعادة تفعيل رابط جلب الكود لهذا العميل؟")) return;
                          await onResetExternalCodeAccess(link.id);
                        }}
                        disabled={!link.external_code_used}
                        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <RefreshCw className="h-4 w-4" />
                        {link.external_code_used ? "إعادة تفعيل رابط الكود" : "رابط الكود متاح"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>

            {!links.length && (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 pb-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3ECFF] text-[#8B35F5]">
                  <Users className="h-6 w-6" />
                </div>
                <p className="text-sm font-black text-zinc-700">لا توجد روابط عملاء بعد</p>
              </div>
            )}
          </>
        ) : (
          <div className="p-5">
            <div className="mb-5 rounded-[1.75rem] border border-[#E4D6FA] bg-white p-5 shadow-[0_10px_28px_rgba(70,40,120,0.06)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-black text-zinc-700">كود التحقق المستلم</p>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    يظهر هنا آخر كود وصل من Cloudflare Worker لهذا الحساب.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {adminVerificationCodeReceivedAt && (
                    <span className="rounded-full bg-[#F8F4FF] px-4 py-2 text-xs font-black text-[#7C2CE8]">
                      {formatDateTime(adminVerificationCodeReceivedAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void fetchAdminVerificationCode()}
                    disabled={loadingAdminVerificationCode}
                    className="flex h-11 items-center gap-2 rounded-2xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.22)] transition hover:-translate-y-0.5 hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={cn("h-4 w-4", loadingAdminVerificationCode && "animate-spin")} />
                    {loadingAdminVerificationCode ? "جاري جلب الكود..." : "جلب كود التحقق (خاص بالمشرف)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => adminVerificationCode && copyText(adminVerificationCode, setToast)}
                    disabled={!adminVerificationCode}
                    className="h-11 rounded-2xl border border-[#E0D4F8] bg-[#F5EEFF] px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#8B35F5] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    نسخ الكود
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-[#E0D4F8] bg-[#FCFAFF] px-5 py-5 text-center">
                {adminVerificationCode ? (
                  <p className="font-mono text-5xl font-black tracking-[0.35em] text-[#8B35F5]" dir="ltr">
                    {adminVerificationCode}
                  </p>
                ) : (
                  <p className="text-sm font-black text-zinc-500">لم يصل كود تحقق لهذا الحساب حتى الآن</p>
                )}
              </div>
            </div>

            <div className="grid gap-5 rounded-[1.75rem] border border-[#E4D6FA] bg-[#FCFAFF] p-5 lg:grid-cols-[1fr_auto] lg:items-end">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-zinc-700">رابط الأكواد</span>
                <input
                  value={supplierCodeUrl}
                  onChange={(event) => setSupplierCodeUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="admin-modal-input"
                  dir="ltr"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={openSupplierCode}
                  disabled={!supplierCodeUrl.trim()}
                  className="h-13 rounded-2xl border border-[#E0D4F8] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  فتح الرابط
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setSavingSupplierCode(true);
                    const succeeded = await onUpdate(account.id, {
                      email: account.email,
                      password: account.password,
                      supplier_code_url: supplierCodeUrl.trim() || undefined,
                    });
                    setSavingSupplierCode(false);
                    if (succeeded) setToast({ label: "تم حفظ رابط الأكواد", at: Date.now() });
                  }}
                  disabled={savingSupplierCode}
                  className="h-13 rounded-2xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  حفظ الرابط
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {editingCodeBalanceLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-[2rem] border border-[#E4D6FA] bg-white p-6 shadow-premium-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="code-balance-title"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black text-[#8B35F5]">
                  عميل رقم #{editingCodeBalanceLink.link_number ?? "—"}
                </p>
                <h2 id="code-balance-title" className="mt-1 text-2xl font-black text-zinc-950">
                  تعديل رصيد الأكواد
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingCodeBalanceLink(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E4D6FA] text-zinc-500 transition hover:bg-[#F8F4FF]"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-zinc-700">عدد المحاولات المسموح بها</span>
              <input
                type="number"
                min="0"
                step="1"
                value={codeBalanceLimit}
                onChange={(event) => setCodeBalanceLimit(event.target.value)}
                className="admin-modal-input"
              />
            </label>

            <p className="mt-4 rounded-2xl border border-[#E4D6FA] bg-[#FCFAFF] p-4 text-sm font-bold text-zinc-600">
              الرصيد المتبقي:{" "}
              {Math.max(
                0,
                (editingCodeBalanceLink.code_request_limit ?? 1) -
                  (editingCodeBalanceLink.code_requested_count ?? 0),
              )}
              . الرقم الجديد سيصبح الرصيد المتاح وسيتم تصفير الاستهلاك تلقائياً.
            </p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setEditingCodeBalanceLink(null)}
                className="h-12 rounded-xl border border-[#E4D6FA] px-5 text-sm font-black text-zinc-600 transition hover:bg-zinc-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={savingCodeBalance || codeBalanceLimit.trim() === ""}
                onClick={async () => {
                  const limit = Number(codeBalanceLimit);
                  if (!Number.isFinite(limit) || limit < 0) {
                    setToast({ label: "أدخل عدداً صحيحاً للرصيد", at: Date.now() });
                    return;
                  }
                  setSavingCodeBalance(true);
                  const succeeded = await onUpdateCustomerCodeBalance(
                    editingCodeBalanceLink.id,
                    limit,
                    true,
                  );
                  setSavingCodeBalance(false);
                  if (succeeded) setEditingCodeBalanceLink(null);
                }}
                className="h-12 flex-1 rounded-xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.22)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCodeBalance ? "جاري الحفظ..." : "حفظ الرصيد"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompensationAccountCustomerView({
  link,
  account,
  navigate,
}: {
  link: CustomerLink;
  account: NetflixAccount;
  navigate: (path: string) => void;
}) {
  const [toast, setToast] = useState<Toast>(null);
  const theme = serviceThemes.netflix;
  const codeUrl = String(account.supplier_code_url || "").trim();
  const profileName = `ملف ${link.profile_label || link.profile_name}`;
  const tutorialMedia = getTutorialMedia(account.compensation_tutorial_url || defaultCompensationTutorialUrl);
  const tutorialSection = (
    <section className="rounded-[2rem] border border-white bg-white p-6 shadow-premium md:p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-[#E50914]">
          <MonitorPlay className="h-5 w-5" />
        </div>
        <h2 className="text-2xl font-black text-zinc-950">شرح طريقة الدخول</h2>
      </div>

      {tutorialMedia && (
        <div className="mx-auto mb-6 w-full max-w-[360px] overflow-hidden rounded-[1.75rem] border border-red-100 bg-black shadow-[0_18px_48px_rgba(229,9,20,0.16)]">
          <div className="aspect-[9/16] w-full">
            {tutorialMedia.kind === "video" ? (
              <video
                src={tutorialMedia.src}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
              />
            ) : (
              <iframe
                src={tutorialMedia.src}
                title="فيديو شرح الدخول لحساب التعويض"
                className="h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {[
          "أدخل البريد الإلكتروني الموضح أعلى الصفحة.",
          `حدد ${profileName} واستخدم الرقم السري الخاص به (${link.profile_code}).`,
          "عند طلب رمز التفعيل، اضغط على زر جلب الكود للانتقال مباشرة إلى صفحة الكود.",
        ].map((step, index) => (
          <div key={step} className="flex items-start gap-3 rounded-2xl border border-zinc-100 bg-[#FAFAFB] p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E50914] text-sm font-black text-white">{index + 1}</span>
            <p className="pt-1 text-sm font-bold leading-7 text-zinc-700">{step}</p>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Shell toast={toast}>
      <div className="min-h-screen bg-gradient-to-b from-[#F3F4F6] via-[#F9FAFB] to-white px-4 py-7 md:py-12" dir="rtl">
        <main className="mx-auto w-full max-w-[680px] space-y-6">
          <header className="rounded-[2rem] border border-white bg-white/90 p-5 shadow-premium backdrop-blur md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E50914] to-[#B20710] text-lg font-black text-white shadow-[0_12px_28px_rgba(229,9,20,0.22)]">
                  زون
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-[#E50914]">Zone Store</p>
                  <h1 className="mt-1 text-xl font-black text-zinc-950 md:text-2xl">بيانات حساب التعويض</h1>
                  <p className="mt-1 text-xs font-bold text-zinc-500">{profileName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[#E50914] transition hover:bg-[#E50914] hover:text-white"
                title="العودة"
              >
                <UserRound className="h-5 w-5" />
              </button>
            </div>
          </header>

          {tutorialSection}

          <section className="rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
            <div className="mb-6 text-center">
              <div className="mx-auto flex h-13 w-13 items-center justify-center rounded-2xl bg-red-50 text-[#E50914]">
                <KeyRound className="h-6 w-6" />
              </div>
              <h2 className="mt-3 text-2xl font-black text-zinc-950 md:text-3xl">بيانات تسجيل الدخول</h2>
            </div>

            <div className="space-y-4">
              <LoginCopyCard label="البريد الإلكتروني" value={account.email} icon={Mail} setToast={setToast} theme={theme} />
              <LoginCopyCard label="كلمة المرور" value={account.password} icon={KeyRound} setToast={setToast} theme={theme} />
              <div className="grid gap-4 pt-1 sm:grid-cols-2">
                <LoginCopyCard label="اسم الملف" value={profileName} icon={UserRound} setToast={setToast} theme={theme} />
                <LoginCopyCard label="الرقم السري للملف" value={link.profile_code} icon={LockKeyhole} setToast={setToast} theme={theme} />
              </div>
            </div>

            {codeUrl ? (
              <a
                href={codeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#E50914] to-[#B20710] px-5 text-base font-black text-white shadow-[0_16px_36px_rgba(229,9,20,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(229,9,20,0.32)]"
              >
                <ExternalLink className="h-5 w-5" />
                جلب الكود
              </a>
            ) : (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-black text-amber-800">
                رابط جلب الكود غير متوفر حالياً، يرجى التواصل مع المتجر.
              </div>
            )}
          </section>

        </main>
      </div>
    </Shell>
  );
}

function CustomerView({
  identifier,
  lookup,
  navigate,
}: {
  identifier: string;
  lookup: "short" | "uuid";
  navigate: (path: string) => void;
}) {
  const [link, setLink] = useState<CustomerLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(() => localStorage.getItem(disclaimerStorageKey) !== "true");
  const [showReminder, setShowReminder] = useState(false);
  const [agreeDisclaimer, setAgreeDisclaimer] = useState(false);
  const [codeRequestState, setCodeRequestState] = useState<"idle" | "loading" | "ready" | "failed" | "expired">("idle");
  const [codeRequestErrorMessage, setCodeRequestErrorMessage] = useState<string | null>(null);
  const [codeRequestSeconds, setCodeRequestSeconds] = useState(0);
  const [codeDisplayExpiresAt, setCodeDisplayExpiresAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [deviceView, setDeviceView] = useState<DeviceView | null>(null);
  const [pendingDeviceView, setPendingDeviceView] = useState<DeviceView | null>(null);
  const [agreeDeviceChoice, setAgreeDeviceChoice] = useState(false);
  const [showPreRequestModal, setShowPreRequestModal] = useState(false);
  const [agreePreRequest, setAgreePreRequest] = useState(false);
  const [showTvRequestModal, setShowTvRequestModal] = useState(false);
  const [agreeTvRequest, setAgreeTvRequest] = useState(false);
  const [showProfilePinWarning, setShowProfilePinWarning] = useState(false);
  const [agreeProfilePinWarning, setAgreeProfilePinWarning] = useState(false);
  const [profilePinRevealed, setProfilePinRevealed] = useState(false);
  const [showExternalCodeWarning, setShowExternalCodeWarning] = useState(false);
  const [agreeExternalCodeTerms, setAgreeExternalCodeTerms] = useState(false);
  const [isExternalCodeUsed, setIsExternalCodeUsed] = useState(false);
  const [externalCodeFirstOpenedAt, setExternalCodeFirstOpenedAt] = useState<string | null>(null);
  const [externalCodeDeadlineAt, setExternalCodeDeadlineAt] = useState<number | null>(null);
  const [externalCodeSubmitting, setExternalCodeSubmitting] = useState(false);
  const [externalCodeError, setExternalCodeError] = useState<string | null>(null);
  const [activeTutorial, setActiveTutorial] = useState<{ title: string; url: string } | null>(null);
  const [tvRequestState, setTvRequestState] = useState<"idle" | "searching" | "ready" | "failed" | "expired">("idle");
  const [tvSearchDeadlineAt, setTvSearchDeadlineAt] = useState<number | null>(null);
  const [tvDisplayExpiresAt, setTvDisplayExpiresAt] = useState<number | null>(null);
  const [visibleTvApprovalUrl, setVisibleTvApprovalUrl] = useState<string | null>(null);
  const [extraCreditRequest, setExtraCreditRequest] = useState<ExtraCreditRequest | null>(null);
  const [showExtraCreditModal, setShowExtraCreditModal] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const codeSearchActiveRef = useRef(false);
  const tvSearchActiveRef = useRef(false);
  const externalCodeExpiryRequestRef = useRef(false);
  const requestBaselineRef = useRef<{
    messageId: string | null;
    code: string | null;
    receivedAt: string | null;
  }>({ messageId: null, code: null, receivedAt: null });

  useEffect(() => {
    async function loadCustomer() {
      if (!supabase) {
        const demo =
          demoLinks.find((item) => (lookup === "short" ? item.short_id === identifier : item.uuid === identifier)) || {
            ...demoLinks[0],
            [lookup === "short" ? "short_id" : "uuid"]: identifier,
          };
        setLink({ ...demo, accounts: demoAccount });
        setLoading(false);
        return;
      }

      const queryColumn = lookup === "short" ? "short_id" : "uuid";
      const customerLink = await loadCustomerLinkRecord(queryColumn, identifier);
      if (customerLink) setLink(customerLink);
      setLoading(false);
    }

    void loadCustomer();
  }, [identifier, lookup]);

  useEffect(() => {
    if (!link?.id || !supabase) return;
    const client = supabase;
    const customerId = link.id;

    async function loadLatestRequest() {
      const { data, error } = await client
        .from("extra_credit_requests")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("Supabase latest extra credit request load error:", error);
        return;
      }
      setExtraCreditRequest((data || null) as ExtraCreditRequest | null);
    }

    void loadLatestRequest();
    const channel = client
      .channel(`zone-customer-credit-${customerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "extra_credit_requests", filter: `customer_id=eq.${customerId}` },
        () => void loadLatestRequest(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customer_links", filter: `id=eq.${customerId}` },
        (payload) => setLink((current) => (current ? { ...current, ...(payload.new as Partial<CustomerLink>) } : current)),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [link?.id]);

  useEffect(() => {
    const selectedDevice = link?.selected_device;
    setDeviceView(selectedDevice === "mobile" || selectedDevice === "screen" ? selectedDevice : null);
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
    setShowProfilePinWarning(false);
    setAgreeProfilePinWarning(false);
    setProfilePinRevealed(false);
  }, [link?.id, link?.selected_device]);

  useEffect(() => {
    setIsExternalCodeUsed(link?.external_code_used === true);
    const firstOpenedAt = link?.external_code_first_opened_at || null;
    const firstOpenedMs = firstOpenedAt ? Date.parse(firstOpenedAt) : Number.NaN;
    setExternalCodeFirstOpenedAt(firstOpenedAt);
    setExternalCodeDeadlineAt(Number.isFinite(firstOpenedMs) ? firstOpenedMs + externalCodeAccessDurationMs : null);
    externalCodeExpiryRequestRef.current = link?.external_code_used === true;
  }, [link?.id, link?.external_code_used, link?.external_code_first_opened_at]);

  useEffect(() => {
    const shouldLock =
      link?.accounts?.account_type !== "compensation" &&
      (showDisclaimer ||
        showReminder ||
        Boolean(pendingDeviceView) ||
        showTvRequestModal ||
        showProfilePinWarning ||
        showExternalCodeWarning ||
        Boolean(activeTutorial) ||
        showExtraCreditModal);
    const previous = document.body.style.overflow;
    if (shouldLock) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [link?.accounts?.account_type, showDisclaimer, showReminder, pendingDeviceView, showTvRequestModal, showProfilePinWarning, showExternalCodeWarning, activeTutorial, showExtraCreditModal]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (countdownRef.current) window.clearInterval(countdownRef.current);
      codeSearchActiveRef.current = false;
      tvSearchActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeTutorial) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTutorial(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeTutorial]);

  const account = link?.accounts;
  const storedVerificationCode = link?.verification_code || account?.verification_code || null;
  const storedVerificationCodeReceivedAt =
    link?.verification_code_received_at || account?.verification_code_received_at || null;
  const service = serviceOf(account);
  const normalClientLayout = account?.normal_client_layout === true && account?.account_type !== "temporary";
  const serviceOutageActive = service === "netflix" && netflixServiceOutage && !normalClientLayout;
  const theme = serviceThemes[service];
  const customerCode = String(link?.link_number ?? link?.short_id ?? identifier);
  const supportEmail = account?.email || "غير متوفر";
  const osnCodeSupportMessage = `مرحباً، أرغب بالحصول على كود التفعيل لحساب OSN التالي:
- البريد الإلكتروني: ${supportEmail}
- رمز الطلب/العميل: ${customerCode}`;
  const osnCodeSupportWhatsAppUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(osnCodeSupportMessage)}`;
  const unavailableResultWhatsAppUrl = buildSupportWhatsAppUrl({
    issue: "unavailable",
    email: supportEmail,
    customerCode,
    deviceType: "mobile",
  });
  const deviceLabel = (device: DeviceView) => (device === "mobile" ? "جوال / آيباد / بي سي / لابتوب" : "شاشة / سوني");
  const codeSecondsRemaining = codeDisplayExpiresAt
    ? Math.max(0, Math.ceil((codeDisplayExpiresAt - nowTick) / 1000))
    : 0;
  const codeIsVisible = Boolean(
    codeRequestState === "ready" &&
      storedVerificationCode &&
      codeDisplayExpiresAt &&
      codeDisplayExpiresAt > nowTick,
  );
  const automatedCodeEnabled = account?.use_automated_code !== false;
  const usesExternalCodeLink =
    service === "netflix" &&
    (account?.account_type === "private" || account?.account_type === "shared") &&
    account?.code_fetch_method === "external_link";
  const externalCodeRemainingSeconds = externalCodeDeadlineAt
    ? Math.max(0, Math.ceil((externalCodeDeadlineAt - nowTick) / 1000))
    : null;
  const externalCodeUsed = isExternalCodeUsed || externalCodeRemainingSeconds === 0;
  const externalCodeDirectUrl = String(account?.supplier_code_url || "").trim();
  const customerTutorialVideoUrl = usesExternalCodeLink ? externalCodeCustomerVideoUrl : videoUrl;
  const tutorialCards = [
    {
      id: "mobile",
      title: "شرح الدخول: الجوال، الآيباد، الكمبيوتر",
      url: customerTutorialVideoUrl,
      icon: Smartphone,
    },
    {
      id: "tv",
      title: "شرح الدخول: الشاشات الذكية والبلايستيشن",
      url: tvTutorialVideoUrl,
      icon: Tv,
    },
  ];
  const forwardedEmailCodeEnabled = account?.imap_enabled === true && account?.email_provider === "outlook";
  const codeRequestLimit = Math.max(0, link?.code_request_limit ?? 1);
  const codeRequestedCount = Math.max(0, link?.code_requested_count ?? 0);
  const hasCodeRequestCredit = codeRequestedCount < codeRequestLimit;
  const attemptUsed = !hasCodeRequestCredit;
  const deviceChoiceLocked = attemptUsed;
  const hasUsedTvLink = link?.has_used_tv_link === true;
  const tvAttemptUsed = attemptUsed || hasUsedTvLink;
  const floatingSupportDevice: DeviceView = deviceView || "mobile";
  const floatingSupportIssue: SupportIssue =
    attemptUsed || codeRequestState === "expired" || tvRequestState === "expired"
      ? "expired"
      : codeRequestState === "failed" || tvRequestState === "failed"
        ? "unavailable"
        : "general";
  const floatingSupportWhatsAppUrl = buildSupportWhatsAppUrl({
    issue: floatingSupportIssue,
    email: supportEmail,
    customerCode,
    deviceType: floatingSupportDevice,
  });
  const tvSearchSecondsRemaining = tvSearchDeadlineAt
    ? Math.max(0, Math.ceil((tvSearchDeadlineAt - nowTick) / 1000))
    : 0;
  const tvDisplaySecondsRemaining = tvDisplayExpiresAt
    ? Math.max(0, Math.ceil((tvDisplayExpiresAt - nowTick) / 1000))
    : 0;

  useEffect(() => {
    if (!link?.id || !usesExternalCodeLink) return;
    const customerLinkId = link.id;
    let cancelled = false;

    void fetch("/api/use-external-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link_id: customerLinkId, mode: "status" }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          success?: boolean;
          first_opened_at?: string | null;
          remaining_seconds?: number | null;
          error?: string;
        } | null;
        if (cancelled) return;
        if (response.status === 410 || payload?.error === "external_code_expired") {
          setIsExternalCodeUsed(true);
          setExternalCodeDeadlineAt(null);
          setLink((current) => current ? { ...current, external_code_used: true } : current);
          return;
        }
        if (!response.ok || !payload?.success) throw new Error(payload?.error || "external_code_status_failed");

        const firstOpenedAt = payload.first_opened_at || null;
        const remainingSeconds = typeof payload.remaining_seconds === "number"
          ? Math.max(0, payload.remaining_seconds)
          : null;
        setExternalCodeFirstOpenedAt(firstOpenedAt);
        setExternalCodeDeadlineAt(remainingSeconds == null ? null : Date.now() + remainingSeconds * 1000);
        setLink((current) => current
          ? { ...current, external_code_first_opened_at: firstOpenedAt }
          : current);
      })
      .catch((error) => console.error("External code server status failed:", error));

    return () => {
      cancelled = true;
    };
  }, [link?.id, usesExternalCodeLink]);

  useEffect(() => {
    if (
      !link?.id ||
      !externalCodeFirstOpenedAt ||
      externalCodeRemainingSeconds !== 0 ||
      externalCodeExpiryRequestRef.current
    ) return;

    externalCodeExpiryRequestRef.current = true;
    setIsExternalCodeUsed(true);
    setLink((current) => current
      ? { ...current, external_code_used: true, external_code_used_at: new Date().toISOString() }
      : current);
    void fetch("/api/use-external-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link_id: link.id, mode: "expire" }),
    }).catch((error) => console.error("External code expiry persistence failed:", error));
  }, [externalCodeFirstOpenedAt, externalCodeRemainingSeconds, link?.id]);

  function openExternalCodeWarning() {
    if (!link?.id || !usesExternalCodeLink || externalCodeUsed || externalCodeSubmitting) return;
    setAgreeExternalCodeTerms(false);
    setExternalCodeError(null);
    setShowExternalCodeWarning(true);
  }

  async function continueToExternalCode() {
    if (!link?.id || !agreeExternalCodeTerms || externalCodeUsed || externalCodeSubmitting) return;
    const customerLinkId = link.id;
    if (!isValidHttpUrl(externalCodeDirectUrl)) {
      setExternalCodeError("رابط جلب الكود غير متوفر حالياً، يرجى التواصل مع المتجر.");
      return;
    }

    const openedTab = window.open("about:blank", "_blank");
    if (!openedTab) {
      setExternalCodeError("تعذر فتح الرابط بسبب إعدادات المتصفح. اسمح بالنوافذ المنبثقة ثم حاول مجدداً.");
      return;
    }
    setExternalCodeSubmitting(true);
    setExternalCodeError(null);
    try {
      const response = await fetch("/api/use-external-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link_id: customerLinkId, mode: "start" }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        url?: string;
        first_opened_at?: string;
        remaining_seconds?: number;
        error?: string;
      } | null;
      if (response.status === 410 || payload?.error === "external_code_expired") {
        setIsExternalCodeUsed(true);
        setExternalCodeDeadlineAt(null);
        setLink((current) => current ? { ...current, external_code_used: true } : current);
        throw new Error("external_code_expired");
      }
      if (!response.ok || !payload?.success || !payload.first_opened_at || !isValidHttpUrl(payload.url || "")) {
        throw new Error(payload?.error || "external_code_timer_failed");
      }

      const remainingSeconds = Math.max(0, Number(payload.remaining_seconds) || 0);
      setExternalCodeFirstOpenedAt(payload.first_opened_at);
      setExternalCodeDeadlineAt(Date.now() + remainingSeconds * 1000);
      setLink((current) => current
        ? { ...current, external_code_first_opened_at: payload.first_opened_at }
        : current);
      setShowExternalCodeWarning(false);
      setAgreeExternalCodeTerms(false);
      openedTab.opener = null;
      openedTab.location.replace(payload.url);
    } catch (error) {
      openedTab.close();
      console.error("External code timer registration failed:", error);
      if (!(error instanceof Error && error.message === "external_code_expired")) {
        setExternalCodeError("تعذر تثبيت صلاحية الرابط، يرجى المحاولة مرة أخرى.");
      }
    } finally {
      setExternalCodeSubmitting(false);
    }
  }

  useEffect(() => {
    if (automatedCodeEnabled) return;
    setDeviceView(null);
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
    setShowPreRequestModal(false);
    setAgreePreRequest(false);
    setCodeRequestState("idle");
    setCodeRequestSeconds(0);
    setCodeDisplayExpiresAt(null);
    codeSearchActiveRef.current = false;
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
  }, [automatedCodeEnabled]);

  useEffect(() => {
    tvSearchActiveRef.current = false;
    setShowTvRequestModal(false);
    setAgreeTvRequest(false);
    setTvSearchDeadlineAt(null);

    if (!link || deviceView !== "screen" || !tvAttemptUsed) {
      setTvRequestState("idle");
      setTvDisplayExpiresAt(null);
      setVisibleTvApprovalUrl(null);
      return;
    }

    const usedAtMs = link.tv_link_used_at
      ? Date.parse(link.tv_link_used_at)
      : Number.NaN;
    const expiresAt = Number.isFinite(usedAtMs)
      ? usedAtMs + verificationCodeLifetimeMs
      : 0;
    const storedUrl = String(link.tv_approval_url || "").trim();

    if (storedUrl && expiresAt > Date.now()) {
      setVisibleTvApprovalUrl(storedUrl);
      setTvDisplayExpiresAt(expiresAt);
      setTvRequestState("ready");
      return;
    }

    setVisibleTvApprovalUrl(null);
    setTvDisplayExpiresAt(null);
    setTvRequestState("expired");
  }, [
    deviceView,
    tvAttemptUsed,
    link?.has_used_tv_link,
    link?.id,
    link?.tv_approval_url,
    link?.tv_link_used_at,
  ]);

  useEffect(() => {
    if (deviceView !== "mobile") return;

    if (!attemptUsed) {
      setCodeDisplayExpiresAt(null);
      setCodeRequestState("idle");
      return;
    }

    codeSearchActiveRef.current = false;
    clearCodeSearchTimers();

    const usedAtMs = link?.code_used_at
      ? Date.parse(link.code_used_at)
      : Number.NaN;
    const expiresAt = Number.isFinite(usedAtMs)
      ? usedAtMs + verificationCodeLifetimeMs
      : 0;
    const storedCode = String(storedVerificationCode || "").trim();

    if (storedCode && expiresAt > Date.now()) {
      setCodeDisplayExpiresAt(expiresAt);
      setCodeRequestState("ready");
      return;
    }

    setCodeDisplayExpiresAt(null);
    setCodeRequestState("expired");
  }, [
    storedVerificationCode,
    attemptUsed,
    deviceView,
    link?.code_request_limit,
    link?.code_requested_count,
    link?.code_used_at,
    link?.id,
  ]);

  useEffect(() => {
    if (
      codeRequestState === "ready" &&
      codeDisplayExpiresAt &&
      codeDisplayExpiresAt <= nowTick
    ) {
      setCodeRequestState("expired");
      setCodeDisplayExpiresAt(null);
      setLink((current) =>
        current?.accounts
          ? {
              ...current,
              accounts: {
                ...current.accounts,
                verification_code: null,
              },
            }
          : current,
      );
    }
  }, [codeDisplayExpiresAt, codeRequestState, nowTick]);

  useEffect(() => {
    if (
      tvRequestState === "ready" &&
      tvDisplayExpiresAt &&
      tvDisplayExpiresAt <= nowTick
    ) {
      tvSearchActiveRef.current = false;
      setVisibleTvApprovalUrl(null);
      setTvDisplayExpiresAt(null);
      setTvRequestState("expired");
    }
  }, [nowTick, tvDisplayExpiresAt, tvRequestState]);

  async function readTvApprovalSnapshot(customerLinkId: string): Promise<TvApprovalSnapshot> {
    if (!supabase) {
      return {
        messageId: null,
        url: String(link?.tv_approval_url || "").trim(),
        receivedAt: link?.updated_at || link?.created_at || null,
        receivedAtMs: Date.now(),
      };
    }

    try {
      const { data, error } = await supabase.rpc("get_latest_customer_message", {
        p_customer_link_id: customerLinkId,
        p_message_type: "tv_approval_url",
        p_since: null,
      });

      if (error) throw error;

      const row = (Array.isArray(data) ? data[0] : data) as VerificationMessageRow | null;
      const url =
        typeof row?.tv_approval_url === "string"
          ? row.tv_approval_url.trim()
          : "";
      const receivedAt = typeof row?.received_at === "string" ? row.received_at : null;
      const parsedTime = receivedAt ? Date.parse(receivedAt) : Number.NaN;

      return {
        messageId: row?.id || null,
        url,
        receivedAt,
        receivedAtMs: Number.isFinite(parsedTime) ? parsedTime : 0,
      };
    } catch (error) {
      console.error("Supabase TV approval link read error:", error);
      throw error;
    }
  }

  async function showTvApprovalSnapshot(snapshot: TvApprovalSnapshot, message: string) {
    let nextUrl = String(snapshot.url || "").trim();
    if (!nextUrl) return false;

    const usedAt = new Date().toISOString();

    if (supabase && link?.id) {
      if (!snapshot.messageId) {
        setTvRequestState("failed");
        return false;
      }

      const consumed = await consumeVerificationMessage(snapshot.messageId, link.id, usedAt);
      const consumedUrl = String(consumed?.tv_approval_url || "").trim();
      if (!consumed?.message_id || !consumedUrl) {
        setTvRequestState("failed");
        return false;
      }

      nextUrl = consumedUrl;
    }

    tvSearchActiveRef.current = false;
    setLink((current) =>
      current
        ? {
            ...current,
            tv_approval_url: nextUrl,
            has_used_tv_link: true,
            tv_link_used_at: usedAt,
            code_requested_count: codeRequestLimit,
            updated_at: snapshot.receivedAt || current.updated_at,
          }
        : current,
    );
    setVisibleTvApprovalUrl(nextUrl);
    setTvSearchDeadlineAt(null);
    setTvDisplayExpiresAt(Date.now() + verificationCodeLifetimeMs);
    setTvRequestState("ready");
    setToast({ label: message, at: Date.now() });
    return true;
  }

  function openTvRequestModal() {
    if (
      deviceView !== "screen" ||
      tvAttemptUsed ||
      tvRequestState === "searching" ||
      tvRequestState === "ready" ||
      tvRequestState === "expired"
    ) return;

    setAgreeTvRequest(false);
    setShowTvRequestModal(true);
  }

  async function startTvApprovalSearch() {
    const customerLinkId = link?.id;
    if (!customerLinkId || deviceView !== "screen" || tvAttemptUsed) {
      if (tvAttemptUsed) setTvRequestState("expired");
      return;
    }

    setShowTvRequestModal(false);
    setAgreeTvRequest(false);
    setVisibleTvApprovalUrl(null);
    setTvDisplayExpiresAt(null);
    setTvRequestState("searching");
    const deadline = Date.now() + tvApprovalSearchDurationMs;
    setTvSearchDeadlineAt(deadline);
    tvSearchActiveRef.current = true;

    try {
      const baseline = await readTvApprovalSnapshot(customerLinkId);

      while (tvSearchActiveRef.current && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2000);
        });

        if (!tvSearchActiveRef.current) return;

        try {
          const current = await readTvApprovalSnapshot(customerLinkId);
          const isNewLink =
            Boolean(current.url && current.messageId) &&
            (current.messageId !== baseline.messageId ||
              current.url !== baseline.url ||
              current.receivedAtMs > baseline.receivedAtMs);

          if (isNewLink) {
            if (await showTvApprovalSnapshot(current, "تم استلام رابط موافقة جديد")) return;
          }
        } catch (pollError) {
          console.error("TV approval polling tick error:", pollError);
        }
      }

      if (!tvSearchActiveRef.current) return;

      const fallback = await readTvApprovalSnapshot(customerLinkId);
      const fallbackAge = fallback.receivedAtMs
        ? Date.now() - fallback.receivedAtMs
        : Number.POSITIVE_INFINITY;
      const isRecentFallback =
        Boolean(fallback.url && fallback.messageId) &&
        fallbackAge >= 0 &&
        fallbackAge <= tvApprovalFallbackWindowMs;

      if (isRecentFallback) {
        if (await showTvApprovalSnapshot(
          fallback,
          "تم عرض أحدث رابط متاح خلال آخر 15 دقيقة",
        )) return;
      }

      setTvRequestState("failed");
    } catch (error) {
      console.error("TV approval link search error:", error);
      setVisibleTvApprovalUrl(null);
      setTvDisplayExpiresAt(null);
      setTvRequestState("failed");
    } finally {
      tvSearchActiveRef.current = false;
      setTvSearchDeadlineAt(null);
    }
  }

  function requestDeviceChoice(device: DeviceView) {
    if (!automatedCodeEnabled || deviceChoiceLocked || device === deviceView) return;
    setPendingDeviceView(device);
    setAgreeDeviceChoice(false);
  }

  async function confirmDeviceChoice() {
    if (!pendingDeviceView || !link?.id || deviceChoiceLocked) return;
    const selectedDevice = pendingDeviceView;

    codeSearchActiveRef.current = false;
    clearCodeSearchTimers();
    tvSearchActiveRef.current = false;
    setShowPreRequestModal(false);
    setAgreePreRequest(false);
    setShowTvRequestModal(false);
    setAgreeTvRequest(false);
    setCodeRequestState("idle");
    setCodeRequestSeconds(0);
    setCodeDisplayExpiresAt(null);
    setTvRequestState("idle");
    setTvSearchDeadlineAt(null);
    setTvDisplayExpiresAt(null);
    setVisibleTvApprovalUrl(null);

    if (supabase) {
      const { data, error } = await supabase
        .from("customer_links")
        .update({ selected_device: selectedDevice })
        .eq("id", link.id)
        .eq("code_request_limit", codeRequestLimit)
        .eq("code_requested_count", codeRequestedCount)
        .select("selected_device,code_request_limit,code_requested_count")
        .maybeSingle();

      if (error) {
        console.error("Supabase customer device lock error:", error);
        setToast({ label: "تعذر حفظ نوع الجهاز، حدّث الصفحة وحاول مجدداً", at: Date.now() });
        return;
      }

      if (!data?.selected_device) {
        const { data: currentLink, error: refreshError } = await supabase
          .from("customer_links")
          .select("selected_device,code_request_limit,code_requested_count")
          .eq("id", link.id)
          .maybeSingle();
        if (refreshError) console.error("Supabase customer device refresh error:", refreshError);
        if (currentLink) {
          setLink((current) => (current ? { ...current, ...currentLink } : current));
          if (currentLink.selected_device === "mobile" || currentLink.selected_device === "screen") {
            setDeviceView(currentLink.selected_device);
          }
        }
        setPendingDeviceView(null);
        setAgreeDeviceChoice(false);
        return;
      }
    }

    setLink((current) => (current ? { ...current, selected_device: selectedDevice } : current));
    setDeviceView(selectedDevice);
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
  }

  function cancelDeviceChoice() {
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
  }

  async function submitExtraCreditRequest(
    reasonType: ExtraCreditReason,
    description: string,
    screenshot: File,
    onProgress?: (progress: number) => void,
  ): Promise<ExtraCreditRequest | null> {
    if (!link?.id || extraCreditRequest?.status === "pending") return null;
    const cleanDescription = description.trim();
    if (cleanDescription.length < 10) {
      setToast({ label: "يجب ألا يقل وصف المشكلة عن 10 أحرف", tone: "error", at: Date.now() });
      return null;
    }

    if (!supabase) {
      const demoRequest: ExtraCreditRequest = {
        id: `demo-${Date.now()}`,
        customer_id: link.id,
        reason_type: reasonType,
        description: cleanDescription,
        image_url: URL.createObjectURL(screenshot),
        attachment_type: reasonType === "استبدال الجهاز أو الدخول بجهاز آخر" ? "video" : "image",
        status: "approved",
        created_at: new Date().toISOString(),
      };
      setExtraCreditRequest(demoRequest);
      onProgress?.(100);
      return demoRequest;
    }

    try {
      onProgress?.(5);
      const attachmentType = reasonType === "استبدال الجهاز أو الدخول بجهاز آخر" ? "video" : "image";
      const extension =
        screenshot.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
        (attachmentType === "video" ? "mp4" : "jpg");
      const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const storagePath = `credit-requests/${link.id}/${randomPart}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(extraCreditStorageBucket)
        .upload(storagePath, screenshot, { contentType: screenshot.type, upsert: false });
      if (uploadError) throw uploadError;
      onProgress?.(30);

      const { data: publicUrlData } = supabase.storage.from(extraCreditStorageBucket).getPublicUrl(storagePath);
      const imageUrl = publicUrlData.publicUrl;
      const { data, error } = await supabase
        .from("extra_credit_requests")
        .insert({
          customer_id: link.id,
          reason_type: reasonType,
          description: cleanDescription,
          image_url: imageUrl,
          attachment_type: attachmentType,
          status: "pending",
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          setToast({ label: "لديك طلب قيد المراجعة بالفعل", tone: "error", at: Date.now() });
          return null;
        }
        throw error;
      }

      setExtraCreditRequest(data as ExtraCreditRequest);
      onProgress?.(35);
      processExtraCreditRequestInBackground(data.id);
      return data as ExtraCreditRequest;
    } catch (error) {
      console.error("Extra credit request submit error:", error);
      setToast({ label: "تعذر إرسال الطلب، تحقق من المرفق وحاول مرة أخرى", tone: "error", at: Date.now() });
      return null;
    }
  }

  async function checkExtraCreditRequestStatus(requestId: string): Promise<ExtraCreditRequest | null> {
    if (!supabase) {
      return extraCreditRequest?.id === requestId ? extraCreditRequest : null;
    }

    const { data, error } = await supabase
      .from("extra_credit_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (error) {
      console.error("Supabase extra credit request status error:", error);
      return null;
    }

    const request = (data || null) as ExtraCreditRequest | null;
    if (request) setExtraCreditRequest(request);

    if (request && (request.status === "approved" || request.status === "rejected") && link?.id) {
      const refreshedLink = await loadCustomerLinkRecord("id", link.id);
      if (refreshedLink) setLink(refreshedLink);
    }

    return request;
  }

  function openPreRequestModal() {
    if (!automatedCodeEnabled || attemptUsed || codeIsVisible) return;
    setShowPreRequestModal(true);
    setAgreePreRequest(false);
  }

  function confirmPreRequest() {
    if (!automatedCodeEnabled || !link?.id || !hasCodeRequestCredit) return;

    setShowPreRequestModal(false);
    setAgreePreRequest(false);
    void startCodeRequest();
  }

  function clearCodeSearchTimers() {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    pollTimerRef.current = null;
    timeoutRef.current = null;
    countdownRef.current = null;
  }

  async function showVerificationCode(latestCode: VerificationCodeResult, message: string) {
    if (!latestCode.code || !latestCode.receivedAt) return false;

    const usedAt = new Date().toISOString();
    const lockedRequestedCount = codeRequestLimit;
    let nextCode = latestCode.code;
    let nextReceivedAt = latestCode.receivedAt;

    if (supabase && link?.id) {
      if (!latestCode.messageId) {
        codeSearchActiveRef.current = false;
        clearCodeSearchTimers();
        setCodeDisplayExpiresAt(null);
        setCodeRequestState("failed");
        return false;
      }

      let consumed;
      try {
        consumed = await consumeVerificationMessage(latestCode.messageId, link.id, usedAt);
      } catch {
        codeSearchActiveRef.current = false;
        clearCodeSearchTimers();
        setCodeDisplayExpiresAt(null);
        setCodeRequestState("failed");
        return false;
      }

      if (!consumed?.message_id || !consumed.code) {
        codeSearchActiveRef.current = false;
        clearCodeSearchTimers();
        setCodeDisplayExpiresAt(null);
        setCodeRequestState("failed");
        return false;
      }

      nextCode = consumed.code;
      nextReceivedAt = consumed.received_at || latestCode.receivedAt;
    }

    setLink((current) =>
      current?.accounts
        ? {
            ...current,
            code_requested_count: lockedRequestedCount,
            code_used_at: usedAt,
            verification_code: nextCode,
            verification_code_received_at: nextReceivedAt,
            accounts: {
              ...current.accounts,
              verification_code: nextCode,
              verification_code_received_at: nextReceivedAt,
            },
          }
        : current,
    );
    codeSearchActiveRef.current = false;
    clearCodeSearchTimers();
    setCodeRequestSeconds(0);
    setCodeDisplayExpiresAt(Date.now() + verificationCodeLifetimeMs);
    setCodeRequestState("ready");
    setToast({ label: message, at: Date.now() });
    return true;
  }

  async function pollVerificationCode(accountId: string) {
    if (!codeSearchActiveRef.current) return;

    try {
      const latestCode = await readLatestVerificationCode(accountId, link?.id, true);
      if (!codeSearchActiveRef.current || latestCode.error || !latestCode.code || !latestCode.receivedAt) return;

      const baseline = requestBaselineRef.current;
      const baselineTime = baseline.receivedAt ? new Date(baseline.receivedAt).getTime() : 0;
      const latestTime = new Date(latestCode.receivedAt).getTime();
      const isNewerCode =
        !Number.isNaN(latestTime) &&
        (latestCode.messageId !== baseline.messageId ||
          latestTime > baselineTime ||
          (!baseline.receivedAt && latestCode.code !== baseline.code));

      if (isNewerCode) {
        await showVerificationCode(latestCode, "تم استلام كود جديد");
      }
    } catch (error) {
      console.error("Verification code polling error:", error);
    }
  }

  async function finishCodeSearch(accountId: string) {
    if (!codeSearchActiveRef.current) return;
    codeSearchActiveRef.current = false;
    clearCodeSearchTimers();
    setCodeRequestSeconds(0);

    try {
      const latestCode = await readLatestVerificationCode(accountId, link?.id, true);
      const latestTime = latestCode.receivedAt ? new Date(latestCode.receivedAt).getTime() : 0;
      const codeAge = latestTime ? Date.now() - latestTime : Number.POSITIVE_INFINITY;
      const isWithinFallbackWindow =
        Boolean(latestCode.code) &&
        !latestCode.error &&
        !Number.isNaN(latestTime) &&
        codeAge >= 0 &&
        codeAge <= verificationCodeFallbackWindowMs;

      if (isWithinFallbackWindow) {
        if (await showVerificationCode(latestCode, "تم عرض أحدث كود متاح خلال آخر 15 دقيقة")) return;
      }
    } catch (error) {
      console.error("Verification code fallback error:", error);
    }

    setCodeDisplayExpiresAt(null);
    setCodeRequestErrorMessage("جاري انتظار وصول الكود، يرجى إعادة المحاولة خلال ثوانٍ");
    setCodeRequestState("failed");
  }

  async function startCodeRequest() {
    const accountId = account?.id;
    if (!automatedCodeEnabled || !accountId) return;

    clearCodeSearchTimers();
    codeSearchActiveRef.current = true;
    setCodeRequestState("loading");
    setCodeRequestErrorMessage(null);
    setCodeRequestSeconds(15);
    setCodeDisplayExpiresAt(null);

    try {
      const latestCode = await readLatestVerificationCode(accountId, link?.id, true);
      const latestTime = latestCode.receivedAt
        ? new Date(latestCode.receivedAt).getTime()
        : 0;
      const codeAge = latestTime
        ? Date.now() - latestTime
        : Number.POSITIVE_INFINITY;
      const isRecentStoredCode =
        Boolean(latestCode.code) &&
        !latestCode.error &&
        Number.isFinite(latestTime) &&
        codeAge >= 0 &&
        codeAge <= verificationCodeFallbackWindowMs;

      if (isRecentStoredCode) {
        if (await showVerificationCode(
          latestCode,
          "تم عرض أحدث كود متاح خلال آخر 15 دقيقة",
        )) return;
      }

      requestBaselineRef.current = {
        messageId: latestCode.messageId,
        code: latestCode.code || storedVerificationCode,
        receivedAt:
          latestCode.receivedAt ||
          storedVerificationCodeReceivedAt ||
          null,
      };
    } catch (error) {
      console.error("Initial verification code lookup error:", error);
      requestBaselineRef.current = {
        messageId: null,
        code: storedVerificationCode,
        receivedAt: storedVerificationCodeReceivedAt,
      };
    }

    countdownRef.current = window.setInterval(() => {
      setCodeRequestSeconds((current) => {
        if (current <= 1) {
          if (countdownRef.current) window.clearInterval(countdownRef.current);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    void pollVerificationCode(accountId);
    pollTimerRef.current = window.setInterval(() => {
      void pollVerificationCode(accountId);
    }, 2000);

    timeoutRef.current = window.setTimeout(() => {
      void finishCodeSearch(accountId);
    }, 15_000);
  }

  if (link && account?.account_type === "compensation") {
    return <CompensationAccountCustomerView link={link} account={account} navigate={navigate} />;
  }

  return (
    <Shell toast={toast}>
      <div className="min-h-screen bg-gradient-to-b from-[#F3F4F6] via-[#F9FAFB] to-white px-4 pb-24 pt-6 md:pb-28 md:pt-10" dir="rtl">
        <div className="mx-auto w-full max-w-[640px]">
          <header className="mb-8 rounded-[2rem] border border-white bg-white/80 p-4 shadow-premium backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-lg font-black text-white", theme.gradient, theme.glow)}>
                زون
              </div>
              <div>
                <p className={cn("text-sm font-black", theme.accent)}>Zone Store</p>
                <h1 className="mt-1 text-xl font-black md:text-2xl">اشتراك {theme.name}</h1>
                {link?.link_number != null && (
                  <p className={cn("mt-1 text-xs font-black", theme.accent)}>عميل رقم #{link.link_number}</p>
                )}
              </div>
              </div>
              <button
                onClick={() => navigate("/")}
                className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition duration-300 hover:-translate-y-1 hover:text-white", theme.soft, theme.hoverBg)}
                aria-label="الإدارة"
              >
                <UserRound className="h-6 w-6" />
              </button>
            </div>
            {!normalClientLayout && link?.client_code && (
              <div className="mt-4 border-t border-[#EEE7F8] pt-4">
                <CompensationCodeCard code={link.client_code} compact showPageLink />
              </div>
            )}
          </header>

          {loading && (
            <div className="flex min-h-96 items-center justify-center rounded-[2rem] bg-white text-sm font-black text-zinc-500 shadow-premium">
              جاري تحميل بيانات الاشتراك...
            </div>
          )}

          {!loading && (!link || !account) && (
            <div className="flex min-h-96 items-center justify-center rounded-[2rem] bg-white text-sm font-black text-zinc-500 shadow-premium">
              الرابط غير صحيح أو لم يعد متاحاً.
            </div>
          )}

          {link && account && (
            <div className="space-y-6">
              {service !== "osn" && (
                <section className="animate-rise" aria-labelledby="tutorials-title">
                  <div className="mb-4 flex items-center gap-3 px-1">
                    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", theme.soft)}>
                      <MonitorPlay className="h-5 w-5" />
                    </div>
                    <div>
                      <p className={cn("text-xs font-black", theme.accent)}>ابدأ من هنا</p>
                      <h2 id="tutorials-title" className="text-xl font-black text-zinc-950 md:text-2xl">شرح طريقة الدخول</h2>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                    {tutorialCards.map((tutorial) => {
                      const TutorialIcon = tutorial.icon;
                      const thumbnail = tutorialThumbnailUrl(tutorial.url);
                      return (
                        <button
                          key={tutorial.id}
                          type="button"
                          onClick={() => setActiveTutorial({ title: tutorial.title, url: tutorial.url })}
                          className="group min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white text-right shadow-card transition hover:-translate-y-1 hover:border-[#CDB4F5] hover:shadow-[0_18px_38px_rgba(80,45,135,0.16)] focus:outline-none focus:ring-4 focus:ring-[#8B35F5]/15"
                        >
                          <span className="relative block aspect-[4/3] overflow-hidden bg-zinc-900">
                            {thumbnail ? (
                              <img
                                src={thumbnail}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                              />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center bg-zinc-900 text-white">
                                <TutorialIcon className="h-10 w-10" />
                              </span>
                            )}
                            <span className="absolute inset-0 bg-zinc-950/20 transition group-hover:bg-zinc-950/10" />
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#8B35F5] shadow-xl transition group-hover:scale-110">
                                <Play className="h-5 w-5 fill-current" />
                              </span>
                            </span>
                          </span>
                          <span className="flex min-h-[88px] items-start gap-2 p-3 md:min-h-[82px] md:p-4">
                            <TutorialIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#8B35F5]" />
                            <span className="text-xs font-black leading-6 text-zinc-900 sm:text-sm">{tutorial.title}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
                <div className="mb-6 text-center">
                  <div className={cn("mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl", theme.soft)}>
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <h2 className="text-3xl font-black md:text-4xl">بيانات تسجيل الدخول</h2>
                </div>

                <div className="space-y-5">
                  <LoginCopyCard label="البريد الإلكتروني" value={account.email} icon={Mail} setToast={setToast} theme={theme} />
                  {service !== "osn" && normalClientLayout && account.hide_password_from_client !== true && account.password && (
                    <LoginCopyCard label="كلمة المرور" value={account.password} icon={KeyRound} setToast={setToast} theme={theme} />
                  )}
                  {!normalClientLayout && link.client_code && <CompensationCodeCard code={link.client_code} showPageLink />}
                  {service === "osn" ? (
                    <div className="rounded-[1.75rem] border border-emerald-200 bg-gradient-to-l from-white to-emerald-50 p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <WhatsAppLogo className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black text-zinc-950">طلب كود تفعيل OSN</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-600">
                            بعد إدخال البريد في OSN وطلب الكود، تواصل مع الدعم وسيتم تجهيز الكود الخاص بحسابك.
                          </p>
                        </div>
                      </div>
                      <a
                        href={osnCodeSupportWhatsAppUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#16A34A] px-4 text-center text-base font-black text-white shadow-[0_14px_32px_rgba(22,163,74,0.24)] transition hover:-translate-y-0.5 hover:bg-[#12843D]"
                      >
                        <WhatsAppLogo className="h-5 w-5 shrink-0" />
                        للحصول على الكود تواصل مع الدعم الفني على الواتس
                      </a>
                    </div>
                  ) : serviceOutageActive ? (
                    <div
                      className="overflow-hidden rounded-[1.75rem] border border-red-200 bg-gradient-to-b from-red-50 via-white to-zinc-50 p-5 text-center shadow-[0_18px_42px_rgba(229,9,20,0.12)]"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-[#E50914] shadow-[0_12px_28px_rgba(229,9,20,0.14)]">
                        <Settings className="h-8 w-8" />
                      </div>
                      <p className="mt-4 text-xs font-black text-[#E50914]">الخدمة تحت الصيانة حالياً</p>
                      <h3 className="mt-2 text-xl font-black leading-8 text-zinc-950">نعتذر عن التوقف الطارئ</h3>
                      <p className="mt-3 text-sm font-bold leading-8 text-zinc-700">
                        نعتذر منك جداً، توجد مشكلة صيانة حالية في الخدمة وجاري العمل على معالجتها. لحفظ حقك في التعويض، اضغط الزر أدناه ثم أدخل رمز التعويض الخاص بك وقدّم الطلب. تستغرق المراجعة من ساعة إلى 24 ساعة، وعند اكتمالها سيظهر رابط الحساب الجديد داخل صفحة التعويض.
                      </p>
                      <a
                        href="/compensation"
                        className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#E50914] px-4 text-base font-black text-white shadow-[0_14px_30px_rgba(229,9,20,0.24)] transition hover:-translate-y-0.5 hover:bg-[#C90812]"
                      >
                        <Clipboard className="h-5 w-5" />
                        رفع طلب تعويض ومتابعته
                      </a>
                    </div>
                  ) : usesExternalCodeLink ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <ExternalLink className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">جلب الكود عبر الرابط الخارجي</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            اضغط على الزر للانتقال مباشرة إلى صفحة جلب الكود الخاصة بهذا الحساب.
                          </p>
                        </div>
                      </div>
                      {externalCodeUsed ? (
                        <button
                          type="button"
                          disabled
                          className="mt-4 flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-zinc-200 px-4 text-sm font-black text-zinc-500"
                        >
                          <LockKeyhole className="h-5 w-5" />
                          انتهت صلاحية رابط الكود
                        </button>
                      ) : usesExternalCodeLink ? (
                        <div className="mt-4 space-y-3">
                          <button
                            type="button"
                            disabled={externalCodeSubmitting}
                            onClick={openExternalCodeWarning}
                            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] px-4 text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD] disabled:cursor-wait disabled:opacity-70"
                          >
                            <ExternalLink className="h-5 w-5" />
                            جلب الكود عبر الرابط الخارجي
                          </button>
                          {externalCodeRemainingSeconds != null && externalCodeRemainingSeconds > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-black text-amber-800" role="timer">
                              متبقي على انتهاء صلاحية الرابط: {String(Math.floor(externalCodeRemainingSeconds / 60)).padStart(2, "0")}:
                              {String(externalCodeRemainingSeconds % 60).padStart(2, "0")}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-black text-rose-700">
                          رابط جلب الكود غير متوفر حالياً، يرجى التواصل مع المتجر.
                        </p>
                      )}
                    </div>
                  ) : !automatedCodeEnabled ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <WhatsAppLogo className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">للحصول على كود التحقق، تواصل معنا عبر الواتساب</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            هذا الحساب قديم ويعمل بالنظام اليدوي فقط، وسيتم تجهيز الكود من الدعم مباشرة.
                          </p>
                        </div>
                      </div>
                      <a
                        href={unavailableResultWhatsAppUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD]"
                      >
                        <WhatsAppLogo className="h-5 w-5" />
                        تواصل معنا عبر الواتساب
                      </a>
                    </div>
                  ) : (
                    <>
                  <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-[#F8F4FF] p-3 shadow-card">
                    <p className="mb-3 px-2 text-sm font-black text-zinc-700">حدد الجهاز</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => requestDeviceChoice("mobile")}
                        disabled={deviceChoiceLocked || deviceView === "mobile"}
                        className={cn(
                          "flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-black transition disabled:cursor-not-allowed",
                          deviceView === "mobile"
                            ? "bg-[#8B35F5] text-white shadow-[0_12px_26px_rgba(139,53,245,0.22)]"
                            : "bg-white text-[#7C2CE8] hover:bg-[#F0E7FF]",
                        )}
                      >
                        <Smartphone className="h-4 w-4" />
                        جوال / آيباد / بي سي / لابتوب
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeviceChoice("screen")}
                        disabled={deviceChoiceLocked || deviceView === "screen"}
                        className={cn(
                          "flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-black transition disabled:cursor-not-allowed",
                          deviceView === "screen"
                            ? "bg-[#8B35F5] text-white shadow-[0_12px_26px_rgba(139,53,245,0.22)]"
                            : "bg-white text-[#7C2CE8] hover:bg-[#F0E7FF]",
                        )}
                      >
                        <MonitorPlay className="h-4 w-4" />
                        شاشة / سوني
                      </button>
                    </div>
                    {deviceChoiceLocked ? (
                      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-rose-600">
                        تم استهلاك رصيد المحاولة وقفل التبديل بين الأجهزة. سيُفتح مجدداً عند قبول طلب رصيد إضافي.
                      </p>
                    ) : deviceView ? (
                      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-[#7C2CE8]">
                        يمكنك التبديل بين أنواع الأجهزة بحرية حتى يتم استخدام الرمز أو رابط الدخول الحالي.
                      </p>
                    ) : (
                      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-zinc-600">
                        يرجى تحديد نوع الجهاز الذي تستخدمه لتسجيل الدخول أولاً
                      </p>
                    )}
                  </div>

                  {!deviceView && attemptUsed ? (
                    <div className="rounded-[1.75rem] border border-rose-200 bg-rose-50 p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-rose-600">
                          <ShieldCheck className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black text-rose-700">نفاذ رصيد طلب الأكواد لهذا الحساب</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-rose-600">
                            تم حفظ حالة الاستخدام في قاعدة البيانات ولا يمكن إعادة اختيار الجهاز أو طلب كود جديد.
                          </p>
                        </div>
                      </div>
                      <ExtraCreditRequestAction
                        status={extraCreditRequest?.status}
                        aiDecision={extraCreditRequest?.ai_decision}
                        rejectionReason={extraCreditRequest?.ai_rejection_reason || extraCreditRequest?.review_reason}
                        onOpen={() => setShowExtraCreditModal(true)}
                      />
                    </div>
                  ) : !deviceView ? null : deviceView === "screen" ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-right shadow-[0_10px_26px_rgba(217,119,6,0.10)]">
                        <p className="text-sm font-black leading-7 text-amber-900">
                          💡 ملاحظة مهمة: إذا كانت شاشتك تظهر كوداً رقمياً بدلاً من الرابط، يمكنك التحويل إلى قسم (جوال / آيباد / بي سي / لابتوب) وأخذ الكود المباشر من هناك وتسجيل الدخول به في شاشتك بسهولة!
                        </p>
                      </div>

                      {tvRequestState === "ready" && visibleTvApprovalUrl ? (
                        <div className="mb-4">
                          <a
                            href={visibleTvApprovalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#E50914] to-red-700 px-4 text-center text-sm font-black text-white shadow-[0_14px_34px_rgba(229,9,20,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(229,9,20,0.3)]"
                          >
                            <ExternalLink className="h-5 w-5" />
                            اضغط هنا لتسجيل الدخول المباشر للشاشة / سوني
                          </a>
                          <p className="mt-3 text-center text-xs font-black text-rose-600">
                            ينتهي عرض الرابط خلال: {String(Math.floor(tvDisplaySecondsRemaining / 60)).padStart(2, "0")}:
                            {String(tvDisplaySecondsRemaining % 60).padStart(2, "0")}
                          </p>
                        </div>
                      ) : tvRequestState === "searching" ? (
                        <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-white px-4 py-3 text-center text-xs font-black text-[#7C2CE8]">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          جاري البحث عن رابط الموافقة... {tvSearchSecondsRemaining}s
                        </div>
                      ) : tvRequestState === "failed" ? (
                        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-center">
                          <p className="text-xs font-black leading-6 text-rose-700">
                            لم يصل الرمز أو الرابط بعد؟ يرجى متابعة الشرح جيداً لكي تفهم هذه الخطوة وتتأكد من تطبيقها بالشكل الصحيح على نتفليكس، ثم اضغط على إعادة المحاولة.
                          </p>
                          {attemptUsed ? (
                            <ExtraCreditRequestAction
                              status={extraCreditRequest?.status}
                              aiDecision={extraCreditRequest?.ai_decision}
                              rejectionReason={extraCreditRequest?.ai_rejection_reason || extraCreditRequest?.review_reason}
                              onOpen={() => setShowExtraCreditModal(true)}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={openTvRequestModal}
                              className="mt-3 min-h-12 w-full rounded-xl border border-rose-200 bg-white px-4 text-sm font-black text-rose-700 transition hover:bg-rose-100"
                            >
                              إعادة محاولة جلب الرابط
                            </button>
                          )}
                        </div>
                      ) : tvRequestState === "expired" ? (
                        <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-4 text-center">
                          <p className="text-xs font-black leading-6 text-rose-700">
                            نفدت المحاولات المتاحة لهذا الحساب
                          </p>
                          <ExtraCreditRequestAction
                            status={extraCreditRequest?.status}
                            aiDecision={extraCreditRequest?.ai_decision}
                            rejectionReason={extraCreditRequest?.ai_rejection_reason || extraCreditRequest?.review_reason}
                            onOpen={() => setShowExtraCreditModal(true)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={openTvRequestModal}
                          disabled={tvAttemptUsed}
                          className="mb-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#E50914] to-red-700 px-4 text-center text-sm font-black text-white shadow-[0_14px_34px_rgba(229,9,20,0.24)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(229,9,20,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <MonitorPlay className="h-5 w-5" />
                          جلب رابط الدخول للشاشة / سوني
                        </button>
                      )}
                    </div>
                  ) : codeRequestState === "loading" ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-[#FCFAFF] p-4 shadow-card">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-zinc-700">جاري فحص وتحديث الكود...</p>
                          <p className="mt-1 text-xs font-bold text-zinc-500">سيتم فحص الحساب كل ثانيتين لمدة 15 ثانية</p>
                        </div>
                        <div className="rounded-full bg-[#F5EEFF] px-4 py-2 text-sm font-black text-[#7C2CE8]">
                          {codeRequestSeconds}s
                        </div>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#EDE3FF]">
                        <div
                          className="h-full rounded-full bg-[#8B35F5] transition-all"
                          style={{ width: `${(Math.max(15 - codeRequestSeconds, 0) / 15) * 100}%` }}
                        />
                      </div>
                    </div>
                  ) : deviceView === "mobile" && codeIsVisible ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-[#FCFAFF] p-4 shadow-card">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-zinc-700">كود التحقق</p>
                          <p className="text-xs font-bold text-zinc-500">تم العثور عليه من Supabase</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(storedVerificationCode || "", setToast)}
                          className="flex h-10 items-center gap-2 rounded-xl border border-[#E0D4F8] bg-white px-4 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
                        >
                          <Clipboard className="h-4 w-4" />
                          نسخ الكود
                        </button>
                      </div>
                      <div className="rounded-2xl border border-[#E0D4F8] bg-white px-4 py-4 text-center">
                        <p className="font-mono text-4xl font-black tracking-[0.3em] text-[#8B35F5]" dir="ltr">
                          {storedVerificationCode}
                        </p>
                        {storedVerificationCodeReceivedAt && (
                          <p className="mt-2 text-xs font-bold text-zinc-500">
                            {formatDateTime(storedVerificationCodeReceivedAt)}
                          </p>
                        )}
                        <p className="mt-2 text-xs font-black text-[#7C2CE8]">
                          ينتهي الكود خلال: {String(Math.floor(codeSecondsRemaining / 60)).padStart(2, "0")}:
                          {String(codeSecondsRemaining % 60).padStart(2, "0")}
                        </p>
                        {attemptUsed && (
                          <p className="mt-2 text-xs font-bold text-zinc-500">تم استهلاك محاولة طلب الكود لهذا الحساب.</p>
                        )}
                      </div>
                    </div>
                  ) : deviceView === "mobile" && codeRequestState === "failed" ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-white p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                          <CircleX className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">لم يصل الرمز أو الرابط بعد؟</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            {codeRequestErrorMessage
                              || "يرجى متابعة الشرح جيداً لكي تفهم هذه الخطوة وتتأكد من تطبيقها بالشكل الصحيح على نتفليكس، ثم اضغط على إعادة المحاولة."}
                          </p>
                        </div>
                      </div>
                      {attemptUsed ? (
                        <ExtraCreditRequestAction
                          status={extraCreditRequest?.status}
                          aiDecision={extraCreditRequest?.ai_decision}
                          rejectionReason={extraCreditRequest?.ai_rejection_reason || extraCreditRequest?.review_reason}
                          onOpen={() => setShowExtraCreditModal(true)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={openPreRequestModal}
                          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-white text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
                        >
                          <RefreshCw className="h-4 w-4" />
                          إعادة المحاولة والبحث مجدداً
                        </button>
                      )}
                    </div>
                  ) : deviceView === "mobile" &&
                    (codeRequestState === "expired" || (attemptUsed && codeRequestState === "idle")) ? (
                    <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-amber-700">
                          <Clock3 className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black text-amber-900">انتهت صلاحية الرمز والحد المتاح لهذه الجلسة</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-amber-800">
                            لا يمكن البحث مجدداً إلا بعد أن يقوم المشرف بتجديد رصيد المحاولات.
                          </p>
                        </div>
                      </div>
                      <ExtraCreditRequestAction
                        status={extraCreditRequest?.status}
                        aiDecision={extraCreditRequest?.ai_decision}
                        rejectionReason={extraCreditRequest?.ai_rejection_reason || extraCreditRequest?.review_reason}
                        onOpen={() => setShowExtraCreditModal(true)}
                      />
                    </div>
                  ) : (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <LockKeyhole className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">{forwardedEmailCodeEnabled ? "جلب كود نتفليكس" : "طلب كود التحقق"}</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            {forwardedEmailCodeEnabled
                              ? "اضغط لعرض أحدث كود وصل من رسائل Outlook الموجّهة خلال آخر 15 دقيقة."
                              : "اضغط للبحث تلقائياً داخل قاعدة البيانات لمدة 15 ثانية."}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openPreRequestModal}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD]"
                      >
                        <KeyRound className="h-4 w-4" />
                        {forwardedEmailCodeEnabled ? "جلب كود نتفليكس / Fetch Code" : "طلب كود التحقق"}
                      </button>
                    </div>
                  )}
                    </>
                  )}
                </div>
              </section>

              <section className="animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
                <div className="mb-6 text-center">
                  <div className={cn("mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl", theme.soft)}>
                    <LockKeyhole className="h-6 w-6" />
                  </div>
                  <h2 className="text-3xl font-black md:text-4xl">بيانات ملفك الخاص</h2>
                  <p className="mt-3 text-sm font-bold text-zinc-500">استخدم اسم الملف والرمز فقط عند تسجيل الدخول.</p>
                </div>

                <div className={cn("grid gap-4", service === "netflix" && "sm:grid-cols-2")}>
                  <ProfileMiniCard label="اسم الملف" value={`ملف ${link.profile_label}`} icon={UserRound} setToast={setToast} theme={theme} />
                  {service === "netflix" && (
                    profilePinRevealed ? (
                      <ProfileMiniCard label="رمز الملف" value={getProfilePin(link)} icon={LockKeyhole} setToast={setToast} theme={theme} ltr />
                    ) : (
                      <article className="rounded-3xl border border-[#E0D4F8] bg-gradient-to-b from-white to-[#F8F4FF] p-4 shadow-inner">
                        <div className={cn("mb-4 flex items-center justify-center gap-2 text-sm font-black", theme.accent)}>
                          <LockKeyhole className="h-5 w-5" />
                          رمز الملف
                        </div>
                        <div className="mb-4 flex h-10 items-center justify-center gap-2 rounded-xl bg-[#EEE7F8] text-zinc-400" aria-label="رمز الملف مخفي">
                          <span className="text-xl font-black tracking-[0.35em]">••••</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAgreeProfilePinWarning(false);
                            setShowProfilePinWarning(true);
                          }}
                          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] px-4 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD]"
                        >
                          <Eye className="h-4 w-4" />
                          اضغط لإظهار الرمز السري للملف
                        </button>
                      </article>
                    )
                  )}
                </div>
              </section>

              <section className="animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
                <div className="mb-6 text-center">
                  <p className={cn("bg-gradient-to-l bg-clip-text text-sm font-black text-transparent", theme.gradient)}>اتبعها بالترتيب</p>
                  <h2 className="text-3xl font-black md:text-4xl">خطوات الدخول إلى {theme.name}</h2>
                </div>
                <div className="space-y-3">
                  {service === "netflix" ? (
                    <>
                      <StepCard
                        step="Step 1"
                        icon={MonitorPlay}
                        title="تابع الشرح المرئي"
                        text="شاهد فيديو الشرح أولاً لفهم طريقة الدخول الصحيحة قبل البدء."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 2"
                        icon={Smartphone}
                        title="ابدأ تسجيل الدخول"
                        text="افتح تطبيق نتفليكس على جهازك وابدأ بطلب تسجيل الدخول أولاً."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 3"
                        icon={KeyRound}
                        title="اطلب الرمز أو الرابط"
                        text="اضغط على زر طلب الرمز، أو اطلب رابط الموافقة إذا كان جهازك شاشة أو سوني."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 4"
                        icon={Clipboard}
                        title="أكمل تسجيل الدخول"
                        text="انسخ الرمز أو افتح رابط الموافقة فوراً لإتمام تسجيل الدخول في نتفليكس."
                        theme={theme}
                      />
                    </>
                  ) : service === "osn" ? (
                    <>
                      <StepCard
                        step="Step 1"
                        icon={Tv}
                        title="افتح تطبيق OSN"
                        text="افتح تطبيق OSN أو الموقع الرسمي على جهازك."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 2"
                        icon={Mail}
                        title="أدخل البريد الإلكتروني"
                        text="انسخ البريد الإلكتروني الموضح في بيانات تسجيل الدخول وأدخله في OSN."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 3"
                        icon={WhatsAppLogo}
                        title="تواصل مع الدعم"
                        text="للحصول على الكود تواصل عبر الدعم من زر الواتساب الموجود في بيانات تسجيل الدخول."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 4"
                        icon={Clipboard}
                        title="أكمل تسجيل الدخول"
                        text="بعد استلام الكود من الدعم، أدخله فوراً في OSN لإتمام تسجيل الدخول."
                        theme={theme}
                      />
                    </>
                  ) : (
                    <>
                      <StepCard
                        step="Step 1"
                        icon={Smartphone}
                        title={`افتح ${theme.name}`}
                        text={`افتح تطبيق ${theme.name} أو الموقع الرسمي من جهازك.`}
                        theme={theme}
                      />
                      <StepCard
                        step="Step 2"
                        icon={Link2}
                        title="افتح رابط الحساب"
                        text="استخدم زر الدخول عبر الرابط لفتح الحساب في تبويب جديد."
                        theme={theme}
                      />
                      <StepCard
                        step="Step 3"
                        icon={MessageCircle}
                        title="تواصل عبر الواتساب"
                        text="إذا احتجت كود التحقق أو واجهت مشكلة، راسلنا مباشرة من الزر المخصص."
                        theme={theme}
                      />
                    </>
                  )}
                </div>

                {service === "shahid" && (
                  <p className="mt-6 text-center text-sm font-bold leading-7 text-zinc-600">
                    ملاحظة: يمكن فتح الرابط مباشرة، وللدعم السريع استخدم زر الواتساب بالأسفل.
                  </p>
                )}
              </section>

            </div>
          )}

          {activeTutorial && (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-zinc-950/75 p-3 backdrop-blur-md md:p-6"
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tutorial-video-title"
              onClick={() => setActiveTutorial(null)}
            >
              <div
                className="my-auto w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
                  <h2 id="tutorial-video-title" className="text-sm font-black leading-6 md:text-base">
                    {activeTutorial.title}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTutorial(null)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
                    aria-label="إغلاق الفيديو"
                    title="إغلاق"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="aspect-[9/16] w-full bg-black">
                  <iframe
                    key={activeTutorial.url}
                    src={autoplayVideoUrl(activeTutorial.url)}
                    title={activeTutorial.title}
                    className="h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
          )}

          {showDisclaimer && (
            <DisclaimerModal
              onToggle={(checked) => setAgreeDisclaimer(checked)}
              onContinue={() => {
                localStorage.setItem(disclaimerStorageKey, "true");
                setShowDisclaimer(false);
                setShowReminder(true);
                setAgreeDisclaimer(false);
              }}
              checked={agreeDisclaimer}
            />
          )}

          {showReminder && (
            <ReminderModal
              onClose={() => {
                setShowReminder(false);
                setToast({ label: "تمت الموافقة، يمكنك الآن متابعة بيانات الحساب.", at: Date.now() });
              }}
            />
          )}

          {showProfilePinWarning && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/65 p-4 backdrop-blur-sm" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="profile-pin-warning-title">
              <div className="w-full max-w-lg rounded-[2rem] border border-amber-200 bg-white p-5 shadow-2xl md:p-7">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-100 text-amber-600 shadow-[0_14px_35px_rgba(217,119,6,0.20)]">
                  <TriangleAlert className="h-11 w-11" />
                </div>
                <h2 id="profile-pin-warning-title" className="mt-5 text-center text-2xl font-black text-zinc-950 md:text-3xl">
                  تحذير هام جداً
                </h2>
                <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-black leading-8 text-zinc-900">
                  يمنع منعاً باتاً تغيير اسم الملف الخاص بك أو تعديل الرقم السري (PIN). مخالفة هذا الشروط تؤدي إلى إخراجك فوراً ومباشرة من الحساب وإلغاء اشتراكك نهائياً دون أي تعويض أو استرداد للمبلغ.
                </p>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#E0D4F8] bg-[#FAF8FD] p-4 text-sm font-black leading-7 text-zinc-800">
                  <input
                    type="checkbox"
                    checked={agreeProfilePinWarning}
                    onChange={(event) => setAgreeProfilePinWarning(event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#8B35F5]"
                  />
                  <span>أقر وأتعهد بعدم تغيير اسم الملف أو الرقم السري والتزام الشروط.</span>
                </label>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfilePinWarning(false);
                      setAgreeProfilePinWarning(false);
                    }}
                    className="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-600 transition hover:bg-zinc-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={!agreeProfilePinWarning}
                    onClick={() => {
                      setProfilePinRevealed(true);
                      setShowProfilePinWarning(false);
                      setAgreeProfilePinWarning(false);
                    }}
                    className="h-12 rounded-2xl bg-[#8B35F5] px-4 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    متابعة
                  </button>
                </div>
              </div>
            </div>
          )}

          {showExternalCodeWarning && (
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-zinc-950/70 p-4 backdrop-blur-sm"
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="external-code-warning-title"
            >
              <div className="my-auto w-full max-w-xl rounded-[2rem] border border-amber-200 bg-white p-5 shadow-2xl md:p-7">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-100 text-amber-600 shadow-[0_14px_35px_rgba(217,119,6,0.20)]">
                  <TriangleAlert className="h-11 w-11" />
                </div>
                <h2 id="external-code-warning-title" className="mt-5 text-center text-2xl font-black text-zinc-950 md:text-3xl">
                  تنبيه وشروط الاستخدام الهامة
                </h2>
                <div className="mt-4 space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-black leading-8 text-zinc-900">
                  <p>الكود مخصص للاستخدام على جهاز واحد فقط.</p>
                    <p>لا يمكن تبديل الجهاز إلا بإرفاق فيديو يوثق تسجيل الخروج من الجهاز الأول.</p>
                    <p>استخدام أكثر من جهاز يؤدي لإلغاء الاشتراك نهائياً دون تعويض.</p>
                  <p className="text-rose-700">تنبيه: هذا الرابط صالح للاستخدام والفتح لمرة واحدة فقط.</p>
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#E0D4F8] bg-[#FAF8FD] p-4 text-sm font-black leading-7 text-zinc-800">
                  <input
                    type="checkbox"
                    checked={agreeExternalCodeTerms}
                    onChange={(event) => setAgreeExternalCodeTerms(event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#8B35F5]"
                  />
                  <span>أوافق وأتعهد بالالتزام بشروط الجهاز الواحد.</span>
                </label>
                {externalCodeError && (
                  <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-black text-rose-700">
                    {externalCodeError}
                  </p>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={externalCodeSubmitting}
                    onClick={() => {
                      setShowExternalCodeWarning(false);
                      setAgreeExternalCodeTerms(false);
                      setExternalCodeError(null);
                    }}
                    className="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={!agreeExternalCodeTerms || externalCodeSubmitting}
                    onClick={() => void continueToExternalCode()}
                    className="min-h-12 rounded-2xl bg-[#8B35F5] px-4 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {externalCodeSubmitting ? "جاري تسجيل الاستخدام..." : "موافقة والانتقال لصفحة الكود"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showExtraCreditModal && link && (
            <ExtraCreditRequestModal
              onClose={() => setShowExtraCreditModal(false)}
              onSubmit={submitExtraCreditRequest}
              onCheckStatus={checkExtraCreditRequestStatus}
            />
          )}

          {automatedCodeEnabled && showTvRequestModal && (
            <TvRequestConfirmationModal
              checked={agreeTvRequest}
              onToggle={setAgreeTvRequest}
              onContinue={() => void startTvApprovalSearch()}
              onCancel={() => {
                setShowTvRequestModal(false);
                setAgreeTvRequest(false);
              }}
            />
          )}

          {automatedCodeEnabled && showPreRequestModal && (
            <PreRequestModal
              checked={agreePreRequest}
              onToggle={setAgreePreRequest}
              onContinue={confirmPreRequest}
              onCancel={() => {
                setShowPreRequestModal(false);
                setAgreePreRequest(false);
              }}
            />
          )}

          {automatedCodeEnabled && pendingDeviceView && (
            <DeviceChoiceModal
              deviceLabel={deviceLabel(pendingDeviceView)}
              checked={agreeDeviceChoice}
              onToggle={setAgreeDeviceChoice}
              onCancel={cancelDeviceChoice}
              onContinue={confirmDeviceChoice}
            />
          )}

          {link && account && (
            <a
              href={floatingSupportWhatsAppUrl}
              target="_blank"
              rel="noreferrer"
              className="fixed right-4 z-40 flex h-14 w-14 animate-whatsapp-pulse items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_14px_35px_rgba(37,211,102,0.30)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-[#1EBE5D] hover:shadow-[0_18px_40px_rgba(37,211,102,0.38)] md:right-6"
              style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
              aria-label="تواصل مع الدعم عبر واتساب"
              title="تواصل مع الدعم عبر واتساب"
            >
              <WhatsAppLogo className="h-7 w-7" />
            </a>
          )}
        </div>
      </div>
    </Shell>
  );
}

function ExtraCreditRequestAction({
  status,
  aiDecision,
  rejectionReason,
  onOpen,
}: {
  status?: ExtraCreditRequestStatus;
  aiDecision?: ExtraCreditRequest["ai_decision"];
  rejectionReason?: string | null;
  onOpen: () => void;
}) {
  if (status === "rejected") {
    return (
      <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-black leading-6 text-rose-700">
        <p>تم رفض طلبك للحصول على رصيد إضافي</p>
        {rejectionReason && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-white/80 px-3 py-3 text-right">
            <p className="text-[11px] font-black text-rose-600">سبب عدم قبول المرفق:</p>
            <p className="mt-1 text-sm font-bold leading-7 text-zinc-800">{rejectionReason}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 min-h-12 w-full rounded-xl bg-[#8B35F5] px-4 text-sm font-black text-white shadow-[0_10px_24px_rgba(139,53,245,0.22)] transition hover:bg-[#7626DD]"
        >
          تقديم طلب رصيد جديد
        </button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs font-black leading-6 text-amber-800">
        {aiDecision === "manual_review"
          ? "تم فحص طلبك آلياً وإحالته للمراجعة اليدوية لضمان دقة القرار"
          : "تم تقديم طلبك بنجاح وجارٍ فحصه حالياً"}
      </div>
    );
  }

  if (status === "approved") {
    return (
      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-black leading-6 text-emerald-700">
        تم قبول طلبك وإضافة محاولة جديدة إلى حسابك
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#8B35F5] px-5 py-3.5 text-base font-bold text-white shadow-[0_14px_32px_rgba(139,53,245,0.28)] transition hover:-translate-y-0.5 hover:bg-[#7626DD] hover:shadow-[0_18px_36px_rgba(139,53,245,0.34)] active:translate-y-0"
    >
      <Sparkles className="h-5 w-5 shrink-0" />
      طلب رصيد إضافي
    </button>
  );
}

function ExtraCreditRequestModal({
  onClose,
  onSubmit,
  onCheckStatus,
}: {
  onClose: () => void;
  onSubmit: (
    reasonType: ExtraCreditReason,
    description: string,
    screenshot: File,
    onProgress?: (progress: number) => void,
  ) => Promise<ExtraCreditRequest | null>;
  onCheckStatus: (requestId: string) => Promise<ExtraCreditRequest | null>;
}) {
  type ReviewPhase = "form" | "checking" | "approved" | "rejected" | "manual";
  const [reasonType, setReasonType] = useState<ExtraCreditReason>(extraCreditReasons[0]);
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pledgeAccepted, setPledgeAccepted] = useState(false);
  const [phase, setPhase] = useState<ReviewPhase>("form");
  const [decisionRequest, setDecisionRequest] = useState<ExtraCreditRequest | null>(null);
  const [reviewProgress, setReviewProgress] = useState(0);
  const mountedRef = useRef(true);
  const manualCloseTimerRef = useRef<number | null>(null);
  const requiresVideo = reasonType === "استبدال الجهاز أو الدخول بجهاز آخر";

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (manualCloseTimerRef.current) window.clearTimeout(manualCloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "checking") return;

    const progressTimer = window.setInterval(() => {
      setReviewProgress((current) => {
        if (current < 30) return Math.min(29, current + 2);
        if (current < 80) return Math.min(79, current + 1.5);
        if (current < 96) return Math.min(96, current + 0.35);
        return current;
      });
    }, 350);

    return () => window.clearInterval(progressTimer);
  }, [phase]);

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  async function waitForDecision(createdRequest: ExtraCreditRequest) {
    let latestRequest = createdRequest;

    while (mountedRef.current) {
      try {
        const refreshedRequest = await onCheckStatus(createdRequest.id);
        if (refreshedRequest) latestRequest = refreshedRequest;

        if (
          latestRequest.status === "approved" ||
          latestRequest.status === "rejected" ||
          latestRequest.ai_decision === "manual_review"
        ) {
          return latestRequest;
        }

        if (latestRequest.ai_decision === "processing") {
          setReviewProgress((current) => Math.max(current, 45));
        }
      } catch (pollError) {
        console.error("Extra credit request polling error:", pollError);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
    }

    return latestRequest;
  }

  function resetForAnotherRequest() {
    if (manualCloseTimerRef.current) window.clearTimeout(manualCloseTimerRef.current);
    setReasonType(extraCreditReasons[0]);
    setDescription("");
    setScreenshot(null);
    setError("");
    setSubmitting(false);
    setPledgeAccepted(false);
    setDecisionRequest(null);
    setReviewProgress(0);
    setPhase("form");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanDescription = description.trim();
    if (cleanDescription.length < 10) {
      setError("يجب ألا يقل وصف المشكلة عن 10 أحرف.");
      return;
    }
    if (!screenshot) {
      setError(requiresVideo ? "يرجى إرفاق مقطع فيديو يوضح تسجيل الخروج." : "يرجى إرفاق صورة إثبات للمشكلة.");
      return;
    }
    if (requiresVideo && !screenshot.type.startsWith("video/")) {
      setError("هذا السبب يتطلب إرفاق مقطع فيديو.");
      return;
    }
    if (!requiresVideo && !screenshot.type.startsWith("image/")) {
      setError("يرجى إرفاق صورة إثبات للمشكلة.");
      return;
    }
    if (!pledgeAccepted) {
      setError("يجب الموافقة على الإقرار والتعهد أولاً لإتمام إرسال الطلب.");
      return;
    }
    setError("");
    setSubmitting(true);
    setReviewProgress(3);
    setPhase("checking");
    const createdRequest = await onSubmit(
      reasonType,
      cleanDescription,
      screenshot,
      (progress) => setReviewProgress((current) => Math.max(current, progress)),
    );
    if (!mountedRef.current) return;
    setSubmitting(false);
    if (!createdRequest) {
      setReviewProgress(0);
      setPhase("form");
      return;
    }

    setDecisionRequest(createdRequest);
    setReviewProgress((current) => Math.max(current, 35));
    const reviewedRequest = await waitForDecision(createdRequest);
    if (!mountedRef.current) return;

    setDecisionRequest(reviewedRequest);
    setReviewProgress(100);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    if (!mountedRef.current) return;
    if (reviewedRequest.status === "approved") {
      setPhase("approved");
    } else if (reviewedRequest.status === "rejected") {
      setPhase("rejected");
    } else {
      setPhase("manual");
      manualCloseTimerRef.current = window.setTimeout(onClose, 3_500);
    }
  }

  if (phase !== "form") {
    const rejectionReason =
      decisionRequest?.ai_rejection_reason ||
      decisionRequest?.review_reason ||
      "لم يستوفِ المرفق شروط طلب الرصيد الإضافي.";
    const roundedProgress = Math.min(100, Math.round(reviewProgress));
    const progressLabel =
      roundedProgress < 30
        ? "جاري رفع المرفق..."
        : roundedProgress < 80
          ? "جاري تحليل الصورة والتحقق من الشروط بواسطة الذكاء الاصطناعي... 🤖"
          : "جاري إصدار القرار وتحديث الحساب...";

    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm" dir="rtl">
        <div className="w-full max-w-md rounded-3xl border border-[#E8DCFF] bg-white p-6 text-center shadow-premium-lg md:p-8" role="dialog" aria-modal="true" aria-live="polite">
          {phase === "checking" ? (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F5EEFF] text-[#8B35F5] shadow-[0_12px_30px_rgba(139,53,245,0.16)]">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-2xl font-black text-zinc-950">جاري فحص الطلب</h2>
              <div className="mt-6 overflow-hidden rounded-full bg-[#EEE5FC] p-1 shadow-inner">
                <div
                  className="h-4 rounded-full bg-gradient-to-l from-[#8B35F5] to-[#B469FF] transition-[width] duration-500 ease-out"
                  style={{ width: `${roundedProgress}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm font-black">
                <span className="text-zinc-700">{progressLabel}</span>
                <span className="shrink-0 text-[#7C2CE8]" dir="ltr">{roundedProgress}%</span>
              </div>
              <p className="mt-4 text-xs font-bold leading-6 text-zinc-500">
                ستبقى النافذة مفتوحة حتى وصول قرار القبول أو الرفض النهائي.
              </p>
            </>
          ) : phase === "approved" ? (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-[0_12px_30px_rgba(5,150,105,0.16)]">
                <CircleCheck className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-2xl font-black text-zinc-950">تم قبول طلبك بنجاح!</h2>
              <p className="mt-4 text-sm font-black leading-8 text-emerald-700">
                تم قبول طلبك بنجاح! ✅ تم إضافة المحاولة لحسابك.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 h-13 w-full rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(5,150,105,0.22)] transition hover:bg-emerald-700"
              >
                متابعة
              </button>
            </>
          ) : phase === "rejected" ? (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 shadow-[0_12px_30px_rgba(225,29,72,0.14)]">
                <CircleX className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-2xl font-black text-zinc-950">تم رفض الطلب</h2>
              <div className="mt-4 rounded-2xl border border-rose-200 bg-gradient-to-b from-rose-50 to-white px-5 py-4 text-right shadow-[0_10px_24px_rgba(225,29,72,0.08)]">
                <p className="text-xs font-black text-rose-600">سبب عدم قبول المرفق:</p>
                <p className="mt-2 text-sm font-bold leading-8 text-zinc-800">{rejectionReason}</p>
              </div>
              <div className="mt-5 flex w-full flex-col gap-3">
                <button
                  type="button"
                  onClick={resetForAnotherRequest}
                  className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#8B35F5] px-5 py-4 text-base font-bold text-white shadow-[0_12px_28px_rgba(139,53,245,0.24)] transition hover:-translate-y-0.5 hover:bg-[#7626DD]"
                >
                  تقديم طلب رصيد جديد
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-base font-bold text-zinc-600 transition hover:bg-zinc-50"
                >
                  إغلاق
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shadow-[0_12px_30px_rgba(217,119,6,0.14)]">
                <Clock3 className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-2xl font-black text-zinc-950">الطلب قيد المراجعة</h2>
              <p className="mt-4 text-sm font-bold leading-8 text-zinc-700">
                تم استلام طلبك وجاري مراجعته يدوياً من قبل الفريق (خلال دقائق).
              </p>
              <p className="mt-2 text-xs font-bold text-zinc-500">ستُغلق النافذة تلقائياً.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-zinc-950/60 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
      dir="rtl"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[#E8DCFF] bg-white shadow-premium-lg sm:max-h-[90dvh]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100 p-5 pb-4 sm:p-7 sm:pb-5">
          <div>
            <p className="text-xs font-black text-[#8B35F5]">مراجعة من إدارة المتجر</p>
            <h2 className="mt-1 text-2xl font-black">طلب رصيد إضافي</h2>
            <p className="mt-2 text-xs font-bold leading-6 text-zinc-500">وضح المشكلة وأرفق الإثبات المطلوب لتسريع مراجعة طلبك.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-1 sm:px-6">
        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-black">سبب المشكلة</span>
          <select
            value={reasonType}
            onChange={(event) => {
              setReasonType(event.target.value as ExtraCreditReason);
              setScreenshot(null);
              setError("");
            }}
            className="h-13 w-full rounded-xl border-2 border-[#E0D4F8] bg-[#FCFAFF] px-4 text-sm font-black outline-none transition focus:border-[#8B35F5]"
          >
            {extraCreditReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="mb-2 flex items-center justify-between text-sm font-black">
            <span>وصف المشكلة</span>
            <span className={description.trim().length >= 10 ? "text-emerald-600" : "text-zinc-400"}>{description.trim().length}/10</span>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={800}
            placeholder="اكتب ما حدث معك بالتفصيل..."
            className="w-full resize-none rounded-xl border-2 border-[#E0D4F8] bg-[#FCFAFF] p-4 text-sm font-bold leading-7 outline-none transition placeholder:text-zinc-400 focus:border-[#8B35F5]"
          />
        </label>

        <p className="mt-4 rounded-xl bg-[#F5EEFF] px-4 py-3 text-xs font-black leading-6 text-[#6E25CF]">
          {requiresVideo
            ? "📌 تنبيه هام: للموافقة على الدخول من جهاز جديد، يجب تسجيل الخروج من الجهاز الأول أولاً. يرجى إرفاق فيديو أو تسجيل شاشة يوضح عملية تسجيل الخروج من حسابنا بالكامل، مع الاشتراط الأساسي بظهور البريد الإلكتروني الخاص بالحساب واضحاً أثناء الفيديو."
            : "يرجى إرفاق صورة إثبات للمشكلة."}
        </p>

        <label className="mt-3 block cursor-pointer rounded-2xl border-2 border-dashed border-[#D8C1FF] bg-[#FAF8FF] p-4 text-center transition hover:border-[#8B35F5]">
          <input
            type="file"
            accept={requiresVideo ? "video/*" : "image/*"}
            className="sr-only"
            onChange={(event) => {
              setScreenshot(event.target.files?.[0] || null);
              setError("");
            }}
          />
          {previewUrl ? (
            requiresVideo ? (
              <video src={previewUrl} controls playsInline className="mx-auto max-h-64 w-full rounded-xl bg-black object-contain" />
            ) : (
              <img src={previewUrl} alt="معاينة الإثبات" className="mx-auto max-h-52 w-full rounded-xl object-contain" />
            )
          ) : (
            <div className="py-5">
              <Plus className="mx-auto h-7 w-7 text-[#8B35F5]" />
              <p className="mt-2 text-sm font-black text-[#7C2CE8]">{requiresVideo ? "إرفاق فيديو تسجيل الخروج" : "إرفاق صورة للمشكلة"}</p>
              <p className="mt-1 text-xs font-bold text-zinc-500">
                {requiresVideo ? "مقطع فيديو ضمن السعة المتاحة في التخزين" : "صورة ضمن السعة المتاحة في التخزين"}
              </p>
            </div>
          )}
        </label>

        <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-[0_10px_28px_rgba(146,92,10,0.08)]">
          <p className="text-sm font-black leading-7 text-[#7A3510]">
            ⚠️ تنبيه وإبراء للذمة: هذا الاشتراك مخصص لاستخدام جهاز واحد فقط، ويُمنع منعاً باتاً تشغيل الحساب أو الدخول به على أكثر من جهاز في نفس الوقت. نحن لا نحلل ولا نبيح أي استخدام يخالف هذا الشرط.
          </p>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-white p-3 transition hover:border-amber-400">
            <input
              type="checkbox"
              required
              checked={pledgeAccepted}
              onChange={(event) => {
                setPledgeAccepted(event.target.checked);
                if (event.target.checked) setError("");
              }}
              className="mt-1 h-5 w-5 shrink-0 accent-[#8B35F5]"
            />
            <span className="text-sm font-black leading-7 text-zinc-900">
              أقر وأتعهد أمام الله تعالى بأنني سأستخدم الحساب على جهاز واحد فقط، ولن أقوم بإدخاله أو تشغيله على أكثر من جهاز في وقت واحد.
            </span>
          </label>

          {!pledgeAccepted && (
            <p className="mt-2 text-xs font-black text-amber-800">يجب تحديد مربع التعهد لتفعيل زر الإرسال.</p>
          )}
        </section>

        {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700">{error}</p>}
        </div>

        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-zinc-100 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-12px_30px_rgba(24,24,27,0.06)] sm:px-6 sm:pb-5">
          <div
            className="rounded-xl"
            onClick={() => {
              if (!pledgeAccepted && !submitting) {
                setError("يجب الموافقة على الإقرار والتعهد أولاً لإتمام إرسال الطلب.");
              }
            }}
          >
            <button
              type="submit"
              disabled={submitting || !pledgeAccepted}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_12px_28px_rgba(139,53,245,0.25)] transition hover:bg-[#7626DD] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {submitting && <RefreshCw className="h-4 w-4 animate-spin" />}
              {submitting ? "جاري الإرسال..." : "تأكيد الإرسال"}
            </button>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="h-13 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-black text-zinc-600 transition hover:bg-zinc-50">
            إلغاء
          </button>
        </div>
      </form>

    </div>
  );
}

function CompensationCodeCard({
  code,
  compact = false,
  showPageLink = false,
}: {
  code: string;
  compact?: boolean;
  showPageLink?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await copyTextSilent(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Compensation code copy failed:", error);
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-[#D8C1FF] bg-gradient-to-l from-[#FBF8FF] to-white shadow-[0_10px_28px_rgba(124,44,232,0.10)]",
        compact ? "p-3" : "p-4 md:p-5",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black text-zinc-500">رمز التعويض الخاص بك</p>
          <p
            className={cn(
              "mt-1 font-black tracking-[0.16em] text-[#7C2CE8]",
              compact ? "text-xl md:text-2xl" : "text-2xl md:text-3xl",
            )}
            dir="ltr"
          >
            {code}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyCode()}
          className={cn(
            "flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 font-black transition duration-300",
            copied
              ? "bg-emerald-100 text-emerald-700"
              : "bg-[#8B35F5] text-white shadow-[0_10px_24px_rgba(139,53,245,0.24)] hover:bg-[#7626DD]",
            compact ? "h-11 text-xs" : "h-12 text-sm",
          )}
          aria-label="نسخ رمز التعويض"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "تم النسخ" : "نسخ الرمز"}
        </button>
      </div>
      {showPageLink && (
        <a href="/compensation" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-[#7C2CE8] hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />
          فتح صفحة طلب ومتابعة التعويض
        </a>
      )}
    </div>
  );
}

function LoginCopyCard({
  label,
  value,
  icon: Icon,
  setToast,
  theme,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  setToast: (toast: Toast) => void;
  theme: ServiceTheme;
}) {
  return (
    <article className="rounded-[1.75rem] bg-white">
      <div className="mb-3 flex items-center justify-center gap-2 text-lg font-black">
        <Icon className={cn("h-5 w-5", theme.accent)} />
        <span className={cn("bg-gradient-to-l bg-clip-text text-transparent", theme.gradient)}>{label}</span>
      </div>
      <div className="flex items-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100/80 shadow-inner transition duration-300 hover:border-netflix/50 hover:bg-zinc-200/70">
        <p className={cn("min-w-0 flex-1 truncate px-4 py-4 text-center text-base font-black md:text-lg", theme.accent)} dir="ltr">
          {value}
        </p>
        <button
          onClick={() => copyText(value, setToast)}
          className={cn("group flex h-[58px] shrink-0 items-center gap-2 border-r border-zinc-300 bg-zinc-200/80 px-4 transition duration-300 hover:text-white", theme.accent, theme.hoverBg)}
          aria-label={`نسخ ${label}`}
        >
          <Copy className="h-5 w-5 transition duration-300 group-hover:scale-110" />
          <span className="text-sm font-black">نسخ</span>
        </button>
      </div>
    </article>
  );
}

function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M16.02 3.2C9.02 3.2 3.32 8.87 3.32 15.84c0 2.23.59 4.4 1.7 6.31L3.2 28.8l6.83-1.79a12.7 12.7 0 0 0 5.99 1.52h.01c7 0 12.69-5.67 12.69-12.64S23.03 3.2 16.02 3.2Zm0 23.2h-.01c-1.9 0-3.77-.51-5.39-1.48l-.39-.23-4.05 1.06 1.08-3.94-.26-.4a10.47 10.47 0 0 1-1.61-5.57c0-5.82 4.77-10.56 10.63-10.56 2.84 0 5.51 1.1 7.51 3.09a10.48 10.48 0 0 1 3.12 7.47c0 5.82-4.77 10.56-10.63 10.56Zm5.83-7.9c-.32-.16-1.9-.93-2.19-1.04-.29-.1-.5-.16-.71.16-.21.31-.82 1.03-1 1.24-.18.2-.37.23-.69.08-.32-.16-1.35-.49-2.57-1.57a9.6 9.6 0 0 1-1.78-2.2c-.19-.31-.02-.48.14-.64.15-.14.32-.37.48-.55.16-.18.21-.31.32-.52.1-.2.05-.39-.03-.55-.08-.16-.71-1.7-.97-2.33-.26-.61-.52-.53-.71-.54h-.61c-.21 0-.55.08-.84.39-.29.31-1.11 1.08-1.11 2.64s1.14 3.07 1.3 3.28c.16.2 2.25 3.41 5.45 4.78.76.33 1.35.52 1.81.67.76.24 1.46.2 2.01.12.61-.09 1.9-.77 2.17-1.52.27-.75.27-1.39.19-1.52-.08-.14-.29-.22-.61-.38Z" />
    </svg>
  );
}

function TvRequestConfirmationModal({
  checked,
  onToggle,
  onCancel,
  onContinue,
}: {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-[#E50914]">
            <MonitorPlay className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-black md:text-3xl">تأكيد طلب رابط الشاشة</h2>
          <p className="mt-4 text-sm font-bold leading-7 text-zinc-700">
            هل قمت بفتح تطبيق نتفليكس على الشاشة/السوني وتوقفت عند شاشة طلب الرابط؟
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-4 text-right">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-1 h-5 w-5 rounded border-red-200 text-[#E50914] focus:ring-[#E50914]"
          />
          <span className="text-sm font-black leading-7 text-zinc-800 md:text-base">
            نعم، أنا جاهز حالياً على شاشة التلفزيون
          </span>
        </label>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={!checked}
            className="h-13 rounded-2xl bg-[#E50914] px-5 text-sm font-black text-white shadow-[0_14px_32px_rgba(229,9,20,0.24)] transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            متابعة وطلب الرابط
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-13 rounded-2xl border border-zinc-200 bg-zinc-100 px-5 text-sm font-black text-zinc-700 transition hover:bg-zinc-200"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceChoiceModal({
  deviceLabel,
  checked,
  onToggle,
  onCancel,
  onContinue,
}: {
  deviceLabel: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0E7FF] text-[#8B35F5]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="text-3xl font-black md:text-4xl">تأكيد نوع الجهاز</h2>
          <p className="mt-4 text-sm font-bold leading-7 text-zinc-700">
            هل تريد الانتقال إلى جهاز ({deviceLabel})؟ يمكنك التبديل مرة أخرى ما دمت لم تستخدم الرمز أو رابط الدخول.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#E4D6FA] bg-[#F8F4FF] px-4 py-4 text-right">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-1 h-5 w-5 rounded border-[#CDBAF2] text-[#8B35F5] focus:ring-[#8B35F5]"
          />
          <span className="text-sm font-black leading-7 text-zinc-800 md:text-base">
            أؤكد الانتقال إلى هذا النوع من الأجهزة، وأعلم أن التبديل سيُقفل بعد استهلاك المحاولة.
          </span>
        </label>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={!checked}
            className="h-13 rounded-2xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-40"
          >
            متابعة
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-13 rounded-2xl border border-[#E0D4F8] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
          >
            تغيير الاختيار / إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function PreRequestModal({
  checked,
  onToggle,
  onContinue,
  onCancel,
}: {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0E7FF] text-[#8B35F5]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="text-3xl font-black md:text-4xl">تأكيد محاولة تسجيل الدخول</h2>
          <p className="mt-4 text-sm font-bold leading-8 text-zinc-700">
            هل قمت بإدخال البريد الإلكتروني والضغط على تسجيل الدخول في تطبيق Netflix أولاً؟ لن يتم احتساب المحاولة إلا بعد وصول الكود وظهوره لك.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#E4D6FA] bg-[#F8F4FF] px-4 py-4 text-right">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-1 h-5 w-5 rounded border-[#CDBAF2] text-[#8B35F5] focus:ring-[#8B35F5]"
          />
          <span className="text-sm font-black leading-7 text-zinc-800 md:text-base">
            أقر بأنني بدأت تسجيل الدخول، ويمكنني إعادة البحث إذا لم يصل الكود.
          </span>
        </label>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={!checked}
            className="h-13 rounded-2xl bg-[#8B35F5] px-5 text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD] disabled:cursor-not-allowed disabled:opacity-40"
          >
            نعم، بدأت تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-13 rounded-2xl border border-[#E0D4F8] bg-white px-5 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
          >
            تراجع
          </button>
        </div>
      </div>
    </div>
  );
}

function DisclaimerModal({
  checked,
  onToggle,
  onContinue,
}: {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-netflix">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="text-3xl font-black md:text-4xl">إخلاء مسؤولية وتبرئة ذمة</h2>
        </div>
        <p className="text-sm font-medium leading-8 text-zinc-900 md:text-base">
          نخلي مسؤوليتنا ونبرئ ذمتنا أمام الله من أي محتوى يتم مشاهدته من خلال الخدمات المقدمة عبر المتجر، حيث إن
          المحتوى المعروض من أفلام أو مسلسلات أو موسيقى يكون من اختيار واستخدام العميل وتحت مسؤوليته الشخصية.
        </p>
        <label className="mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-right">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
            className="h-5 w-5 rounded border-zinc-300 text-netflix focus:ring-netflix"
          />
          <span className="text-sm font-black md:text-base">أنا أعلم ذلك، وأنا مسؤول عمّا سأشاهده أمام الله</span>
        </label>
        <button
          type="button"
          disabled={!checked}
          onClick={onContinue}
          className="mt-5 flex h-13 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-netflix to-red-700 text-sm font-black text-white shadow-red transition duration-300 hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
        >
          متابعة
        </button>
      </div>
    </div>
  );
}

function ReminderModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-rise rounded-[2rem] border border-white bg-white p-6 text-center shadow-premium-lg md:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <Sparkles className="h-7 w-7" />
        </div>
        <h3 className="text-2xl font-black md:text-3xl">تنبيه مهم</h3>
        <p className="mt-4 text-base font-bold leading-8 text-zinc-700">
          يرجى متابعة فيديو الشرح كامل حتى لا تواجهك مشاكل.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-950 text-sm font-black text-white transition duration-300 hover:-translate-y-1"
        >
          حسناً
        </button>
      </div>
    </div>
  );
}

function ProfileMiniCard({
  label,
  value,
  icon: Icon,
  setToast,
  theme,
  ltr,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  setToast: (toast: Toast) => void;
  theme: ServiceTheme;
  ltr?: boolean;
}) {
  return (
    <article className="rounded-3xl border border-zinc-200 bg-zinc-100/80 p-4 shadow-inner transition duration-300 hover:-translate-y-1 hover:border-netflix/50 hover:bg-zinc-200/70">
      <div className={cn("mb-3 flex items-center justify-center gap-2 text-sm font-black", theme.accent)}>
        <Icon className="h-5 w-5" />
        {label}
      </div>
      <p className={cn("mb-3 truncate text-center text-xl font-black", theme.accent)} dir={ltr ? "ltr" : "rtl"}>
        {value}
      </p>
      <button
        onClick={() => copyText(value, setToast)}
        className={cn("group flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-300 bg-zinc-200/80 text-sm font-black transition duration-300 hover:text-white", theme.accent, theme.hoverBg)}
      >
        <Copy className="h-4 w-4 transition duration-300 group-hover:scale-110" />
        نسخ
      </button>
    </article>
  );
}

function StepCard({
  step,
  icon: Icon,
  title,
  text,
  theme,
}: {
  step: string;
  icon: LucideIcon;
  title: string;
  text: string;
  theme: ServiceTheme;
}) {
  const stepNumber = step.replace("Step ", "");

  return (
    <article className="flex items-center gap-4 rounded-3xl border border-red-100 bg-gradient-to-l from-white to-[#F9FAFB] p-4 text-right shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-premium">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-black text-white", theme.gradient, theme.glow)}>
        {stepNumber}
      </div>
      <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl", theme.soft)}>
          <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <span className={cn("text-xs font-black", theme.accent)}>{step}</span>
        <h3 className="mt-1 text-lg font-black">{title}</h3>
        <p className="mt-1 text-sm font-bold leading-7 text-zinc-500">{text}</p>
      </div>
    </article>
  );
}
