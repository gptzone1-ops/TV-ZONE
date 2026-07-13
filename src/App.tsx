import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleCheck,
  CircleX,
  Clipboard,
  Copy,
  Eye,
  Link2,
  KeyRound,
  LockKeyhole,
  Mail,
  MessageCircle,
  MonitorPlay,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
  Users,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { accountTypeLabel, buildProfileSlots } from "./lib/profiles";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { AccountType, CustomerLink, NetflixAccount, ServiceType } from "./types";

type Screen = "selector" | "netflix" | "account";
type Toast = { label: string; at: number } | null;
type StatTone = "neutral" | "green" | "red";
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

const defaultCustomerVideoUrl = "https://www.youtube.com/embed/O47a5G17OXQ?playsinline=1&rel=0&modestbranding=1";
const videoUrl = import.meta.env.VITE_CUSTOMER_VIDEO_URL || defaultCustomerVideoUrl;
const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";
const adminAuthKey = "zone-admin-auth";
const adminAuthValue = `remembered:${adminPassword}`;
const whatsappNumber = "966578696159";
const whatsappRequestMessage = "مرحباً، أريد الحصول على كود التحقق لحسابي";
const whatsappRequestUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappRequestMessage)}`;
const disclaimerStorageKey = "disclaimer_accepted";
const dayMs = 1000 * 60 * 60 * 24;

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

function getBaseUrl() {
  return window.location.origin;
}

function getCustomerUrl(link: CustomerLink) {
  return link.short_id ? `${getBaseUrl()}/v/${link.short_id}` : `${getBaseUrl()}/view/${link.uuid}`;
}

async function copyText(text: string, setToast: (toast: Toast) => void) {
  await navigator.clipboard.writeText(text);
  setToast({ label: "تم النسخ بنجاح", at: Date.now() });
}

const demoAccount: NetflixAccount = {
  id: "demo-account",
  email: "zone.netflix@example.com",
  password: "Zone@2026",
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

  async function addAccount(form: { email: string; password: string; account_type: AccountType }) {
    const expires_at = defaultExpiryDate();
    const slots = buildProfileSlots(form.account_type, selectedService);

    if (!supabase) {
      const account: NetflixAccount = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        expires_at,
        service_type: selectedService,
        ...form,
      };
      const createdLinks = slots.map((slot) => ({
        id: crypto.randomUUID(),
        account_id: account.id,
        created_at: new Date().toISOString(),
        ...slot,
      }));
      setAccounts((current) => [account, ...current]);
      setLinks((current) => [...current, ...createdLinks]);
      setSelectedAccountId(account.id);
      setScreen("account");
      setToast({ label: "تم إنشاء الحساب محلياً للمعاينة", at: Date.now() });
      return;
    }

    setLoading(true);
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .insert({ ...form, expires_at, service_type: selectedService })
      .select()
      .single();

    if (accountError || !account) {
      setLoading(false);
      setToast({ label: "تعذر إنشاء الحساب", at: Date.now() });
      return;
    }

    const { error: linksError } = await supabase.from("customer_links").insert(
      slots.map((slot) => ({
        account_id: account.id,
        ...slot,
      })),
    );

    setToast({
      label: linksError ? "تم إنشاء الحساب وتعذر إنشاء الروابط" : "تم إنشاء الحساب والروابط",
      at: Date.now(),
    });
    await loadData();
    setSelectedAccountId(account.id);
    setScreen("account");
    setLoading(false);
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
    return serviceAccounts.filter((account) => account.email.toLowerCase().includes(normalized));
  }, [serviceAccounts, query]);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null;
  const activeLinks = links.filter((link) => link.account_id === selectedAccountId);
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
          navigate={navigate}
          setToast={setToast}
          onDelete={deleteAccount}
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
        onSelect={(id) => {
          setSelectedAccountId(id);
          setScreen("account");
        }}
        onDelete={deleteAccount}
        onLogout={logout}
      />
    </Shell>
  );
}

function Shell({ children, toast }: { children: React.ReactNode; toast: Toast }) {
  return (
    <main className="min-h-screen bg-[#F9FAFB] text-ink" dir="rtl">
      {children}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 animate-rise items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-premium">
          <Check className="h-4 w-4 text-white" />
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
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-netflix to-red-700 text-xl font-black text-white shadow-red">
          زون
        </div>
        <p className="text-sm font-black text-netflix">Zone Store</p>
        <h1 className="mt-2 text-3xl font-black">دخول لوحة التحكم</h1>
        <p className="mt-2 text-sm font-bold text-zinc-500">أدخل كلمة المرور لعرض وإدارة حسابات نتفلكس.</p>

        <label className="mt-7 block text-right">
          <span className="mb-2 flex items-center gap-2 text-sm font-black">
            <LockKeyhole className="h-4 w-4 text-netflix" />
            كلمة المرور
          </span>
          <input
            autoFocus
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-13 w-full rounded-2xl border border-zinc-200 bg-zinc-100/80 px-4 text-center text-lg font-black outline-none transition duration-300 focus:border-netflix focus:bg-white focus:shadow-red-soft"
          />
        </label>

        <button className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-netflix to-red-700 text-sm font-black text-white shadow-red transition duration-300 hover:-translate-y-1">
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
            <p className="text-sm font-extrabold text-netflix">Zone Store</p>
            <h1 className="mt-2 text-3xl font-black tracking-normal md:text-5xl">لوحة إدارة الاشتراكات</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-netflix transition duration-300 hover:bg-netflix hover:text-white"
            >
              تسجيل الخروج
            </button>
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-netflix text-2xl font-black text-white shadow-red">
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
  loading,
  onQuery,
  onAdd,
  onSelect,
  onDelete,
  onBackToServices,
  onLogout,
}: {
  accounts: NetflixAccount[];
  stats: Array<{ label: string; value: number; icon: LucideIcon; tone: StatTone }>;
  service: ServiceType;
  query: string;
  loading: boolean;
  onQuery: (query: string) => void;
  onAdd: Parameters<typeof AccountForm>[0]["onAdd"];
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onBackToServices: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <Header service={service} onBack={onBackToServices} onLogout={onLogout} />
      {!hasSupabaseConfig && <ConfigNotice />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard key={stat.label} stat={stat} index={index} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
        <AccountForm onAdd={onAdd} loading={loading} service={service} />

        <div className="rounded-3xl border border-zinc-100 bg-white shadow-premium">
          <div className="border-b border-zinc-100 p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="ابحث بالبريد الإلكتروني"
                className="h-13 w-full rounded-2xl border border-zinc-200 bg-[#F9FAFB] px-4 pr-12 text-sm font-bold outline-none transition duration-300 focus:border-netflix focus:bg-white focus:shadow-red-soft"
              />
            </div>
          </div>

          <div className="grid max-h-[650px] gap-4 overflow-auto p-5 scrollbar-thin md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account, index) => (
              <AccountCard key={account.id} account={account} index={index} onSelect={onSelect} onDelete={onDelete} />
            ))}

            {!accounts.length && (
              <div className="col-span-full flex min-h-56 items-center justify-center rounded-3xl border border-dashed border-zinc-200 text-sm font-bold text-zinc-400">
                لا توجد حسابات مطابقة.
              </div>
            )}
          </div>
        </div>
      </section>
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
    neutral: "bg-zinc-50 text-zinc-800",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-netflix",
  }[stat.tone];

  const valueClass = {
    neutral: "text-ink",
    green: "text-emerald-600",
    red: "text-netflix",
  }[stat.tone];

  return (
    <article
      className="animate-rise rounded-3xl border border-zinc-100 bg-white p-5 shadow-premium transition duration-300 hover:-translate-y-1 hover:shadow-premium-lg"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-extrabold text-zinc-500">{stat.label}</p>
          <p className={cn("mt-2 text-4xl font-black", valueClass)}>{stat.value}</p>
        </div>
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", toneClass)}>
          <stat.icon className="h-6 w-6" />
        </div>
      </div>
    </article>
  );
}

function AccountCard({
  account,
  index,
  onSelect,
  onDelete,
}: {
  account: NetflixAccount;
  index: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const expired = isExpired(account.expires_at);

  return (
    <button
      onClick={() => onSelect(account.id)}
      className="group animate-rise rounded-3xl border border-zinc-100 bg-white p-5 text-right shadow-card transition duration-300 hover:-translate-y-1 hover:border-red-100 hover:shadow-premium-lg active:scale-[0.98]"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-ink" dir="ltr">
            {account.email}
          </p>
          <p className="mt-1 text-xs font-extrabold text-zinc-400">{accountTypeLabel(account.account_type)}</p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-black",
            expired ? "bg-red-50 text-netflix" : "bg-emerald-50 text-emerald-600",
          )}
        >
          {expired ? <CircleX className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
          {expired ? "منتهي" : "فعال"}
        </span>
      </div>

      <div className="rounded-2xl bg-[#F9FAFB] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-zinc-500">
            <CalendarDays className="h-4 w-4 text-netflix" />
            {formatDate(account.expires_at)}
          </div>
          <ChevronLeft className="h-5 w-5 text-zinc-300 transition duration-300 group-hover:-translate-x-1 group-hover:text-netflix" />
        </div>
        <p className={cn("mt-3 text-sm font-black", expired ? "text-netflix" : "text-emerald-600")}>
          {remainingLabel(account.expires_at)}
        </p>
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          void onDelete(account.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            void onDelete(account.id);
          }
        }}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 text-sm font-black text-netflix transition duration-300 hover:bg-netflix hover:text-white"
      >
        <Trash2 className="h-4 w-4" />
        حذف
      </span>
    </button>
  );
}

function Header({ service, onBack, onLogout }: { service: ServiceType; onBack: () => void; onLogout: () => void }) {
  const theme = serviceThemes[service];
  return (
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-zinc-100 bg-white p-6 shadow-premium md:flex-row md:items-center md:justify-between">
      <div>
        <button onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-black text-zinc-500 transition hover:text-ink">
          <ArrowRight className="h-4 w-4" />
          رجوع
        </button>
        <p className={cn("text-sm font-black", theme.accent)}>Zone Store</p>
        <h1 className="mt-1 text-2xl font-black md:text-4xl">{theme.title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-left text-sm font-bold text-zinc-500 sm:block">
          <p>لوحة تشغيل الاشتراكات</p>
          <p>{formatDate(new Date().toISOString())}</p>
        </div>
        <button
          onClick={onLogout}
          className="h-12 rounded-2xl border border-red-100 bg-red-50 px-4 text-sm font-black text-netflix transition duration-300 hover:bg-netflix hover:text-white"
        >
          تسجيل الخروج
        </button>
        <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-black text-white", theme.gradient, theme.glow)}>
          Z
        </div>
      </div>
    </header>
  );
}

function ConfigNotice() {
  return (
    <div className="mb-6 rounded-3xl border border-red-100 bg-red-50 p-4 text-sm font-bold leading-7 text-red-900 shadow-card">
      التطبيق يعمل الآن بوضع معاينة محلي. أضف `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` في ملف `.env`
      ثم شغل جداول Supabase الموجودة في `supabase/schema.sql` لتفعيل التخزين الحقيقي.
    </div>
  );
}

function AccountForm({
  onAdd,
  loading,
  service,
}: {
  onAdd: (form: { email: string; password: string; account_type: AccountType }) => Promise<void>;
  loading: boolean;
  service: ServiceType;
}) {
  const [accountType, setAccountType] = useState<AccountType>("private");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const calculatedExpiry = defaultExpiryDate();
  const theme = serviceThemes[service];

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onAdd({ email, password, account_type: accountType });
    setEmail("");
    setPassword("");
    setAccountType("private");
  }

  return (
    <form onSubmit={submit} className="animate-rise rounded-3xl border border-zinc-100 bg-white p-6 shadow-premium">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-extrabold text-zinc-500">حساب جديد</p>
          <h2 className="text-xl font-black">إضافة حساب {theme.name}</h2>
        </div>
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white", theme.gradient, theme.glow)}>
          <Plus className="h-5 w-5" />
        </div>
      </div>

      <Field icon={Mail} label="البريد الإلكتروني">
        <input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full rounded-2xl border border-zinc-200 bg-[#F9FAFB] px-4 text-left font-bold outline-none transition duration-300 focus:border-netflix focus:bg-white focus:shadow-red-soft"
          dir="ltr"
        />
      </Field>

      <Field icon={KeyRound} label="كلمة المرور">
        <input
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 w-full rounded-2xl border border-zinc-200 bg-[#F9FAFB] px-4 text-left font-bold outline-none transition duration-300 focus:border-netflix focus:bg-white focus:shadow-red-soft"
          dir="ltr"
        />
      </Field>

      <div className="mb-5 rounded-2xl bg-[#F9FAFB] p-4">
        <div className="flex items-center gap-2 text-sm font-black text-zinc-500">
          <CalendarDays className="h-4 w-4 text-netflix" />
          تاريخ الانتهاء التلقائي
        </div>
        <p className="mt-2 text-lg font-black">{formatDate(calculatedExpiry)}</p>
        <p className="mt-1 text-xs font-bold text-zinc-400">يتم احتسابه بعد 30 يوماً من تاريخ الإضافة.</p>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-sm font-black">نوع الحساب</p>
        <div className="grid grid-cols-2 gap-2">
          {(["private", "shared"] as AccountType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setAccountType(type)}
              className={cn(
                "h-12 rounded-2xl border text-sm font-black transition duration-300 active:scale-[0.98]",
                accountType === type
                  ? cn("border-transparent bg-gradient-to-br text-white", theme.gradient, theme.glow)
                  : cn("border-zinc-200 bg-[#F9FAFB] text-zinc-600", service === "shahid" ? "hover:border-cyan-200" : "hover:border-red-100"),
              )}
            >
              {accountTypeLabel(type)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs font-bold text-zinc-500">
          {service === "shahid"
            ? accountType === "private"
              ? "سيتم إنشاء 4 روابط تلقائياً بدون رمز ملف."
              : "سيتم إنشاء 8 روابط تلقائياً بدون رمز ملف."
            : accountType === "private"
              ? "سيتم إنشاء 5 روابط تلقائياً."
              : "سيتم إنشاء 10 روابط تلقائياً."}
        </p>
      </div>

      <button
        disabled={loading}
        className={cn("flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br text-sm font-black text-white transition duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60", theme.gradient, theme.glow)}
      >
        <Plus className="h-5 w-5" />
        {loading ? "جاري الحفظ..." : "إضافة الحساب"}
      </button>
    </form>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 flex items-center gap-2 text-sm font-black">
        <Icon className="h-4 w-4 text-netflix" />
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
  navigate,
  setToast,
  onDelete,
  onLogout,
}: {
  account: NetflixAccount;
  links: CustomerLink[];
  onBack: () => void;
  navigate: (path: string) => void;
  setToast: (toast: Toast) => void;
  onDelete: (accountId: string) => Promise<void>;
  onLogout: () => void;
}) {
  const expired = isExpired(account.expires_at);
  const service = serviceOf(account);
  const theme = serviceThemes[service];
  const generatedLimit = service === "shahid" ? (account.account_type === "private" ? 4 : 8) : account.account_type === "private" ? 5 : 10;
  const allLinksText = links
    .map((link) => `للحصول على بيانات الحساب ادخل على الرابط التالي: ${getCustomerUrl(link)} يجب الإحتفاظ بالرابط`)
    .join("\n");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-black text-zinc-600 transition hover:text-netflix">
          <ArrowRight className="h-4 w-4" />
          رجوع للحسابات
        </button>
        <button
          onClick={onLogout}
          className="rounded-2xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-netflix transition duration-300 hover:bg-netflix hover:text-white"
        >
          تسجيل الخروج
        </button>
      </div>

      <section className="mb-6 rounded-3xl border border-zinc-100 bg-white p-6 shadow-premium">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black",
                expired ? "bg-red-50 text-netflix" : "bg-emerald-50 text-emerald-600",
              )}
            >
              {expired ? <CircleX className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
              {expired ? "منتهي" : "فعال"}
            </span>
            <h1 className="mt-3 truncate text-2xl font-black md:text-3xl" dir="ltr">
              {account.email}
            </h1>
            <p className="mt-2 text-sm font-bold text-zinc-500">
              ينتهي في {formatDate(account.expires_at)} - {remainingLabel(account.expires_at)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:min-w-72">
            <div className="rounded-2xl bg-[#F9FAFB] p-4">
              <p className="text-3xl font-black">{links.length}</p>
              <p className="text-xs font-bold text-zinc-500">رابط عميل</p>
            </div>
            <div className="rounded-2xl bg-red-50 p-4">
              <p className={cn("text-3xl font-black", theme.accent)}>{generatedLimit}</p>
              <p className="text-xs font-bold text-red-900">الحد المولد</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => copyText(allLinksText, setToast)}
          disabled={!links.length}
          className={cn("mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br text-sm font-black text-white transition duration-300 hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-60", theme.gradient, theme.glow)}
        >
          <Copy className="h-5 w-5" />
          نسخ جميع روابط العملاء
        </button>
        <button
          onClick={() => void onDelete(account.id)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 text-sm font-black text-netflix transition duration-300 hover:-translate-y-1 hover:bg-netflix hover:text-white"
        >
          <Trash2 className="h-5 w-5" />
          حذف هذا الإيميل
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link, index) => {
          const customerUrl = getCustomerUrl(link);
          return (
            <article
              key={link.id}
              className="animate-rise rounded-3xl border border-zinc-100 bg-white p-5 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-premium"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-extrabold text-zinc-500">ملف العميل</p>
                  <h3 className="text-3xl font-black">{link.profile_name}</h3>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-netflix">
                  <UserRound className="h-5 w-5" />
                </div>
              </div>
              <p className="mb-4 truncate rounded-2xl bg-[#F9FAFB] px-3 py-3 text-left text-xs font-bold text-zinc-500" dir="ltr">
                {customerUrl}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => copyText(customerUrl, setToast)}
                  className={cn("flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br text-sm font-black text-white transition duration-300", theme.gradient, theme.glow)}
                >
                  <Copy className="h-4 w-4" />
                  نسخ الرابط
                </button>
                <button
                  onClick={() => navigate(link.short_id ? `/v/${link.short_id}` : `/view/${link.uuid}`)}
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 text-sm font-black transition duration-300 hover:border-netflix hover:text-netflix"
                >
                  <Eye className="h-4 w-4" />
                  معاينة
                </button>
              </div>
            </article>
          );
        })}
      </section>
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
        .select("*, accounts(*)")
        .eq(queryColumn, identifier)
        .single();

      if (!error) setLink(data as CustomerLink);
      setLoading(false);
    }

    void loadCustomer();
  }, [identifier, lookup]);

  useEffect(() => {
    const shouldLock = showDisclaimer || showReminder;
    const previous = document.body.style.overflow;
    if (shouldLock) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [showDisclaimer, showReminder]);

  const account = link?.accounts;
  const service = serviceOf(account);
  const theme = serviceThemes[service];

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
                  <a
                    href={whatsappRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-4 rounded-[1.75rem] border border-green-100 bg-gradient-to-l from-white to-[#F8FFF9] p-4 text-right shadow-card transition duration-300 hover:-translate-y-1 hover:border-[#25D366] hover:shadow-premium"
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#E9F9EF] text-[#25D366]">
                      <WhatsAppLogo className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-black">للحصول على كود التحقق، تواصل معنا عبر الواتساب</p>
                      <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">سيفتح المحادثة برسالة جاهزة للدعم الفني.</p>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-[#25D366]" />
                  </a>
                  {account.supplier_code_url && (
                    <a
                      href={account.supplier_code_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 rounded-[1.75rem] border border-red-100 bg-gradient-to-l from-white to-[#F9FAFB] px-4 py-4 shadow-card transition duration-300 hover:-translate-y-1 hover:border-netflix/50 hover:shadow-premium"
                    >
                      <div className="flex min-w-0 items-center gap-3 text-right">
                        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", theme.soft)}>
                          <Link2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className={cn("text-lg font-black", theme.accent)}>الدخول عبر الرابط</p>
                          <p className="mt-1 text-xs font-bold leading-6 text-zinc-500">يفتح رابط الحساب في تبويب جديد.</p>
                        </div>
                      </div>
                      <ArrowRight className={cn("h-5 w-5 shrink-0", theme.accent)} />
                    </a>
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
                    <ProfileMiniCard label="رمز الملف" value={link.profile_code} icon={LockKeyhole} setToast={setToast} theme={theme} ltr />
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

          <a
            href={whatsappRequestUrl}
            target="_blank"
            rel="noreferrer"
            className={cn("fixed bottom-5 left-5 z-40 flex h-[60px] w-[60px] animate-whatsapp-pulse items-center justify-center rounded-full bg-gradient-to-br text-white backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-premium-lg", theme.gradient, theme.glow)}
            aria-label="WhatsApp"
          >
            <WhatsAppLogo className="h-7 w-7" />
          </a>
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
