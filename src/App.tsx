import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clipboard,
  Copy,
  Edit3,
  Eye,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  KeyRound,
  LockKeyhole,
  Mail,
  MessageCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserRound,
  Users,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LEGACY_PROFILE_CODES, PROFILE_CODES, accountTypeLabel, buildProfileSlots } from "./lib/profiles";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { AccountType, CustomerLink, NetflixAccount, ServiceType } from "./types";

type Screen = "selector" | "netflix" | "account";
type DeviceView = "mobile" | "screen";
type Toast = { label: string; at: number; tone?: "success" | "error" } | null;
type StatTone = "neutral" | "green" | "red";
type AccountTypeFilter = "all" | AccountType;
type CustomerSearchResult = { link: CustomerLink; account: NetflixAccount };
type AccountFormResult = boolean | { ok: boolean; error?: string };
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

const defaultCustomerVideoUrl = "https://www.youtube.com/embed/-Ho_WqBCar0?playsinline=1&rel=0&modestbranding=1";
const videoUrl = import.meta.env.VITE_CUSTOMER_VIDEO_URL || defaultCustomerVideoUrl;
const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";
const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || "admin@zonestore.sa";
const adminAuthKey = "zone-admin-auth";
const adminAuthValue = `remembered:${adminPassword}`;
const whatsappNumber = "966581688656";
const disclaimerStorageKey = "disclaimer_accepted";
const dayMs = 1000 * 60 * 60 * 24;
const duplicateEmailMessage = "عفواً، هذا البريد الإلكتروني مسجل مسبقاً ولا يمكن تكراره";
const duplicateEmailSaveMessage = duplicateEmailMessage;
const duplicateProfileMessage = (profileName: string) => `هذا الملف (${profileName}) مسجل مسبقاً لهذا الحساب`;
const emptyEmailMessage = "أدخل البريد الإلكتروني أولاً";

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
};

function serviceOf(account?: NetflixAccount | null): ServiceType {
  return account?.service_type === "shahid" ? "shahid" : "netflix";
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

function isDuplicateEmailError(error: unknown) {
  const supabaseError = error as { code?: string; message?: string; details?: string } | null;
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""}`.toLowerCase();
  return (
    supabaseError?.code === "23505" ||
    message.includes("unique constraint") ||
    message.includes("duplicate key")
  );
}

function isCustomerLinksEmailConstraintError(error: unknown) {
  const supabaseError = error as { message?: string; details?: string } | null;
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""}`.toLowerCase();
  return message.includes("unique_customer_email") || message.includes("customer_links_email");
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

function getProfilePin(link: CustomerLink) {
  const storedPin = `${link.profile_code ?? ""}`.trim();
  if (NEW_PROFILE_PINS.has(storedPin)) return storedPin;

  const profileKey = `${link.profile_label || link.profile_name || ""}`.toUpperCase().match(/[A-E]/)?.[0];
  return profileKey ? LEGACY_PROFILE_CODES[profileKey] : "";
}

async function copyText(text: string, setToast: (toast: Toast) => void) {
  await navigator.clipboard.writeText(text);
  setToast({ label: "تم النسخ بنجاح", at: Date.now() });
}

async function copyTextSilent(text: string) {
  await navigator.clipboard.writeText(text);
}

type VerificationCodeResult = {
  code: string | null;
  receivedAt: string | null;
  error: unknown;
};

const NEW_PROFILE_PINS = new Set(Object.values(PROFILE_CODES));

async function readLatestVerificationCode(accountId: string): Promise<VerificationCodeResult> {
  if (!supabase) {
    return { code: null, receivedAt: null, error: null };
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("verification_code,verification_code_received_at")
    .eq("id", accountId)
    .maybeSingle();

  if (!error && data?.verification_code) {
    return {
      code: data.verification_code,
      receivedAt: data.verification_code_received_at || null,
      error: null,
    };
  }

  if (error) console.error("Supabase verification code read error:", error);

  const fallback = await supabase
    .from("customer_links")
    .select("verification_code,verification_code_received_at")
    .eq("account_id", accountId)
    .not("verification_code", "is", null)
    .order("verification_code_received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallback.error && fallback.data?.verification_code) {
    return {
      code: fallback.data.verification_code,
      receivedAt: fallback.data.verification_code_received_at || null,
      error: null,
    };
  }

  if (fallback.error) console.error("Supabase customer link code fallback error:", fallback.error);
  return {
    code: null,
    receivedAt: null,
    error: error || fallback.error || null,
  };
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
  if (shortMatch) return <CustomerView identifier={shortMatch[1]} lookup="short" navigate={navigate} />;
  if (viewMatch) return <CustomerView identifier={viewMatch[1]} lookup="uuid" navigate={navigate} />;
  return <AdminApp navigate={navigate} />;
}

function AdminApp({ navigate }: { navigate: (path: string) => void }) {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem(adminAuthKey) === adminAuthValue);
  const [screen, setScreen] = useState<Screen>(() => (localStorage.getItem("zone-admin-screen") as Screen) || "selector");
  const [selectedService, setSelectedService] = useState<ServiceType>(() =>
    localStorage.getItem("zone-selected-service") === "shahid" ? "shahid" : "netflix",
  );
  const [accounts, setAccounts] = useState<NetflixAccount[]>([]);
  const [links, setLinks] = useState<CustomerLink[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!authenticated) return;
    void loadData();
  }, [authenticated]);

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
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [authenticated]);

  async function loadData() {
    if (!supabase) {
      setAccounts([demoAccount]);
      setLinks(demoLinks);
      return;
    }

    setLoading(true);
    const [{ data: accountsData, error: accountsError }, { data: linksData, error: linksError }] =
      await Promise.all([
        supabase.from("accounts").select("*").order("created_at", { ascending: false }),
        supabase.from("customer_links").select("*").order("profile_name", { ascending: true }),
      ]);

    if (accountsError || linksError) {
      setToast({ label: "تعذر تحميل بيانات Supabase", at: Date.now() });
    } else {
      setAccounts((accountsData || []) as NetflixAccount[]);
      setLinks((linksData || []) as CustomerLink[]);
    }
    setLoading(false);
  }

  async function emailAlreadyExists(email: string, exceptAccountId?: string) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    if (
      accounts.some((account) => account.id !== exceptAccountId && normalizeEmail(account.email) === normalized) ||
      links.some((link) => link.account_id !== exceptAccountId && normalizeEmail(link.email || "") === normalized)
    ) {
      return true;
    }

    if (!supabase) return false;

    const { data, error } = await supabase
      .from("customer_links")
      .select("id,account_id")
      .eq("email", normalized);

    if (error) {
      console.error("Supabase duplicate email validation error:", error);
      throw new Error("duplicate_email_lookup_failed");
    }

    const existing = (data || []).filter((link) => link.account_id !== exceptAccountId);
    return existing.length > 0;
  }

  async function duplicateProfileForEmail(email: string, profileNames: string[], exceptAccountId?: string) {
    const normalized = normalizeEmail(email);
    const uniqueProfiles = Array.from(new Set(profileNames.filter(Boolean)));
    if (!normalized || !uniqueProfiles.length) return null;

    const localDuplicate = links.find(
      (link) =>
        link.account_id !== exceptAccountId &&
        normalizeEmail(link.email || "") === normalized &&
        uniqueProfiles.includes(link.profile_name),
    );
    if (localDuplicate) return localDuplicate.profile_name;

    if (!supabase) return null;

    const { data, error } = await supabase
      .from("customer_links")
      .select("id,account_id,profile_name")
      .eq("email", normalized)
      .in("profile_name", uniqueProfiles);

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
  ): Promise<AccountFormResult> {
    if (accountType === "private") {
      if (await emailAlreadyExists(email, exceptAccountId)) {
        return { ok: false, error: duplicateEmailMessage };
      }
      return true;
    }

    const duplicateProfile = await duplicateProfileForEmail(email, profileNames, exceptAccountId);
    if (duplicateProfile) {
      return { ok: false, error: duplicateProfileMessage(duplicateProfile) };
    }
    return true;
  }

  async function addAccount(form: { email: string; password: string; account_type: AccountType; supplier_code_url?: string }): Promise<AccountFormResult> {
    const expires_at = defaultExpiryDate();
    const slots = buildProfileSlots(form.account_type, selectedService);
    const normalizedEmail = normalizeEmail(form.email);

    if (!normalizedEmail) {
      setToast({ label: emptyEmailMessage, at: Date.now(), tone: "error" });
      return { ok: false, error: emptyEmailMessage };
    }

    try {
      const validation = await validateAccountEmailAndProfiles(
        normalizedEmail,
        form.account_type,
        slots.map((slot) => slot.profile_name),
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
      const account: NetflixAccount = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        expires_at,
        service_type: selectedService,
        use_automated_code: true,
        ...form,
        email: normalizedEmail,
      };
      const createdLinks = slots.map((slot) => ({
        id: crypto.randomUUID(),
        account_id: account.id,
        email: account.email,
        created_at: new Date().toISOString(),
        ...slot,
      }));
      setAccounts((current) => [account, ...current]);
      setLinks((current) => [...current, ...createdLinks]);
      setSelectedAccountId(account.id);
      setScreen("account");
      setToast({ label: "تم إنشاء الحساب محلياً للمعاينة", at: Date.now() });
      return true;
    }

    setLoading(true);
    let account: NetflixAccount | null = null;
    try {
      const { data, error: accountError } = await supabase
        .from("accounts")
        .insert({ ...form, email: normalizedEmail, expires_at, service_type: selectedService, use_automated_code: true })
        .select()
        .single();

      if (accountError) throw accountError;
      account = data as NetflixAccount;
    } catch (error) {
      setLoading(false);
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
      setToast({ label: "تعذر إنشاء الحساب", at: Date.now(), tone: "error" });
      return false;
    }

    let linksError: unknown = null;
    try {
      const { error } = await supabase.from("customer_links").insert(
        slots.map((slot) => ({
          account_id: account.id,
          email: normalizedEmail,
          ...slot,
        })),
      );
      if (error) throw error;
    } catch (error) {
      linksError = error;
    }

    if (linksError) {
      if (isCustomerLinksEmailConstraintError(linksError)) {
        await supabase.from("accounts").delete().eq("id", account.id);
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

      if (isDuplicateEmailError(linksError)) {
        await supabase.from("accounts").delete().eq("id", account.id);
        setLoading(false);
        setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: duplicateEmailSaveMessage };
      }

      console.error("Supabase customer links insert error:", linksError);
      setToast({ label: "تم إنشاء الحساب وتعذر إنشاء الروابط", at: Date.now(), tone: "error" });
    } else {
      setToast({ label: "تم إنشاء الحساب والروابط", at: Date.now() });
    }
    await loadData();
    setSelectedAccountId(account.id);
    setScreen("account");
    setLoading(false);
    return !linksError;
  }

  async function updateAccount(
    accountId: string,
    form: { email: string; password: string; supplier_code_url?: string; created_at?: string; expires_at?: string },
  ): Promise<AccountFormResult> {
    const normalizedEmail = normalizeEmail(form.email);
    const currentAccount = accounts.find((account) => account.id === accountId);
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
                supplier_code_url: form.supplier_code_url || null,
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
    const { error } = await supabase
      .from("accounts")
      .update({
        email: normalizedEmail,
        password: form.password,
        supplier_code_url: form.supplier_code_url || null,
        ...(form.created_at ? { created_at: form.created_at } : {}),
        ...(form.expires_at ? { expires_at: form.expires_at } : {}),
      })
      .eq("id", accountId);

    if (error) {
      setLoading(false);
      if (isDuplicateEmailError(error)) {
        setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: duplicateEmailSaveMessage };
      }
      setToast({ label: "تعذر حفظ تعديلات الحساب", at: Date.now(), tone: "error" });
      return false;
    }

    const { error: linksUpdateError } = await supabase.from("customer_links").update({ email: normalizedEmail }).eq("account_id", accountId);
    setLoading(false);

    if (linksUpdateError) {
      if (isDuplicateEmailError(linksUpdateError)) {
        setToast({ label: duplicateEmailSaveMessage, at: Date.now(), tone: "error" });
        return { ok: false, error: duplicateEmailSaveMessage };
      }

      console.error("Supabase customer link email update error:", linksUpdateError);
      setToast({ label: "تم حفظ الحساب وتعذر تحديث روابط العملاء", at: Date.now(), tone: "error" });
      return false;
    }

    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? {
              ...account,
              ...form,
              email: normalizedEmail,
              supplier_code_url: form.supplier_code_url || null,
              created_at: form.created_at || account.created_at,
              expires_at: form.expires_at || account.expires_at,
            }
          : account,
      ),
    );
    setLinks((current) =>
      current.map((link) => (link.account_id === accountId ? { ...link, email: normalizedEmail } : link)),
    );
    setToast({ label: "تم حفظ تعديلات الحساب", at: Date.now() });
    return true;
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
            link.link_number != null &&
            String(link.link_number).includes(normalizedCustomerNumber),
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
          setSelectedService("netflix");
          setScreen("netflix");
        }}
        onShahid={() => {
          setSelectedService("shahid");
          setScreen("netflix");
        }}
      />
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
        onQuery={setQuery}
        onAdd={addAccount}
        onUpdate={updateAccount}
        onSelect={(id) => {
          setSelectedAccountId(id);
          setScreen("account");
        }}
        onDelete={deleteAccount}
        onUpdateCustomerCodeBalance={updateCustomerCodeBalance}
        onResetCustomerDevice={resetCustomerDevice}
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
  onLogout,
}: {
  onNetflix: () => void;
  onShahid: () => void;
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

        <div className="grid gap-5 md:grid-cols-2">
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
  onQuery,
  onAdd,
  onUpdate,
  onSelect,
  onDelete,
  onUpdateCustomerCodeBalance,
  onResetCustomerDevice,
  onBackToServices,
  onLogout,
}: {
  accounts: NetflixAccount[];
  stats: Array<{ label: string; value: number; icon: LucideIcon; tone: StatTone }>;
  service: ServiceType;
  query: string;
  customerSearchResult: CustomerSearchResult | null;
  loading: boolean;
  onQuery: (query: string) => void;
  onAdd: Parameters<typeof AccountForm>[0]["onAdd"];
  onUpdate: Parameters<typeof AccountForm>[0]["onUpdate"];
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onUpdateCustomerCodeBalance: (
    linkId: string,
    codeRequestLimit: number,
    resetRequestedCount: boolean,
  ) => Promise<boolean>;
  onResetCustomerDevice: (linkId: string) => Promise<boolean>;
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
    accountTypeFilter === "private" ? "خاص" : accountTypeFilter === "shared" ? "مشترك" : "فلترة";

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
                placeholder="ابحث بالبريد الإلكتروني أو رقم العميل مثل 100..."
                className="h-13 w-full rounded-xl border-2 border-[#D8C1FF] bg-white px-4 pr-12 text-sm font-bold outline-none transition duration-300 placeholder:text-zinc-400 focus:border-[#8B35F5] focus:shadow-[0_0_0_4px_rgba(139,53,245,0.10)]"
              />
            </div>

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
                  ].map((option) => (
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
              <p className="mt-1 text-xs font-semibold text-zinc-500">عرض {visibleAccounts.length} من {accounts.length} عميل</p>
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
  onOpenSupplierCode,
}: {
  account: NetflixAccount;
  index: number;
  onSelect: (id: string) => void;
  onEdit: (account: NetflixAccount) => void;
  onDelete: (id: string) => Promise<void>;
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

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onSelect(account.id)}
          title="فتح تفاصيل الحساب"
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8B35F5] text-xs font-black text-white transition hover:bg-[#7626DD]"
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
  onOpenSupplierCode,
}: {
  account: NetflixAccount;
  index: number;
  onSelect: (id: string) => void;
  onEdit: (account: NetflixAccount) => void;
  onDelete: (id: string) => Promise<void>;
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
          <span className={cn("text-[11px] font-black", service === "shahid" ? "text-cyan-600" : "text-[#8B35F5]")}>
            {service === "shahid" ? "شاهد" : "Netflix"}
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
  onAdd: (form: { email: string; password: string; account_type: AccountType; supplier_code_url?: string }) => Promise<AccountFormResult>;
  onUpdate: (
    accountId: string,
    form: { email: string; password: string; supplier_code_url?: string },
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
  const [formError, setFormError] = useState("");
  const calculatedExpiry = defaultExpiryDate();
  const theme = serviceThemes[service];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const supplier_code_url = supplierCodeUrl.trim() || undefined;
    const result = initialAccount
      ? await onUpdate(initialAccount.id, { email: normalizeEmail(email), password, supplier_code_url })
      : await onAdd({ email: normalizeEmail(email), password, account_type: accountType, supplier_code_url });

    if (accountFormSucceeded(result)) {
      onClose();
    } else {
      setFormError(accountFormError(result) || "تعذر حفظ الحساب، حاول مرة أخرى");
    }
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
          <div className="grid rounded-2xl border-2 border-[#E0D0FB] bg-[#F8F4FF] p-1.5 sm:grid-cols-2">
            {(["private", "shared"] as AccountType[]).map((type) => (
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

        {formError && (
          <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">
            {formError}
          </p>
        )}

        <Field icon={Link2} label="رابط جلب الأكواد">
          <input
            value={supplierCodeUrl}
            onChange={(event) => setSupplierCodeUrl(event.target.value)}
            placeholder="https://example.com"
            className="admin-modal-input"
            dir="ltr"
          />
          <p className="mt-2 text-[11px] font-bold text-zinc-400">خاص بالمسؤول فقط ولا يظهر في صفحة العميل.</p>
        </Field>

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
            {service === "shahid"
              ? accountType === "private"
                ? "سيتم إنشاء 4 روابط تلقائياً بدون رمز ملف."
                : "سيتم إنشاء 8 روابط تلقائياً بدون رمز ملف."
              : accountType === "private"
                ? "سيتم إنشاء 5 روابط تلقائياً."
                : "سيتم إنشاء 10 روابط تلقائياً."}
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
  onUpdateDates: (accountId: string, form: { created_at: string; expires_at: string }) => Promise<boolean>;
  onUpdate: Parameters<typeof AccountForm>[0]["onUpdate"];
  onLogout: () => void;
}) {
  const expired = isExpired(account.expires_at);
  const service = serviceOf(account);
  const generatedLimit = service === "shahid" ? (account.account_type === "private" ? 4 : 8) : account.account_type === "private" ? 5 : 10;
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
    const latestCode = await readLatestVerificationCode(account.id);

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
            { label: "نوع الحساب", value: accountTypeLabel(account.account_type) },
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
            ].map((tab) => (
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
            <button
              type="button"
              onClick={() => setToast({ label: "ميزة تعديل الرصيد قيد الإعداد", at: Date.now() })}
              className="rounded-full border border-[#E4D6FA] bg-white px-4 py-2 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
            >
              تعديل الرصيد
            </button>
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
  const [codeRequestState, setCodeRequestState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [codeRequestSeconds, setCodeRequestSeconds] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [deviceView, setDeviceView] = useState<DeviceView | null>(null);
  const [pendingDeviceView, setPendingDeviceView] = useState<DeviceView | null>(null);
  const [agreeDeviceChoice, setAgreeDeviceChoice] = useState(false);
  const [showPreRequestModal, setShowPreRequestModal] = useState(false);
  const [agreePreRequest, setAgreePreRequest] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const requestBaselineRef = useRef<{ code: string | null; receivedAt: string | null }>({ code: null, receivedAt: null });

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
      const { data, error } = await supabase
        .from("customer_links")
        .select(
          "*,accounts(id,email,use_automated_code,verification_code,verification_code_received_at,service_type,account_type,expires_at,created_at)",
        )
        .eq(queryColumn, identifier)
        .single();

      if (!error) setLink(data as unknown as CustomerLink);
      setLoading(false);
    }

    void loadCustomer();
  }, [identifier, lookup]);

  useEffect(() => {
    const selectedDevice = link?.selected_device;
    setDeviceView(selectedDevice === "mobile" || selectedDevice === "screen" ? selectedDevice : null);
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
  }, [link?.id, link?.selected_device]);

  useEffect(() => {
    const shouldLock = showDisclaimer || showReminder || Boolean(pendingDeviceView);
    const previous = document.body.style.overflow;
    if (shouldLock) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [showDisclaimer, showReminder, pendingDeviceView]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (countdownRef.current) window.clearInterval(countdownRef.current);
    };
  }, []);

  const account = link?.accounts;
  const service = serviceOf(account);
  const theme = serviceThemes[service];
  const tvApprovalUrl = String(link?.tv_approval_url || "").trim();
  const supportWhatsAppUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    `مرحباً اريد الحصول على الكود المخصص للحساب: ${account?.email || ""}`,
  )}`;
  const attemptsExhaustedWhatsAppUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    `مرحباً، نفدت محاولة طلب الكود لهذا الحساب: ${account?.email || ""}. أحتاج مساعدة من الدعم الفني.`,
  )}`;
  const deviceLabel = (device: DeviceView) => (device === "mobile" ? "جوال / آيباد / بي سي / لابتوب" : "شاشة / سوني");
  const deviceChoiceLocked = Boolean(deviceView);
  const codeReceivedAtMs = account?.verification_code_received_at ? new Date(account.verification_code_received_at).getTime() : null;
  const codeExpiresAtMs = codeReceivedAtMs ? codeReceivedAtMs + 120_000 : null;
  const codeSecondsRemaining = codeExpiresAtMs ? Math.max(0, Math.ceil((codeExpiresAtMs - nowTick) / 1000)) : 0;
  const codeIsVisible = Boolean(account?.verification_code && codeExpiresAtMs && codeExpiresAtMs > nowTick);
  const automatedCodeEnabled = account?.use_automated_code !== false;
  const codeRequestLimit = Math.max(0, link?.code_request_limit ?? 1);
  const codeRequestedCount = Math.max(0, link?.code_requested_count ?? 0);
  const hasCodeRequestCredit = codeRequestedCount < codeRequestLimit;
  const attemptUsed = !hasCodeRequestCredit;

  useEffect(() => {
    if (automatedCodeEnabled) return;
    setDeviceView(null);
    setPendingDeviceView(null);
    setAgreeDeviceChoice(false);
    setShowPreRequestModal(false);
    setAgreePreRequest(false);
    setCodeRequestState("idle");
    setCodeRequestSeconds(0);
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
  }, [automatedCodeEnabled]);

  useEffect(() => {
    if (!supabase || !link?.id || deviceView !== "screen") return;
    const client = supabase;
    let active = true;

    const refreshTvApprovalUrl = async () => {
      const { data, error } = await client
        .from("customer_links")
        .select("tv_approval_url")
        .eq("id", link.id)
        .maybeSingle();

      if (error) {
        console.error("Supabase TV approval URL refresh error:", error);
        return;
      }

      if (active && data?.tv_approval_url) {
        setLink((current) =>
          current
            ? {
                ...current,
                tv_approval_url: data.tv_approval_url,
              }
            : current,
        );
      }
    };

    void refreshTvApprovalUrl();
    const timer = window.setInterval(() => void refreshTvApprovalUrl(), 2000);
    const channel = client
      .channel(`customer-tv-approval-${link.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "customer_links",
          filter: `id=eq.${link.id}`,
        },
        (payload) => {
          const nextUrl = String(payload.new.tv_approval_url || "").trim();
          if (!active || !nextUrl) return;
          setLink((current) =>
            current
              ? {
                  ...current,
                  tv_approval_url: nextUrl,
                }
              : current,
          );
        },
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [deviceView, link?.id]);

  function requestDeviceChoice(device: DeviceView) {
    if (!automatedCodeEnabled || deviceChoiceLocked || (device === "mobile" && attemptUsed)) return;
    setPendingDeviceView(device);
    setAgreeDeviceChoice(false);
  }

  async function confirmDeviceChoice() {
    if (!pendingDeviceView || !link?.id || (pendingDeviceView === "mobile" && attemptUsed)) return;
    const selectedDevice = pendingDeviceView;

    if (supabase) {
      const { data, error } = await supabase
        .from("customer_links")
        .update({ selected_device: selectedDevice })
        .eq("id", link.id)
        .is("selected_device", null)
        .select("selected_device")
        .maybeSingle();

      if (error) {
        console.error("Supabase customer device lock error:", error);
        setToast({ label: "تعذر حفظ نوع الجهاز، حدّث الصفحة وحاول مجدداً", at: Date.now() });
        return;
      }

      if (!data?.selected_device) {
        const { data: currentLink, error: refreshError } = await supabase
          .from("customer_links")
          .select("selected_device")
          .eq("id", link.id)
          .maybeSingle();
        if (refreshError) console.error("Supabase customer device refresh error:", refreshError);
        if (currentLink?.selected_device === "mobile" || currentLink?.selected_device === "screen") {
          setLink((current) =>
            current ? { ...current, selected_device: currentLink.selected_device } : current,
          );
          setDeviceView(currentLink.selected_device);
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

  function openPreRequestModal() {
    if (!automatedCodeEnabled || attemptUsed || codeIsVisible) return;
    setShowPreRequestModal(true);
    setAgreePreRequest(false);
  }

  async function confirmPreRequest() {
    if (!automatedCodeEnabled || !link?.id || !hasCodeRequestCredit) return;
    const nextRequestedCount = codeRequestedCount + 1;

    if (supabase) {
      const { data, error } = await supabase
        .from("customer_links")
        .update({ code_requested_count: nextRequestedCount })
        .eq("id", link.id)
        .eq("code_requested_count", codeRequestedCount)
        .select("code_requested_count,code_request_limit")
        .maybeSingle();

      if (error || !data) {
        console.error("Supabase customer code request count update error:", error);
        setToast({ label: "تعذر خصم محاولة الكود، حدّث الصفحة وحاول مجدداً", at: Date.now() });
        return;
      }

      setLink((current) =>
        current
          ? {
              ...current,
              code_requested_count: data.code_requested_count,
              code_request_limit: data.code_request_limit,
            }
          : current,
      );
    } else {
      setLink((current) =>
        current ? { ...current, code_requested_count: nextRequestedCount } : current,
      );
    }

    setShowPreRequestModal(false);
    setAgreePreRequest(false);
    startCodeRequest();
  }

  async function pollVerificationCode(accountId: string, startedAt: number) {
    if (!supabase) {
      if (link?.accounts?.verification_code) {
        setCodeRequestState("ready");
      }
      return;
    }

    const latestCode = await readLatestVerificationCode(accountId);
    const currentCode = latestCode.code;
    const currentReceivedAt = latestCode.receivedAt;
    const baseline = requestBaselineRef.current;
    const hasFreshCode =
      Boolean(currentCode) &&
      (baseline.code !== currentCode || baseline.receivedAt !== currentReceivedAt);

    if (!latestCode.error && hasFreshCode) {
      setLink((current) =>
        current && current.accounts
          ? {
              ...current,
              accounts: {
                ...current.accounts,
                verification_code: currentCode,
                verification_code_received_at: currentReceivedAt,
              },
            }
          : current,
      );
      setCodeRequestState("ready");
      setToast({ label: "تم استلام كود جديد", at: Date.now() });
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (countdownRef.current) window.clearInterval(countdownRef.current);
      return;
    }

    if (Date.now() - startedAt >= 15_000) {
      setCodeRequestState("failed");
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (countdownRef.current) window.clearInterval(countdownRef.current);
    }
  }

  function startCodeRequest() {
    const accountId = account?.id;
    if (!automatedCodeEnabled || !accountId) return;

    setCodeRequestState("loading");
    setCodeRequestSeconds(15);
    requestBaselineRef.current = {
      code: account?.verification_code || null,
      receivedAt: account?.verification_code_received_at || null,
    };

    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);

    const startedAt = Date.now();

    countdownRef.current = window.setInterval(() => {
      setCodeRequestSeconds((current) => {
        if (current <= 1) {
          if (countdownRef.current) window.clearInterval(countdownRef.current);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    void pollVerificationCode(accountId, startedAt);
    pollTimerRef.current = window.setInterval(() => {
      void pollVerificationCode(accountId, startedAt);
    }, 2000);

    timeoutRef.current = window.setTimeout(() => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (countdownRef.current) window.clearInterval(countdownRef.current);
      setCodeRequestState((current) => (current === "ready" ? current : "failed"));
    }, 15_000);
  }

  return (
    <Shell toast={toast}>
      <div className="min-h-screen bg-gradient-to-b from-[#F3F4F6] via-[#F9FAFB] to-white px-4 py-6 md:py-10" dir="rtl">
        <div className="mx-auto w-full max-w-[640px]">
          <header className="mb-8 flex items-center justify-between rounded-[2rem] border border-white bg-white/80 p-4 shadow-premium backdrop-blur">
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
              className={cn("flex h-12 w-12 items-center justify-center rounded-2xl transition duration-300 hover:-translate-y-1 hover:text-white", theme.soft, theme.hoverBg)}
              aria-label="الإدارة"
            >
              <UserRound className="h-6 w-6" />
            </button>
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
              <section className="animate-rise overflow-hidden rounded-[2rem] bg-white p-4 shadow-video-glow md:p-5">
                <div className="flex justify-center overflow-hidden rounded-[1.6rem] bg-zinc-950/95">
                  {videoUrl ? (
                    <iframe
                      className="aspect-[9/16] w-full max-w-[360px] bg-zinc-950"
                      src={videoUrl}
                      title="شرح طريقة الدخول"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex aspect-[9/16] w-full max-w-[360px] flex-col items-center justify-center bg-zinc-950 px-5 text-center text-white">
                      <MonitorPlay className={cn("mb-4 h-14 w-14", theme.accent)} />
                      <p className="text-2xl font-black">شرح طريقة الدخول</p>
                      <p className="mt-3 max-w-md text-sm leading-7 text-zinc-300">
                        أضف رابط فيديو الشرح في `VITE_CUSTOMER_VIDEO_URL` ليظهر هنا مباشرة.
                      </p>
                    </div>
                  )}
                </div>
                <div className="px-6 py-5 text-right">
                  <p className={cn("bg-gradient-to-l bg-clip-text text-sm font-black text-transparent", theme.gradient)}>
                    ابدأ من هنا
                  </p>
                  <h2 className="text-2xl font-black md:text-3xl">شرح طريقة الدخول</h2>
                </div>
              </section>

              <section className="animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
                <div className="mb-6 text-center">
                  <div className={cn("mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl", theme.soft)}>
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <h2 className="text-3xl font-black md:text-4xl">بيانات تسجيل الدخول</h2>
                </div>

                <div className="space-y-5">
                  <LoginCopyCard label="البريد الإلكتروني" value={account.email} icon={Mail} setToast={setToast} theme={theme} />
                  {!automatedCodeEnabled ? (
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
                        href={supportWhatsAppUrl}
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
                        disabled={deviceChoiceLocked || attemptUsed}
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
                        disabled={deviceChoiceLocked}
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
                    {attemptUsed && !deviceChoiceLocked ? (
                      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-rose-600">
                        تم استهلاك رصيد الأكواد للجوال، ويمكنك اختيار شاشة / سوني دون خصم رصيد.
                      </p>
                    ) : deviceChoiceLocked ? (
                      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-[#7C2CE8]">
                        تم تأكيد نوع الجهاز ولا يمكن تغييره.
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
                      <a
                        href={attemptsExhaustedWhatsAppUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white transition hover:bg-[#7626DD]"
                      >
                        <WhatsAppLogo className="h-5 w-5" />
                        تواصل مع الدعم الفني
                      </a>
                    </div>
                  ) : !deviceView ? null : deviceView === "screen" ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      {tvApprovalUrl ? (
                        <a
                          href={tvApprovalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mb-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#E50914] to-[#8B35F5] px-4 text-center text-sm font-black text-white shadow-[0_14px_34px_rgba(139,53,245,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(229,9,20,0.24)]"
                        >
                          <ExternalLink className="h-5 w-5" />
                          اضغط هنا لتسجيل الدخول المباشر للشاشة / سوني
                        </a>
                      ) : (
                        <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-[#DCCBFA] bg-white px-4 py-3 text-center text-xs font-black text-[#7C2CE8]">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          جاري انتظار رابط الموافقة المباشر...
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <WhatsAppLogo className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">شاشة / سوني</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            لهذا النوع من الأجهزة، تواصل مع الدعم للحصول على الكود ومساعدتك في الدخول.
                          </p>
                        </div>
                      </div>
                      <a
                        href={supportWhatsAppUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD]"
                      >
                        <WhatsAppLogo className="h-5 w-5" />
                        تواصل مع الدعم للحصول على الكود
                      </a>
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
                          onClick={() => copyText(account.verification_code || "", setToast)}
                          className="flex h-10 items-center gap-2 rounded-xl border border-[#E0D4F8] bg-white px-4 text-sm font-black text-[#7C2CE8] transition hover:bg-[#F5EEFF]"
                        >
                          <Clipboard className="h-4 w-4" />
                          نسخ الكود
                        </button>
                      </div>
                      <div className="rounded-2xl border border-[#E0D4F8] bg-white px-4 py-4 text-center">
                        <p className="font-mono text-4xl font-black tracking-[0.3em] text-[#8B35F5]" dir="ltr">
                          {account.verification_code}
                        </p>
                        {account.verification_code_received_at && (
                          <p className="mt-2 text-xs font-bold text-zinc-500">
                            {formatDateTime(account.verification_code_received_at)}
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
                  ) : deviceView === "mobile" && attemptUsed ? (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-white p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <ShieldCheck className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">نفاذ رصيد طلب الأكواد لهذا الحساب</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            تم استهلاك محاولة طلب الكود الوحيدة لهذا الحساب. تواصل مع الدعم الفني عبر الواتساب للمساعدة.
                          </p>
                        </div>
                      </div>
                      <a
                        href={attemptsExhaustedWhatsAppUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD]"
                      >
                        <WhatsAppLogo className="h-5 w-5" />
                        تواصل مع الدعم الفني عبر الواتساب
                      </a>
                    </div>
                  ) : (
                    <div className="rounded-[1.75rem] border border-[#E0D4F8] bg-gradient-to-l from-white to-[#F7F2FF] p-4 shadow-card">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F0E7FF] text-[#8B35F5]">
                          <LockKeyhole className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-black">طلب كود التحقق</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">
                            اضغط للبحث تلقائياً داخل قاعدة البيانات لمدة 15 ثانية.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openPreRequestModal}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B35F5] text-sm font-black text-white shadow-[0_14px_32px_rgba(139,53,245,0.24)] transition hover:bg-[#7626DD]"
                      >
                        <KeyRound className="h-4 w-4" />
                        طلب كود التحقق
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
                    <ProfileMiniCard label="رمز الملف" value={getProfilePin(link)} icon={LockKeyhole} setToast={setToast} theme={theme} ltr />
                  )}
                </div>
              </section>

              <section className="animate-rise rounded-[2rem] border border-white bg-white p-6 shadow-premium-lg md:p-8">
                <div className="mb-6 text-center">
                  <p className={cn("bg-gradient-to-l bg-clip-text text-sm font-black text-transparent", theme.gradient)}>اتبعها بالترتيب</p>
                  <h2 className="text-3xl font-black md:text-4xl">خطوات الدخول إلى {theme.name}</h2>
                </div>
                <div className="space-y-3">
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
                </div>

                <p className="mt-6 text-center text-sm font-bold leading-7 text-zinc-600">
                  ملاحظة: يمكن فتح الرابط مباشرة، وللدعم السريع استخدم زر الواتساب بالأسفل.
                </p>
              </section>

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

          {automatedCodeEnabled && deviceView === "screen" && (
            <a
              href={supportWhatsAppUrl}
              target="_blank"
              rel="noreferrer"
              className={cn("fixed bottom-5 left-5 z-40 flex h-[60px] w-[60px] animate-whatsapp-pulse items-center justify-center rounded-full bg-gradient-to-br text-white backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-premium-lg", theme.gradient, theme.glow)}
              aria-label="WhatsApp"
            >
              <WhatsAppLogo className="h-7 w-7" />
            </a>
          )}
        </div>
      </div>
    </Shell>
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
            هل أنت متأكد من اختيار جهاز ({deviceLabel})؟ تنبيه: لا يمكنك تغيير نوع الجهاز بعد التأكيد.
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
            أقر بأنني اخترت الجهاز الصحيح ولن أتمكن من تغيير خياري لاحقاً.
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
            هل قمت بإدخال البريد الإلكتروني والضغط على تسجيل الدخول في تطبيق Netflix أولاً؟ تنبيه هام: يحق لك طلب الكود لمرة واحدة فقط لهذا الحساب.
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
            أقر بأنني بدأت تسجيل الدخول وأعلم أن هذه المحاولة هي الوحيدة المتاحة لهذا الحساب.
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
