// The public website's canonical address for previews (search result snippets, example URLs). Fetched once per page load.
import { useEffect, useState } from 'react';
import { api } from './api.ts';

const FALLBACK = { url: 'https://afcdfoundation.com/', host: 'afcdfoundation.com' };
let cached: Promise<typeof FALLBACK> | null = null;
export function useSite() {
  const [s, setS] = useState(FALLBACK);
  useEffect(() => { cached ??= api<typeof FALLBACK>('/seo/site').catch(() => FALLBACK); let on = true; cached.then((x) => on && setS(x)); return () => { on = false; }; }, []);
  return s;
}
