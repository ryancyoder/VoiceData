"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, type Deal, type Stage } from "@/lib/salesBoard";
import styles from "./tileLauncher.module.css";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// The Launch Pad's top-level tiles. Most open their route directly; the Sales
// Board tile drills into stages → deals in-place before landing on a deal.
type MainView = { key: string; label: string; icon: string; href?: string; drill?: "sales" };
const MAIN_VIEWS: MainView[] = [
  { key: "sales", label: "Sales Board", icon: "🗂️", drill: "sales" },
  { key: "estimator", label: "Estimator", icon: "🧮", href: "/estimator" },
  { key: "catalog", label: "Catalog", icon: "📚", href: "/catalog" },
  { key: "master-catalog", label: "Master Catalog", icon: "📖", href: "/master-catalog" },
  { key: "design", label: "Design", icon: "🎨", href: "/design" },
  { key: "plants", label: "Plants", icon: "🌿", href: "/plants" },
  { key: "plant-reference", label: "Plant Reference", icon: "🌱", href: "/plant-reference" },
  { key: "next-actions", label: "Next Actions", icon: "✅", href: "/next-actions" },
  { key: "next-action-photos", label: "Action Photos", icon: "📸", href: "/next-action-photos" },
  { key: "tasks", label: "Tasks", icon: "📋", href: "/tasks" },
  { key: "properties", label: "Properties", icon: "🏠", href: "/properties" },
  { key: "calendar", label: "Calendar", icon: "📅", href: "/calendar" },
  { key: "planner", label: "Planner", icon: "🗓️", href: "/planner" },
  { key: "photos", label: "Photos", icon: "🖼️", href: "/photos" },
  { key: "voicemap", label: "VoiceMap", icon: "🎙️", href: "/voicemap" },
  { key: "db", label: "Database", icon: "🗄️", href: "/db" },
  { key: "settings", label: "Settings", icon: "⚙️", href: "/settings" },
];

// Stage swatch colors — mirrors the Sales Board's --c-* palette so a stage
// reads the same here as it does on the board.
const STAGE_COLOR: Record<Stage, string> = {
  Lead: "#9CA3AF",
  Propose: "#EAB308",
  Sent: "#0891B2",
  Sold: "#9333EA",
  "Project Management": "#16A34A",
  Invoiced: "#DC2626",
  "Paid in Full": "#D4AF37",
};

function contactName(d: Deal): string {
  const c = d.property?.contact;
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

// A short monogram for a deal's square tile — its name's first two initials,
// falling back to the first two characters.
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// A deal is "active" (shown) unless it's lost — but a flagged deal (loose end)
// stays visible regardless. Mirrors the Sales Board's own activeDeals filter.
function isActive(d: Deal): boolean {
  return !d.lost_at || d.flagged;
}

type Screen = { level: "home" } | { level: "stages" } | { level: "deals"; stage: Stage };

export default function TileLauncher() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ level: "home" });
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [loadingDeals, setLoadingDeals] = useState(false);
  // Guards against a second fetch while one is already in flight. A ref (not
  // the loadingDeals state) so it's read synchronously — an effect-driven load
  // would cancel its own in-flight request when setLoadingDeals re-triggered it.
  const loadingRef = useRef(false);

  // Lazily load the board the first time the user drills into the Sales Board
  // branch — the Launch Pad itself costs nothing until then. Called imperatively
  // (not from an effect) so nothing tears down the request mid-flight.
  function loadDeals() {
    if (deals !== null || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingDeals(true);
    setDealsError(null);
    fetch("/api/sales-board")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setDeals(d.deals ?? []);
      })
      .catch((err) => {
        setDealsError(err instanceof Error ? err.message : "Couldn't load deals");
      })
      .finally(() => {
        loadingRef.current = false;
        setLoadingDeals(false);
      });
  }

  const activeDeals = (deals ?? []).filter(isActive);

  function openMainView(view: MainView) {
    if (view.drill === "sales") {
      loadDeals();
      setScreen({ level: "stages" });
    } else if (view.href) {
      router.push(view.href);
    }
  }

  const title =
    screen.level === "home"
      ? "Launch Pad"
      : screen.level === "stages"
        ? "Sales Board"
        : screen.stage;

  const crumb =
    screen.level === "deals" ? "Sales Board" : screen.level === "stages" ? "Launch Pad" : null;

  function back() {
    if (screen.level === "deals") setScreen({ level: "stages" });
    else if (screen.level === "stages") setScreen({ level: "home" });
  }

  return (
    <div className={styles.launcher}>
      <header className={styles.head}>
        {screen.level !== "home" ? (
          <button type="button" className={styles.back} onClick={back} aria-label="Back">
            ‹ {crumb}
          </button>
        ) : (
          <span className={styles.brand}>VoiceData</span>
        )}
        <h1 className={styles.title}>{title}</h1>
      </header>

      {screen.level === "home" && (
        <div className={styles.grid}>
          {MAIN_VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              className={styles.tile}
              onClick={() => openMainView(view)}
            >
              <span className={styles.tileTop}>
                <span className={styles.tileIcon} aria-hidden="true">
                  {view.icon}
                </span>
                {view.drill && <span className={styles.tileMore} aria-hidden="true">›</span>}
              </span>
              <span className={styles.tileCaption}>
                <span className={styles.tileName}>{view.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {screen.level === "stages" && (
        <div className={styles.grid}>
          {STAGES.map((stage) => {
            const count = loadingDeals ? null : activeDeals.filter((d) => d.stage === stage).length;
            return (
              <button
                key={stage}
                type="button"
                className={styles.tile}
                style={{ ["--tile-color" as string]: STAGE_COLOR[stage] }}
                onClick={() => setScreen({ level: "deals", stage })}
              >
                <span className={styles.tileTop}>
                  <span className={styles.tileGlyph} aria-hidden="true">
                    {stage
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 3)
                      .toUpperCase()}
                  </span>
                  {count != null && (
                    <span className={styles.tileBadge}>
                      {count} deal{count === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
                <span className={styles.tileCaption}>
                  <span className={styles.tileName}>{stage}</span>
                  <span className={styles.tileSub}>
                    {count == null ? "…" : `${count} deal${count === 1 ? "" : "s"}`}
                  </span>
                </span>
              </button>
            );
          })}
          {dealsError && <p className={styles.error}>{dealsError}</p>}
        </div>
      )}

      {screen.level === "deals" && (
        <StageDeals
          stage={screen.stage}
          deals={activeDeals.filter((d) => d.stage === screen.stage)}
          loading={loadingDeals}
          error={dealsError}
          onOpenDeal={(id) => router.push(`/sales-board?deal=${id}`)}
        />
      )}
    </div>
  );
}

function StageDeals({
  stage,
  deals,
  loading,
  error,
  onOpenDeal,
}: {
  stage: Stage;
  deals: Deal[];
  loading: boolean;
  error: string | null;
  onOpenDeal: (id: number) => void;
}) {
  if (loading) return <p className={styles.empty}>Loading deals…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (deals.length === 0) return <p className={styles.empty}>No deals in {stage}.</p>;

  const sorted = [...deals].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div className={styles.grid}>
      {sorted.map((d) => {
        const contact = contactName(d);
        const sub = contact || d.property?.address || "";
        return (
          <button
            key={d.id}
            type="button"
            className={styles.tile}
            style={{ ["--tile-color" as string]: STAGE_COLOR[stage] }}
            onClick={() => onOpenDeal(d.id)}
          >
            <span className={styles.tileTop}>
              <span className={styles.tileGlyph} aria-hidden="true">
                {monogram(d.deal_name)}
              </span>
              {d.flagged && (
                <span className={styles.tileFlag} title="Loose end">
                  🚩
                </span>
              )}
              {!!d.value && <span className={styles.tileBadge}>{currency.format(d.value)}</span>}
            </span>
            <span className={styles.tileCaption}>
              <span className={styles.tileName}>{d.deal_name}</span>
              {sub && <span className={styles.tileSub}>{sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
