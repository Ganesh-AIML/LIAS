import { useState, useEffect } from 'react';
// Module-level singleton — shared across all components that call useTrueTime().
// The sync fires exactly once per page load, not once per component mount.
let _syncPromise = null;
let _offset = 0;
let _isSynced = false;

function getSyncPromise() {
  if (_syncPromise) return _syncPromise;

  _syncPromise = fetch(`${import.meta.env.VITE_API_URL}/auth/health-check`)
    .then(res => res.json())
    .then(data => {
      // NTP-style: offset = serverTime - midpoint of round trip
      const now = Date.now();
      const serverTime = data.server_time || now;
      _offset = serverTime - now;
      _isSynced = true;
    })
    .catch(() => {
      // Server unreachable — proceed on local clock
      console.warn('Time sync failed, using local clock.');
      _isSynced = true;
    });

  return _syncPromise;
}

export function useTrueTime() {
  const [isSynced, setIsSynced] = useState(_isSynced);

  useEffect(() => {
    if (_isSynced) return; // already synced — no network call needed
    getSyncPromise().then(() => setIsSynced(true));
  }, []);

  return {
    isSynced,
    ts: { now: () => Date.now() + _offset },
  };
}