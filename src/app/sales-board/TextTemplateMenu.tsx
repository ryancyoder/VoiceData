"use client";

import { useState } from "react";
import styles from "./sales-board.module.css";

interface Template {
  id: number;
  name: string;
  body: string;
}

interface Tokens {
  first_name: string;
  last_name: string;
  proposal_number: string;
  proposal_description: string;
}

// Fills a template body's tokens with this deal's values (missing values
// become an empty string).
function fillTokens(body: string, tokens: Tokens): string {
  return body
    .replace(/\{first_name\}/gi, tokens.first_name)
    .replace(/\{last_name\}/gi, tokens.last_name)
    .replace(/\{proposal_number\}/gi, tokens.proposal_number)
    .replace(/\{proposal_description\}/gi, tokens.proposal_description);
}

export default function TextTemplateMenu({
  phone,
  tokens,
  onSend,
}: {
  phone: string;
  tokens: Tokens;
  // Called when a template is chosen (so the deal can log a text touchpoint).
  onSend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  // null while adding a new template; the template's id while editing one.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cleanPhone = phone.replace(/[^\d+]/g, "");

  function smsHref(body: string) {
    return `sms:${cleanPhone}?&body=${encodeURIComponent(fillTokens(body, tokens))}`;
  }

  async function openMenu() {
    setOpen(true);
    if (templates === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch("/api/sms-templates");
        const data = await res.json();
        setTemplates(res.ok ? data.templates ?? [] : []);
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    }
  }

  function close() {
    setOpen(false);
    setAdding(false);
    setEditingId(null);
    setError("");
  }

  function startAdd() {
    setEditingId(null);
    setNewName("");
    setNewBody("");
    setError("");
    setAdding(true);
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setNewName(t.name);
    setNewBody(t.body);
    setError("");
    setAdding(true);
  }

  async function saveTemplate() {
    const name = newName.trim();
    const body = newBody.trim();
    if (!name || !body) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(editingId ? `/api/sms-templates/${editingId}` : "/api/sms-templates", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save template");
      setTemplates((ts) =>
        editingId
          ? (ts ?? []).map((t) => (t.id === editingId ? data.template : t))
          : [...(ts ?? []), data.template]
      );
      setNewName("");
      setNewBody("");
      setAdding(false);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: number) {
    setTemplates((ts) => (ts ?? []).filter((t) => t.id !== id));
    try {
      await fetch(`/api/sms-templates/${id}`, { method: "DELETE" });
    } catch {
      /* best-effort; list already updated optimistically */
    }
  }

  return (
    <div className={styles["text-menu"]}>
      <button type="button" className={styles["open-link-btn"]} onClick={() => (open ? close() : openMenu())}>
        💬 Text ▾
      </button>
      {open && (
        <>
          <div className={styles["text-menu-backdrop"]} onClick={close} />
          <div className={styles["text-menu-panel"]}>
            {loading && <div className={styles["text-menu-empty"]}>Loading…</div>}
            {!loading && templates && templates.length === 0 && (
              <div className={styles["text-menu-empty"]}>No templates yet</div>
            )}
            {!loading &&
              templates?.map((t) => (
                <div key={t.id} className={styles["text-menu-row"]}>
                  <a
                    className={styles["text-menu-item"]}
                    href={smsHref(t.body)}
                    onClick={() => {
                      onSend();
                      close();
                    }}
                  >
                    {t.name}
                  </a>
                  <button
                    type="button"
                    className={styles["text-menu-edit"]}
                    aria-label={`Edit ${t.name} template`}
                    onClick={() => startEdit(t)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={styles["text-menu-del"]}
                    aria-label={`Delete ${t.name} template`}
                    onClick={() => deleteTemplate(t.id)}
                  >
                    ×
                  </button>
                </div>
              ))}

            {adding ? (
              <div className={styles["text-menu-form"]}>
                <input
                  autoFocus
                  placeholder="Template name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <textarea
                  rows={3}
                  placeholder="Message… use {first_name}, {last_name}, {proposal_number}, {proposal_description}"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                />
                {error && <div className={styles["card-edit-error"]}>{error}</div>}
                <div className={styles["text-menu-form-actions"]}>
                  <button
                    type="button"
                    className={styles["open-link-btn"]}
                    onClick={() => {
                      setAdding(false);
                      setEditingId(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles["aspire-parse-btn"]}
                    onClick={saveTemplate}
                    disabled={saving || !newName.trim() || !newBody.trim()}
                  >
                    {saving ? "Saving…" : editingId ? "Save changes" : "Save template"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles["text-menu-add"]} onClick={startAdd}>
                + Add template
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
