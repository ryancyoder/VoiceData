"use client";

import { useState } from "react";
import Link from "next/link";
import { STAGES, type Deal, type Stage } from "@/lib/salesBoard";

interface NewDealForm {
  deal_name: string;
  company: string;
  contact_first_name: string;
  contact_last_name: string;
  value: string;
}

const EMPTY_FORM: NewDealForm = {
  deal_name: "",
  company: "",
  contact_first_name: "",
  contact_last_name: "",
  value: "",
};

export default function SalesBoardClient({ initialDeals }: { initialDeals: Deal[] }) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewDealForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function handleAddDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.deal_name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sales-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_name: form.deal_name.trim(),
          company: form.company.trim() || null,
          contact_first_name: form.contact_first_name.trim() || null,
          contact_last_name: form.contact_last_name.trim() || null,
          value: form.value ? Number(form.value) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create deal");
      setDeals((d) => [...d, data.deal]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStageChange(id: number, stage: Stage) {
    const previous = deals;
    setDeals((d) => d.map((deal) => (deal.id === id ? { ...deal, stage } : deal)));
    try {
      const res = await fetch(`/api/sales-board/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update stage");
    } catch (err) {
      setDeals(previous);
      setError(err instanceof Error ? err.message : "Failed to update stage");
    }
  }

  async function handleDelete(id: number) {
    const previous = deals;
    setDeals((d) => d.filter((deal) => deal.id !== id));
    try {
      const res = await fetch(`/api/sales-board/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete deal");
    } catch (err) {
      setDeals(previous);
      setError(err instanceof Error ? err.message : "Failed to delete deal");
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Sales Board
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Deals moving through the pipeline.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          ← VoiceData
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6">
        <form
          onSubmit={handleAddDeal}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Deal name</label>
            <input
              value={form.deal_name}
              onChange={(e) => setForm((f) => ({ ...f, deal_name: e.target.value }))}
              placeholder="Acme HVAC install"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Company</label>
            <input
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Contact first name</label>
            <input
              value={form.contact_first_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_first_name: e.target.value }))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Contact last name</label>
            <input
              value={form.contact_last_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_last_name: e.target.value }))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Value ($)</label>
            <input
              type="number"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              className="w-32 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !form.deal_name.trim()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            Add deal
          </button>
        </form>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
              const stageDeals = deals.filter((d) => d.stage === stage && !d.lost_at);
              return (
                <div
                  key={stage}
                  className="flex w-64 flex-shrink-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <h2 className="flex items-center justify-between text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {stage}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {stageDeals.length}
                    </span>
                  </h2>
                  <div className="flex flex-col gap-2">
                    {stageDeals.map((deal) => (
                      <div
                        key={deal.id}
                        className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">
                          {deal.deal_name}
                        </div>
                        {(() => {
                          const contactName = [deal.contact_first_name, deal.contact_last_name]
                            .filter(Boolean)
                            .join(" ");
                          const metaParts = [deal.company, contactName].filter(Boolean);
                          return metaParts.length > 0 ? (
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              {metaParts.join(" · ")}
                            </div>
                          ) : null;
                        })()}
                        {(deal.proposal_number || deal.proposal_date) && (
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {[
                              deal.proposal_number ? `#${deal.proposal_number}` : null,
                              deal.proposal_date,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                        {deal.value != null && (
                          <div className="text-xs text-zinc-600 dark:text-zinc-300">
                            ${deal.value.toLocaleString()}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <select
                            value={deal.stage}
                            onChange={(e) =>
                              handleStageChange(deal.id, e.target.value as Stage)
                            }
                            className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-950"
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleDelete(deal.id)}
                            className="text-xs text-red-600 dark:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
          })}
        </div>
      </main>
    </div>
  );
}
