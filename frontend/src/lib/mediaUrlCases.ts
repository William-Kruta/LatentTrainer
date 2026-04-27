export interface MediaUrlCase {
  pattern: string;
  baseUrls: string[];
}

export const MEDIA_URL_CASES_KEY = "media-url-cases";

export function loadMediaUrlCases(): MediaUrlCase[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MEDIA_URL_CASES_KEY) ?? "[]") as {
      pattern: string;
      baseUrls?: string[];
    }[];
    return raw.map((entry) => ({
      pattern: entry.pattern,
      baseUrls: entry.baseUrls ?? [],
    }));
  } catch {
    return [];
  }
}

export function saveMediaUrlCases(cases: MediaUrlCase[]) {
  localStorage.setItem(MEDIA_URL_CASES_KEY, JSON.stringify(cases));
}

export function applyMediaUrlCases(raw: string, cases: MediaUrlCase[] = loadMediaUrlCases()): string {
  for (const { pattern, baseUrls } of cases) {
    if (!pattern) continue;
    const hostMatch = baseUrls.length === 0 || baseUrls.some((baseUrl) => raw.includes(baseUrl));
    if (hostMatch && raw.includes(pattern)) {
      return raw.split(pattern)[0];
    }
  }
  return raw;
}
