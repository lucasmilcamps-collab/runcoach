import { create } from 'zustand';

type OfflineState = {
  /**
   * When the data currently on screen was stored, as an ISO timestamp — or
   * null when the last read came from the network.
   *
   * The service worker stamps `X-Mosa-Cached-At` on any response it serves from
   * its cache (see public/sw.js), and the API client reports it here. One flag
   * for the whole app is enough because the fallback is all-or-nothing: with a
   * network, no read is served from cache; without one, every cacheable read
   * is. Per-query staleness would be more state to keep honest for a
   * distinction that can't arise.
   */
  cachedAt: string | null;
  /** Called by the API client after every read. */
  report: (cachedAt: string | null) => void;
};

export const useOfflineStore = create<OfflineState>((set) => ({
  cachedAt: null,
  report: (cachedAt) =>
    // Writing the same value on every poll would re-render every subscriber for
    // nothing, and these reads are polled.
    set((state) => (state.cachedAt === cachedAt ? state : { cachedAt })),
}));
