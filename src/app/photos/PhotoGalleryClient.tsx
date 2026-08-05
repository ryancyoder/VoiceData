"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./photos.module.css";
import { dealPhotoUrl, type Deal } from "@/lib/salesBoard";

type GalleryDeal = Pick<Deal, "id" | "deal_name" | "company" | "stage" | "lost_at" | "photos">;
type GalleryPhoto = GalleryDeal["photos"][number];

export default function PhotoGalleryClient({ deals: initialDeals }: { deals: GalleryDeal[] }) {
  const searchParams = useSearchParams();
  const [deals, setDeals] = useState<GalleryDeal[]>(initialDeals);
  const [activeDealId, setActiveDealId] = useState<number | null>(() => {
    const raw = searchParams.get("deal");
    const id = raw ? Number(raw) : NaN;
    if (!Number.isFinite(id)) return null;
    return initialDeals.some((d) => d.id === id && d.photos.length > 0) ? id : null;
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const dealsWithPhotos = useMemo(() => deals.filter((d) => d.photos.length > 0), [deals]);
  const totalPhotoCount = useMemo(() => dealsWithPhotos.reduce((n, d) => n + d.photos.length, 0), [dealsWithPhotos]);

  const activeDeal = activeDealId != null ? dealsWithPhotos.find((d) => d.id === activeDealId) ?? null : null;
  const activePhotos = activeDeal?.photos ?? [];
  const activePhoto: GalleryPhoto | null = activeIndex != null ? activePhotos[activeIndex] ?? null : null;

  useEffect(() => {
    if (activeIndex == null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveIndex(null);
      else if (e.key === "ArrowLeft") setActiveIndex((i) => (i != null ? Math.max(0, i - 1) : i));
      else if (e.key === "ArrowRight") setActiveIndex((i) => (i != null ? Math.min(activePhotos.length - 1, i + 1) : i));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, activePhotos.length]);

  function openAlbum(dealId: number) {
    setActiveDealId(dealId);
    setActiveIndex(null);
  }

  function backToAlbums() {
    setActiveDealId(null);
    setActiveIndex(null);
  }

  async function handleDelete(deal: GalleryDeal, photo: GalleryPhoto) {
    setDeletingId(photo.id);
    try {
      const res = await fetch(`/api/sales-board/${deal.id}/photos/${photo.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete photo");
      setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, photos: d.photos.filter((p) => p.id !== photo.id) } : d)));
      if (activePhoto?.id === photo.id) setActiveIndex(null);
      if (deal.photos.length <= 1) {
        setActiveDealId(null);
        setActiveIndex(null);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete photo");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Photo Gallery</h1>
          <p>
            {activeDeal ? (
              <>
                <button type="button" className={styles["back-link"]} onClick={backToAlbums}>
                  ‹ All albums
                </button>{" "}
                · {activeDeal.deal_name}
              </>
            ) : (
              <>
                {dealsWithPhotos.length} album{dealsWithPhotos.length === 1 ? "" : "s"} · {totalPhotoCount} photo
                {totalPhotoCount === 1 ? "" : "s"}
              </>
            )}{" "}
            ·{" "}
            <Link href="/sales-board" className={styles["brand-back"]}>
              ← Sales Board
            </Link>
          </p>
        </div>
      </div>

      <div className={styles.content}>
        {dealsWithPhotos.length === 0 ? (
          <div className={styles.empty}>
            No photos have been uploaded yet. Add photos from a deal&apos;s detail view on the Sales Board.
          </div>
        ) : !activeDeal ? (
          <div className={styles.grid}>
            {dealsWithPhotos.map((deal) => {
              const cover = deal.photos[0];
              return (
                <button key={deal.id} type="button" className={styles.album} onClick={() => openAlbum(deal.id)}>
                  <span className={styles["thumb-image-wrap"]}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={dealPhotoUrl(cover.storage_path)} alt={cover.caption ?? deal.deal_name} loading="lazy" />
                    <span className={styles["album-badge"]}>
                      {deal.photos.length} photo{deal.photos.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className={styles["thumb-caption"]}>
                    <span className={styles["thumb-caption-name"]}>{deal.deal_name}</span>
                    <span className={styles["thumb-caption-stage"]}>{deal.stage}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.grid}>
            {activePhotos.map((photo, i) => (
              <div key={photo.id} className={styles.thumb}>
                <button type="button" className={styles["thumb-open"]} onClick={() => setActiveIndex(i)}>
                  <span className={styles["thumb-image-wrap"]}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={dealPhotoUrl(photo.storage_path)} alt={photo.caption ?? activeDeal.deal_name} loading="lazy" />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles["thumb-delete"]}
                  aria-label="Delete photo"
                  disabled={deletingId === photo.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(activeDeal, photo);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeDeal && activePhoto && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveIndex(null);
          }}
        >
          <div className={styles["lightbox-panel"]}>
            <div className={styles["lightbox-image-wrap"]}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dealPhotoUrl(activePhoto.storage_path)} alt={activePhoto.caption ?? activeDeal.deal_name} />
            </div>
            <div className={styles["lightbox-head"]}>
              <div className={styles["lightbox-head-main"]}>
                <div className={styles["lightbox-title"]}>{activeDeal.deal_name}</div>
                <div className={styles["lightbox-meta"]}>
                  {[activeDeal.company, activeDeal.stage].filter(Boolean).join(" · ")}
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
                  disabled={activeIndex === activePhotos.length - 1}
                  onClick={() => setActiveIndex((i) => (i != null ? Math.min(activePhotos.length - 1, i + 1) : i))}
                >
                  Next ›
                </button>
                <button
                  type="button"
                  className={styles["lightbox-delete"]}
                  disabled={deletingId === activePhoto.id}
                  onClick={() => handleDelete(activeDeal, activePhoto)}
                >
                  {deletingId === activePhoto.id ? "Deleting…" : "Delete"}
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
