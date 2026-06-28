// Small, dependency-free formatting helpers shared across the dashboard UI.

export function relativeTime(ts: number | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 60_000) return `in ${Math.round(ahead / 1000)}s`;
    if (ahead < 3_600_000) return `in ${Math.round(ahead / 60_000)}m`;
    return `in ${Math.round(ahead / 3_600_000)}h`;
  }
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function initials(name: string | undefined, fallback: string): string {
  const source = (name && name.trim()) || fallback || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic accent hue from a string (for avatar gradients).
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

export function hostFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}
