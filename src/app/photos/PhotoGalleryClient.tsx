"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./photos.module.css";
import { dealPhotoUrl, type Deal } from "@/lib/salesBoard";

type GalleryDeal = Pick<Deal, "id" | "deal_name" | "company" | "stage" | "lost_at" | "photos">;

interface GalleryItem {
  deal: GalleryDeal;
  photo: GalleryDeal["photos"][number];
}

export default function PhotoGalleryClient({ deals: initialDeals }: { deals: GalleryDeal[] }) {
  const [deals, setDeals] = useState<GalleryDeal[]>(initialDeals);
  const [selectedDealId, setSelectedDealId] = useState<string>("all");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dealsWithPhotos = useMemo(() => deals.filter((d) => d.photos.length > 0), [deals]);

  const items = useMemo<GalleryItem[]>(() => {
    const source = selectedDealId === "all" ? dealsWithPhotos : dealsWithPhotos.filter((d) => String(d.id) === selectedDealId);
    return source.flatMap((deal) => deal.photos.map((photo) => ({ deal, photo })));
  }, [dealsWithPhotos, selectedDealId]);

  const activeItem = activeIndex != null ? items[activeIndex] ?? null : null;

  useEffect(() => {
    if (activeIndex == null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveIndex(null);
      else if (e.key === "ArrowLeft") setActiveIndex((i) => (i != null ? Math.max(0, i - 1) : i));
      else if (e.key === "ArrowRight") setActiveIndex((i) => (i != null ? Math.min(items.length - 1, i + 1) : i));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, items.length]);

  async function handleDelete(item: GalleryItem) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-board/${item.deal.id}/photos/${item.photo.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete photo");
      setDeals((ds) =>
        ds.map((d) => (d.id === item.deal.id ? { ...d, photos: d.photos.filter((p) => p.id !== item.photo.id) } : d))
      );
      setActiveIndex(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete photo");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Photo Gallery</h1>
          <p>
            {items.length} photo{items.length === 1 ? "" : "s"} ·{" "}
            <Link href="/sales-board" className={styles["brand-back"]}>
              ← Sales Board
            </Link>
          </p>
        </div>

        <div className={styles["filter-bar"]}>
          <select
            className={styles["filter-select"]}
            value={selectedDealId}
            onChange={(e) => {
              setSelectedDealId(e.target.value);
              setActiveIndex(null);
            }}
          >
            <option value="all">All deals ({dealsWithPhotos.reduce((n, d) => n + d.photos.length, 0)})</option>
            {dealsWithPhotos.map((deal) => (
              <option key={deal.id} value={String(deal.id)}>
                {deal.deal_name} ({deal.photos.length})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.content}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            {dealsWithPhotos.length === 0
              ? "No photos have been uploaded yet. Add photos from a deal's detail view on the Sales Board."
              : "No photos for this deal."}
          </div>
        ) : (
          <div className={styles.grid}>
            {items.map((item, i) => (
              <button
                key={item.photo.id}
                type="button"
                className={styles.thumb}
                onClick={() => setActiveIndex(i)}
              >
                <span className={styles["thumb-image-wrap"]}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dealPhotoUrl(item.photo.storage_path)} alt={item.photo.caption ?? item.deal.deal_name} loading="lazy" />
                </span>
                <span className={styles["thumb-caption"]}>
                  <span className={styles["thumb-caption-name"]}>{item.deal.deal_name}</span>
                  <span className={styles["thumb-caption-stage"]}>{item.deal.stage}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {activeItem && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveIndex(null);
          }}
        >
          <div className={styles["lightbox-panel"]}>
            <div className={styles["lightbox-image-wrap"]}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dealPhotoUrl(activeItem.photo.storage_path)} alt={activeItem.photo.caption ?? activeItem.deal.deal_name} />
            </div>
            <div className={styles["lightbox-head"]}>
              <div className={styles["lightbox-head-main"]}>
                <div className={styles["lightbox-title"]}>{activeItem.deal.deal_name}</div>
                <div className={styles["lightbox-meta"]}>
                  {[activeItem.deal.company, activeItem.deal.stage].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className={styles["lightbox-actions"]}>
                <button
                  type="button"
                  className={styles["lightbox-nav"]}
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex((i) => (i != null ? Math.max(0, i - 1) : i))}
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  className={styles["lightbox-nav"]}
                  disabled={activeIndex === items.length - 1}
                  onClick={() => setActiveIndex((i) => (i != null ? Math.min(items.length - 1, i + 1) : i))}
                >
                  Next ›
                </button>
                <button type="button" className={styles["lightbox-delete"]} disabled={deleting} onClick={() => handleDelete(activeItem)}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button type="button" className={styles["lightbox-close"]} aria-label="Close" onClick={() => setActiveIndex(null)}>
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
