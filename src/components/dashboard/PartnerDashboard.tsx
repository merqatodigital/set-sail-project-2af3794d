import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudOff,
  ExternalLink,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  RefreshCw,
  Unlock,
} from "lucide-react";

import { fetchProjects, subscribeOffline, verifyPasscode } from "@/lib/partnerDashboard/api";
import { AUTHORS, DEFAULT_AUTHOR } from "@/lib/partnerDashboard/config";
import {
  getAuthor,
  getLastSeenMap,
  getOpenThreads,
  getPasscode,
  markSeen,
  setAuthor as persistAuthor,
  setOpenThreads as persistOpenThreads,
  setPasscode as persistPasscode,
} from "@/lib/partnerDashboard/profile";
import type { BackendKind, ProjectRow } from "@/lib/partnerDashboard/types";
import { formatDateTime, formatUpdatedLine, toIsoMachine } from "./format";
import { StatusBadge } from "./StatusBadge";
import { Thread } from "./Thread";
import { Lightbox, type LightboxImage } from "./Lightbox";

export function PartnerDashboard() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [backend, setBackend] = useState<BackendKind | "none">("none");
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [author, setAuthor] = useState<string>(DEFAULT_AUTHOR);
  const [passcode, setPasscode] = useState("");
  const [passcodeDraft, setPasscodeDraft] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [openThreads, setOpenThreads] = useState<string[]>([]);
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  // Mirror of openThreads for event handlers, so toggling never reads a stale
  // closure and never performs side effects inside a state updater.
  const openThreadsRef = useRef<string[]>([]);

  // --- Boot: restore the local profile, passcode and UI state ---------------
  useEffect(() => {
    setAuthor(getAuthor());
    const restoredThreads = getOpenThreads();
    openThreadsRef.current = restoredThreads;
    setOpenThreads(restoredThreads);
    setLastSeen(getLastSeenMap());

    const stored = getPasscode();
    if (stored) {
      setPasscode(stored);
      void verifyPasscode(stored).then((result) => {
        if (!result.ok) {
          // The server rejected a previously-stored code (it changed there).
          setPasscode("");
          setPasscodeError("The saved passcode was rejected — enter it again to post.");
        }
      });
    }
  }, []);

  // Reflect the offline flag the data layer maintains.
  useEffect(() => subscribeOffline(setOffline), []);

  // Persist thread expansion (idempotent, so StrictMode double-runs are safe).
  useEffect(() => {
    persistOpenThreads(openThreads);
  }, [openThreads]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    const result = await fetchProjects();
    if (result.data) {
      setProjects(result.data);
      setError(null);
    } else if (result.error) {
      setError(result.error);
    }
    setBackend(result.backend);
    if (isRefresh) setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Derived --------------------------------------------------------------

  const lastUpdated = useMemo(() => {
    if (!projects?.length) return null;
    const timestamps = projects
      .map((project) => new Date(project.last_updated).getTime())
      .filter((value) => !Number.isNaN(value));
    if (!timestamps.length) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  }, [projects]);

  const backendLabel = useMemo(() => {
    if (offline) return "offline";
    if (backend === "supabase") return "Supabase";
    if (backend === "neon") return "Neon";
    return "local";
  }, [backend, offline]);

  const storageNote = useMemo(() => {
    if (offline) return "Comments are being saved in this browser until the server is reachable.";
    if (backend === "supabase") return "Comments are stored in Supabase.";
    if (backend === "neon") return "Comments are stored in Neon.";
    return "No database configured yet — comments save in this browser only.";
  }, [backend, offline]);

  /** Unread when the newest comment is newer than the last thread open. */
  const isUnread = useCallback(
    (project: ProjectRow) => {
      if (!project.last_comment_at) return false;
      const seen = lastSeen[project.id];
      if (!seen) return true;
      return new Date(project.last_comment_at) > new Date(seen);
    },
    [lastSeen],
  );

  // --- Actions --------------------------------------------------------------

  const toggleThread = useCallback((projectId: string) => {
    const currentlyOpen = openThreadsRef.current.includes(projectId);
    const next = currentlyOpen
      ? openThreadsRef.current.filter((id) => id !== projectId)
      : [...openThreadsRef.current, projectId];

    openThreadsRef.current = next;
    setOpenThreads(next);

    // Opening a thread counts as reading it, which clears the notify badge.
    if (!currentlyOpen) {
      const now = new Date().toISOString();
      markSeen(projectId, now);
      setLastSeen((map) => ({ ...map, [projectId]: now }));
    }
  }, []);

  const changeAuthor = (next: string) => {
    setAuthor(next);
    persistAuthor(next);
  };

  const submitPasscode = async () => {
    const candidate = passcodeDraft.trim();
    if (!candidate) return;
    setVerifying(true);
    setPasscodeError(null);
    const result = await verifyPasscode(candidate);
    setVerifying(false);
    if (result.ok) {
      setPasscode(candidate);
      persistPasscode(candidate);
      setPasscodeDraft("");
    } else {
      setPasscodeError(result.error ?? "That passcode was not accepted.");
    }
  };

  const registerCount = useCallback((projectId: string, count: number) => {
    setLiveCounts((current) =>
      current[projectId] === count ? current : { ...current, [projectId]: count },
    );
  }, []);

  const openImage = useCallback((images: LightboxImage[], index: number) => {
    setLightbox({ images, index });
  }, []);

  // --- Render ---------------------------------------------------------------

  return (
    <section
      id="home"
      aria-labelledby="partner-dashboard-title"
      className="relative w-full overflow-hidden bg-[#1B1812]"
    >
      {/* Same tonal wash as the site hero, so the dashboard still reads as
          Marina Terrace rather than a bolted-on admin page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#3B342B] via-[#26221C] to-[#1B1812]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-black/40 to-transparent"
      />

      <div className="relative mx-auto w-full max-w-[1400px] px-5 pb-14 pt-28 sm:px-6 sm:pb-16 sm:pt-32 lg:px-12 lg:pb-20 lg:pt-40">
        {/* ---- Heading block ------------------------------------------------ */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-[#D9BA80]">
              Partner Dashboard
            </p>

            <h1
              id="partner-dashboard-title"
              className="mt-4 font-serif text-4xl font-light leading-[1.08] text-[#F5EFE2] sm:text-5xl lg:text-6xl"
            >
              Hi James <span aria-hidden="true">👋</span>
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#F5EFE2]/70 sm:text-base">
              Here are your links, and what I&apos;m working on right now.
            </p>

            <p className="mt-2 text-xs text-[#F5EFE2]/50">
              Last updated:{" "}
              {lastUpdated ? (
                <time dateTime={toIsoMachine(lastUpdated)}>{formatUpdatedLine(lastUpdated)}</time>
              ) : (
                "—"
              )}
            </p>
          </div>

          {/* ---- Controls --------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-[#F5EFE2]/80 backdrop-blur-sm">
              <span className="text-[#F5EFE2]/50">Posting as</span>
              <select
                value={author}
                onChange={(event) => changeAuthor(event.target.value)}
                aria-label="Choose who you are posting as"
                className="rounded bg-transparent text-xs font-medium text-[#F5EFE2] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D9BA80]"
              >
                {AUTHORS.map((name) => (
                  <option key={name} value={name} className="text-[#26221C]">
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-medium text-[#F5EFE2]/80 backdrop-blur-sm transition hover:border-white/40 hover:bg-white/15 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D9BA80]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh
            </button>

            {passcode ? (
              <span
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2E7D4F]/40 bg-[#2E7D4F]/15 px-3 text-xs font-medium text-[#A9D8B8]"
                title="Writes are unlocked on this device"
              >
                <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                Unlocked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <label className="sr-only" htmlFor="dashboard-passcode">
                  Dashboard passcode
                </label>
                <input
                  id="dashboard-passcode"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={passcodeDraft}
                  onChange={(event) => setPasscodeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitPasscode();
                  }}
                  placeholder="Passcode to post"
                  className="h-8 w-40 rounded-full border border-white/15 bg-white/5 px-3 text-xs text-[#F5EFE2] outline-none backdrop-blur-sm placeholder:text-[#F5EFE2]/40 focus:border-[#D9BA80]"
                />
                <button
                  type="button"
                  onClick={() => void submitPasscode()}
                  disabled={verifying || !passcodeDraft.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#C6A15B] px-3 text-xs font-semibold text-[#221D14] transition hover:bg-[#D9BA80] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D9BA80]"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Unlock
                </button>
              </span>
            )}
          </div>
        </div>

        {passcodeError && (
          <p role="alert" className="mt-2 text-xs text-[#E8A79A]">
            {passcodeError}
          </p>
        )}

        {/* ---- Offline banner ---------------------------------------------- */}
        {offline && (
          <p
            role="status"
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#E8D2A8]/40 bg-[#FBF1DF]/10 px-3 py-1 text-xs text-[#EBD3A0]"
          >
            <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
            offline — changes saved locally
          </p>
        )}

        {error && !projects && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[#E8C4BF]/40 bg-[#7C2D22]/20 px-4 py-3 text-sm text-[#F0C7BF]"
          >
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-[#F5EFE2]/45">{storageNote}</p>

        {/* ---- Desktop table ------------------------------------------------ */}
        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-white/10 bg-[#FAF6EF] shadow-2xl md:block">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Marina Terrace partner projects with status, link, preview, last update and comment
              count.
            </caption>
            <thead>
              <tr className="border-b border-[#E7DFCF] bg-[#F3ECDD]">
                {["Project", "Status", "Link", "Preview", "Last updated"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B6255]"
                  >
                    {label}
                  </th>
                ))}
                <th
                  scope="col"
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-[#6B6255]"
                >
                  Replies
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Thread</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects === null
                ? Array.from({ length: 3 }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="border-b border-[#EFE7D8]">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-4 w-1/4 animate-pulse rounded bg-[#EFE7D8]" />
                          <div className="h-4 w-20 animate-pulse rounded bg-[#F3ECDD]" />
                          <div className="h-4 flex-1 animate-pulse rounded bg-[#F3ECDD]" />
                        </div>
                      </td>
                    </tr>
                  ))
                : projects.map((project) => {
                    const open = openThreads.includes(project.id);
                    const count = liveCounts[project.id] ?? project.comment_count;
                    const unread = isUnread(project);

                    return [
                      <tr
                        key={project.id}
                        className={`border-b border-[#EFE7D8] transition-colors ${
                          open ? "bg-[#FBF6EA]" : "hover:bg-[#FDFBF7]"
                        }`}
                      >
                        <th scope="row" className="px-4 py-3 text-sm font-medium text-[#26221C]">
                          <span className="flex items-center gap-2">
                            {project.name}
                            {unread && (
                              <span className="inline-flex items-center rounded-full bg-[#C6A15B] px-1.5 py-0.5 text-[10px] font-semibold text-[#221D14]">
                                New
                              </span>
                            )}
                          </span>
                        </th>
                        <td className="px-4 py-3">
                          <StatusBadge status={project.status} />
                        </td>
                        <td className="px-4 py-3">
                          {project.url ? (
                            <a
                              href={project.url}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex max-w-[14rem] items-center gap-1.5 text-xs font-medium text-[#8A6B32] underline decoration-[#C6A15B]/40 underline-offset-2 transition hover:decoration-[#C6A15B]"
                            >
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">
                                {project.url.replace(/^https?:\/\//, "")}
                              </span>
                            </a>
                          ) : (
                            <span className="text-xs text-[#9A9081]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <PreviewThumb project={project} onOpen={openImage} />
                        </td>
                        <td className="px-4 py-3">
                          <time
                            dateTime={toIsoMachine(project.last_updated)}
                            className="text-xs text-[#6B6255]"
                          >
                            {formatDateTime(project.last_updated)}
                          </time>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleThread(project.id)}
                            aria-expanded={open}
                            aria-controls={`thread-${project.id}`}
                            aria-label={`${count} comments on ${project.name} — open thread`}
                            className="inline-flex items-center gap-1 rounded-full border border-[#E2D9C8] bg-white px-2.5 py-1 text-xs font-medium text-[#5A5248] transition hover:border-[#C6A15B] hover:text-[#8A6B32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
                          >
                            <span aria-hidden="true">💬</span>
                            {count}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleThread(project.id)}
                            aria-expanded={open}
                            aria-controls={`thread-${project.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#E2D9C8] bg-white px-3 py-1.5 text-xs font-medium text-[#5A5248] transition hover:border-[#C6A15B] hover:text-[#8A6B32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
                          >
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                            {open ? "Close thread" : "Open thread"}
                          </button>
                        </td>
                      </tr>,

                      open ? (
                        <tr
                          key={`${project.id}-thread`}
                          className="border-b border-[#EFE7D8] bg-[#FDFBF7]"
                        >
                          <td colSpan={7} className="px-4 py-4" id={`thread-${project.id}`}>
                            <Thread
                              projectId={project.id}
                              author={author}
                              backendLabel={backendLabel}
                              onOpenImage={openImage}
                              onCountChange={(next) => registerCount(project.id, next)}
                            />
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
            </tbody>
          </table>
        </div>

        {/* ---- Mobile cards -------------------------------------------------- */}
        <ul className="mt-4 space-y-3 md:hidden">
          {projects === null
            ? Array.from({ length: 2 }).map((_, index) => (
                <li key={`skeleton-${index}`} className="rounded-2xl bg-[#FAF6EF] p-4">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-[#EFE7D8]" />
                  <div className="mt-3 h-3 w-24 animate-pulse rounded bg-[#F3ECDD]" />
                  <div className="mt-3 h-16 animate-pulse rounded bg-[#F3ECDD]" />
                </li>
              ))
            : projects.map((project) => {
                const open = openThreads.includes(project.id);
                const count = liveCounts[project.id] ?? project.comment_count;
                const unread = isUnread(project);

                return (
                  <li key={project.id} className="overflow-hidden rounded-2xl bg-[#FAF6EF] shadow-xl">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-medium text-[#26221C]">
                          {project.name}
                          {unread && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-[#C6A15B] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[#221D14]">
                              New
                            </span>
                          )}
                        </h3>
                        <StatusBadge status={project.status} compact />
                      </div>

                      <dl className="mt-3 space-y-2 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-[#8A8071]">Link</dt>
                          <dd className="min-w-0 text-right">
                            {project.url ? (
                              <a
                                href={project.url}
                                target="_blank"
                                rel="noopener"
                                className="inline-flex max-w-[13rem] items-center gap-1 font-medium text-[#8A6B32] underline decoration-[#C6A15B]/40 underline-offset-2"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">
                                  {project.url.replace(/^https?:\/\//, "")}
                                </span>
                              </a>
                            ) : (
                              <span className="text-[#9A9081]">—</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-[#8A8071]">Last updated</dt>
                          <dd>
                            <time
                              dateTime={toIsoMachine(project.last_updated)}
                              className="text-[#6B6255]"
                            >
                              {formatDateTime(project.last_updated)}
                            </time>
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-[#8A8071]">Preview</dt>
                          <dd>
                            <PreviewThumb project={project} onOpen={openImage} />
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleThread(project.id)}
                          aria-expanded={open}
                          aria-controls={`thread-m-${project.id}`}
                          aria-label={`${count} comments on ${project.name} — open thread`}
                          className="inline-flex items-center gap-1 rounded-full border border-[#E2D9C8] bg-white px-2.5 py-1 text-xs font-medium text-[#5A5248]"
                        >
                          <span aria-hidden="true">💬</span>
                          {count}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleThread(project.id)}
                          aria-expanded={open}
                          aria-controls={`thread-m-${project.id}`}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#E2D9C8] bg-white px-3 py-1.5 text-xs font-medium text-[#5A5248]"
                        >
                          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          {open ? "Close thread" : "Open thread"}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div
                        id={`thread-m-${project.id}`}
                        className="border-t border-[#EFE7D8] bg-[#FDFBF7] p-4"
                      >
                        <Thread
                          projectId={project.id}
                          author={author}
                          backendLabel={backendLabel}
                          onOpenImage={openImage}
                          onCountChange={(next) => registerCount(project.id, next)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
        </ul>

        {projects?.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-[#F5EFE2]/60">
            No projects in <code className="text-[#D9BA80]">content/updates.json</code> yet. Add a
            row and refresh.
          </p>
        )}
      </div>

      <Lightbox
        images={lightbox?.images ?? []}
        index={lightbox?.index ?? null}
        onClose={() => setLightbox(null)}
        onIndexChange={(index) =>
          setLightbox((current) => (current ? { ...current, index } : current))
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Fixed-size preview thumbnail. The fixed box means no layout shift when the
 * image loads, and lazy loading keeps offscreen thumbnails off the network.
 */
function PreviewThumb({
  project,
  onOpen,
}: {
  project: ProjectRow;
  onOpen: (images: LightboxImage[], index: number) => void;
}) {
  if (!project.image) {
    return (
      <span className="inline-flex h-10 w-16 items-center justify-center rounded-md border border-dashed border-[#E2D9C8] text-[#B8AE9C]">
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">No preview image for {project.name}</span>
      </span>
    );
  }

  const image = project.image;

  return (
    <button
      type="button"
      onClick={() =>
        onOpen([{ url: image, alt: `${project.name} preview`, caption: project.name }], 0)
      }
      className="block h-10 w-16 overflow-hidden rounded-md border border-[#E2D9C8] transition hover:border-[#C6A15B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
      aria-label={`Open larger preview of ${project.name}`}
    >
      <img
        src={image}
        alt={`${project.name} preview`}
        loading="lazy"
        decoding="async"
        width={64}
        height={40}
        className="h-full w-full object-cover"
      />
    </button>
  );
}
