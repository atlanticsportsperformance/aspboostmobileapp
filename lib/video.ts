// Exercise demo video helpers — one source for the YouTube id regex that
// exercise-detail-view and block-overview used to each carry a copy of.

const YT_PATTERNS = [
  /youtube\.com\/watch\?(?:[^#]*&)?v=([^&\n?#]+)/,
  /youtu\.be\/([^&\n?#/]+)/,
  /youtube\.com\/shorts\/([^&\n?#/]+)/,
  /youtube\.com\/embed\/([^&\n?#/]+)/,
];

export function youTubeId(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;
  for (const pattern of YT_PATTERNS) {
    const match = u.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function videoThumb(url: string | null | undefined): string | null {
  const id = youTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

export function hasVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/\S+$/i.test(url.trim());
}
