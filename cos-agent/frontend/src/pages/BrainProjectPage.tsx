import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type BrainEntry,
  type BrainEntryType,
  type BrainMemberRole,
  type BrainProjectMember,
  useAddEntry,
  useBrainConflicts,
  useBrainEntries,
  useBrainMembers,
  useBrainProject,
  useDeleteEntry,
  useInviteMember,
  useRemoveMember,
  useResolveConflict,
  useUpdateEntry,
  useUpdateMemberRole,
  useUpdateProject,
  useDeleteProject,
} from "../hooks/useBrain.ts";
import { useNavigate } from "react-router-dom";

const ENTRY_TYPE_LABELS: Record<BrainEntryType, string> = {
  fact: "Fakt",
  decision: "Entscheidung",
  preference: "Präferenz",
  context: "Kontext",
  process: "Prozess",
};

const ROLE_LABELS: Record<BrainMemberRole, string> = {
  owner: "Owner",
  knowledge_owner: "Knowledge Owner",
  member: "Mitglied",
};

const ENTRY_TYPE_COLORS: Record<BrainEntryType, string> = {
  fact: "#0ea5e9",
  decision: "#f59e0b",
  preference: "#8b5cf6",
  context: "#10b981",
  process: "#6366f1",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function EntryForm({
  projectId,
  initial,
  onDone,
}: {
  projectId: string;
  initial?: BrainEntry;
  onDone: () => void;
}) {
  const addMut = useAddEntry(projectId);
  const updateMut = useUpdateEntry();
  const [type, setType] = useState<BrainEntryType>(initial?.type ?? "fact");
  const [content, setContent] = useState(initial?.content ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [error, setError] = useState("");

  const isEdit = !!initial;
  const isPending = addMut.isPending || updateMut.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setError("");
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (isEdit) {
        await updateMut.mutateAsync({
          entryId: initial.id,
          projectId,
          data: { content: content.trim(), type, tags: parsedTags },
        });
      } else {
        await addMut.mutateAsync({
          type,
          content: content.trim(),
          source: source.trim() || undefined,
          tags: parsedTags.length ? parsedTags : undefined,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{
        padding: "1rem",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.65rem", marginBottom: "0.65rem", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto" }}>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>
            Typ
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as BrainEntryType)}
            style={{
              padding: "0.4rem 0.6rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: "0.88rem",
            }}
          >
            {(Object.keys(ENTRY_TYPE_LABELS) as BrainEntryType[]).map((t) => (
              <option key={t} value={t}>
                {ENTRY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>
            Quelle
          </label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="z.B. manuell, Hans Meier"
            style={{
              width: "100%",
              padding: "0.4rem 0.6rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>
            Tags (kommasepariert)
          </label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="z.B. linie-3, wartung"
            style={{
              width: "100%",
              padding: "0.4rem 0.6rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
      <div style={{ marginBottom: "0.65rem" }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>
          Inhalt *
        </label>
        <textarea
          autoFocus
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Beschreibe den Fakt, die Entscheidung, den Prozess…"
          style={{
            width: "100%",
            padding: "0.5rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
            resize: "vertical",
            lineHeight: 1.5,
            boxSizing: "border-box",
          }}
        />
      </div>
      {error && (
        <p style={{ color: "var(--danger)", fontSize: "0.82rem", margin: "0 0 0.5rem" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="submit"
          disabled={!content.trim() || isPending}
          className="co-btn co-btn--primary"
          style={{ padding: "0.4rem 0.9rem" }}
        >
          {isPending ? "Speichern…" : isEdit ? "Aktualisieren" : "Hinzufügen"}
        </button>
        <button
          type="button"
          onClick={onDone}
          style={{
            padding: "0.4rem 0.9rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            cursor: "pointer",
          }}
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function InviteMemberModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const inviteMut = useInviteMember(projectId);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<BrainMemberRole>("member");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setError("");
    try {
      await inviteMut.mutateAsync({ userId: userId.trim(), role });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          padding: "1.5rem",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700 }}>
          Person einladen
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
              User-ID *
            </label>
            <input
              autoFocus
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="UUID des Users"
              style={{
                width: "100%",
                padding: "0.5rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
              Rolle
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as BrainMemberRole)}
              style={{
                width: "100%",
                padding: "0.5rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              <option value="member">Mitglied — kann lesen</option>
              <option value="knowledge_owner">Knowledge Owner — kann lesen & schreiben</option>
              <option value="owner">Owner — volle Kontrolle</option>
            </select>
          </div>
          {error && (
            <p style={{ color: "var(--danger)", fontSize: "0.82rem", margin: "0 0 0.75rem" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "0.45rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!userId.trim() || inviteMut.isPending}
              className="co-btn co-btn--primary"
              style={{ padding: "0.45rem 1rem" }}
            >
              {inviteMut.isPending ? "Einladen…" : "Einladen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WissenTab({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const entriesQ = useBrainEntries(projectId);
  const conflictsQ = useBrainConflicts(projectId);
  const deleteMut = useDeleteEntry();
  const resolveMut = useResolveConflict(projectId);

  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<BrainEntry | null>(null);
  const [typeFilter, setTypeFilter] = useState<BrainEntryType | "">("");
  const [search, setSearch] = useState("");

  const openConflicts = (conflictsQ.data ?? []).filter((c) => !c.resolved);

  const entries = (entriesQ.data ?? []).filter((e) => {
    if (typeFilter && e.type !== typeFilter) return false;
    if (search && !e.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDelete(entry: BrainEntry) {
    if (!confirm("Eintrag wirklich löschen?")) return;
    await deleteMut.mutateAsync({ entryId: entry.id, projectId });
  }

  return (
    <div>
      {openConflicts.length > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            borderRadius: 8,
            marginBottom: "1rem",
            fontSize: "0.88rem",
          }}
        >
          <strong>
            ⚠ {openConflicts.length} offene{" "}
            {openConflicts.length === 1 ? "Konflikt" : "Konflikte"}
          </strong>
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {openConflicts.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                  {c.conflict_description ?? "Widerspruch erkannt"}
                </span>
                <button
                  type="button"
                  onClick={() => void resolveMut.mutateAsync({ conflictId: c.id, keepEntryId: c.entry_a_id })}
                  style={{
                    padding: "0.2rem 0.55rem",
                    fontSize: "0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    background: "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  Eintrag A behalten
                </button>
                <button
                  type="button"
                  onClick={() => void resolveMut.mutateAsync({ conflictId: c.id, keepEntryId: c.entry_b_id })}
                  style={{
                    padding: "0.2rem 0.55rem",
                    fontSize: "0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    background: "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  Eintrag B behalten
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "0.65rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen…"
          style={{
            flex: 1,
            minWidth: 160,
            padding: "0.4rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as BrainEntryType | "")}
          style={{
            padding: "0.4rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        >
          <option value="">Alle Typen</option>
          {(Object.keys(ENTRY_TYPE_LABELS) as BrainEntryType[]).map((t) => (
            <option key={t} value={t}>
              {ENTRY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {canWrite && !showForm && !editingEntry && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="co-btn co-btn--primary"
            style={{ padding: "0.4rem 0.9rem", flexShrink: 0 }}
          >
            + Eintrag
          </button>
        )}
      </div>

      {(showForm && !editingEntry) && (
        <EntryForm
          projectId={projectId}
          onDone={() => setShowForm(false)}
        />
      )}

      {entriesQ.isPending ? (
        <p className="co-muted">Laden…</p>
      ) : entries.length === 0 ? (
        <div
          style={{
            padding: "2rem 1rem",
            textAlign: "center",
            color: "var(--muted)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {(entriesQ.data ?? []).length === 0
            ? "Noch keine Wissenseinträge. Füge den ersten hinzu."
            : "Keine Einträge für diesen Filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {entries.map((entry) => (
            <div key={entry.id}>
              {editingEntry?.id === entry.id ? (
                <EntryForm
                  projectId={projectId}
                  initial={entry}
                  onDone={() => setEditingEntry(null)}
                />
              ) : (
                <div
                  style={{
                    padding: "0.85rem 1rem",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface)",
                    borderLeft: `4px solid ${ENTRY_TYPE_COLORS[entry.type]}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      marginBottom: "0.45rem",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          color: ENTRY_TYPE_COLORS[entry.type],
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {ENTRY_TYPE_LABELS[entry.type]}
                      </span>
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.1rem 0.4rem",
                            borderRadius: 4,
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            color: "var(--muted)",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {canWrite && (
                      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setEditingEntry(entry)}
                          style={{
                            padding: "0.2rem 0.45rem",
                            fontSize: "0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            background: "var(--surface)",
                            cursor: "pointer",
                          }}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          style={{
                            padding: "0.2rem 0.45rem",
                            fontSize: "0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            background: "var(--surface)",
                            color: "var(--danger)",
                            cursor: "pointer",
                          }}
                        >
                          Löschen
                        </button>
                      </div>
                    )}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.9rem",
                      color: "var(--text)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {entry.content}
                  </p>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                      display: "flex",
                      gap: "0.75rem",
                    }}
                  >
                    <span>{formatDate(entry.created_at)}</span>
                    {entry.source && <span>Quelle: {entry.source}</span>}
                    {entry.creator_name && <span>von {entry.creator_name}</span>}
                    {entry.expires_at && (
                      <span
                        style={{
                          color:
                            new Date(entry.expires_at) < new Date()
                              ? "var(--danger)"
                              : "var(--muted)",
                        }}
                      >
                        läuft ab: {formatDate(entry.expires_at)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamTab({
  projectId,
  isOwner,
  currentUserId,
}: {
  projectId: string;
  isOwner: boolean;
  currentUserId: string;
}) {
  const membersQ = useBrainMembers(projectId);
  const updateRoleMut = useUpdateMemberRole(projectId);
  const removeMut = useRemoveMember(projectId);
  const [showInvite, setShowInvite] = useState(false);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<BrainMemberRole>("member");

  async function handleRoleChange(member: BrainProjectMember) {
    await updateRoleMut.mutateAsync({ userId: member.user_id, role: newRole });
    setChangingRoleFor(null);
  }

  async function handleRemove(member: BrainProjectMember) {
    if (!confirm(`${member.user_name ?? member.user_id} wirklich entfernen?`)) return;
    await removeMut.mutateAsync(member.user_id);
  }

  const members = membersQ.data ?? [];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
          {members.length} Mitglieder
        </p>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="co-btn co-btn--primary"
            style={{ padding: "0.4rem 0.9rem" }}
          >
            + Person einladen
          </button>
        )}
      </div>

      {membersQ.isPending ? (
        <p className="co-muted">Laden…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {members.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "0.75rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {m.user_name ?? m.user_id}
                </div>
                {m.user_email && (
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    {m.user_email}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {changingRoleFor === m.user_id ? (
                  <>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as BrainMemberRole)}
                      style={{
                        padding: "0.3rem 0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontSize: "0.82rem",
                      }}
                    >
                      <option value="member">Mitglied</option>
                      <option value="knowledge_owner">Knowledge Owner</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleRoleChange(m)}
                      disabled={updateRoleMut.isPending}
                      className="co-btn co-btn--primary"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setChangingRoleFor(null)}
                      style={{
                        padding: "0.3rem 0.6rem",
                        fontSize: "0.8rem",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        background: "var(--surface)",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="co-badge">{ROLE_LABELS[m.role]}</span>
                    {isOwner && m.user_id !== currentUserId && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setNewRole(m.role);
                            setChangingRoleFor(m.user_id);
                          }}
                          style={{
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            background: "var(--surface)",
                            cursor: "pointer",
                          }}
                        >
                          Rolle
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemove(m)}
                          style={{
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.75rem",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            background: "var(--surface)",
                            color: "var(--danger)",
                            cursor: "pointer",
                          }}
                        >
                          Entfernen
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showInvite && (
        <InviteMemberModal projectId={projectId} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

export function BrainProjectPage() {
  const { id } = useParams<{ id: string }>();
  const projectQ = useBrainProject(id!);
  const updateMut = useUpdateProject(id!);
  const deleteMut = useDeleteProject();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"wissen" | "team">("wissen");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  if (projectQ.isPending) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <p className="co-muted">Laden…</p>
      </div>
    );
  }
  if (projectQ.error || !projectQ.data) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--danger)" }}>Projekt nicht gefunden.</p>
        <Link to="/brain" style={{ color: "var(--link)" }}>
          ← Zurück
        </Link>
      </div>
    );
  }

  const project = projectQ.data;
  const myRole = project.member_role;
  const isOwner = myRole === "owner";
  const canWrite = myRole === "owner" || myRole === "knowledge_owner";

  async function handleDeleteProject() {
    if (!confirm(`Projekt "${project.name}" wirklich löschen? Alle Einträge werden gelöscht.`))
      return;
    await deleteMut.mutateAsync(project.id);
    navigate("/brain");
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await updateMut.mutateAsync({ name: newName.trim() });
    setEditingName(false);
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.5rem 1rem",
    border: "none",
    borderBottom: active ? `2px solid ${project.color}` : "2px solid transparent",
    background: "transparent",
    fontWeight: active ? 700 : 500,
    color: active ? "var(--ink)" : "var(--muted)",
    cursor: "pointer",
    fontSize: "0.92rem",
  });

  return (
    <div style={{ padding: "1.5rem 0" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        <Link
          to="/brain"
          style={{ color: "var(--muted)", fontSize: "0.85rem", textDecoration: "none" }}
        >
          ← Brain & Projekte
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: project.color,
              flexShrink: 0,
            }}
          />
          {editingName ? (
            <form
              onSubmit={(e) => void handleRenameSubmit(e)}
              style={{ display: "flex", gap: "0.5rem" }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  padding: "0.35rem 0.6rem",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: "1.2rem",
                  fontWeight: 700,
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
              <button
                type="submit"
                disabled={updateMut.isPending}
                className="co-btn co-btn--primary"
                style={{ padding: "0.35rem 0.75rem" }}
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                style={{
                  padding: "0.35rem 0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface)",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </form>
          ) : (
            <h1
              className="co-font-display"
              style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700 }}
            >
              {project.name}
            </h1>
          )}
          {myRole && (
            <span className="co-badge" style={{ flexShrink: 0 }}>
              {myRole === "owner"
                ? "Owner"
                : myRole === "knowledge_owner"
                ? "Knowledge Owner"
                : "Mitglied"}
            </span>
          )}
        </div>
        {isOwner && !editingName && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => {
                setNewName(project.name);
                setEditingName(true);
              }}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.82rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              Umbenennen
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteProject()}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.82rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--danger)",
                cursor: "pointer",
              }}
            >
              Projekt löschen
            </button>
          </div>
        )}
      </div>

      {project.description && (
        <p
          style={{
            margin: "0 0 1.25rem",
            color: "var(--muted)",
            fontSize: "0.9rem",
          }}
        >
          {project.description}
        </p>
      )}

      <div
        style={{
          borderBottom: "1px solid var(--border)",
          marginBottom: "1.25rem",
          display: "flex",
          gap: "0",
        }}
      >
        <button
          type="button"
          onClick={() => setTab("wissen")}
          style={tabStyle(tab === "wissen")}
        >
          Wissen
        </button>
        <button
          type="button"
          onClick={() => setTab("team")}
          style={tabStyle(tab === "team")}
        >
          Team
        </button>
      </div>

      {tab === "wissen" ? (
        <WissenTab projectId={id!} canWrite={canWrite} />
      ) : (
        <TeamTab
          projectId={id!}
          isOwner={isOwner}
          currentUserId=""
        />
      )}
    </div>
  );
}
