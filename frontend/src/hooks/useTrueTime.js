// frontend/src/hooks/useTrueTime.js
import { useState, useEffect } from 'react';
import api from '../services/api';

export function useTrueTime() {
  const [isSynced, setIsSynced] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const syncTime = async () => {
      try {
        const clientSentTime = Date.now();
        // We will create this endpoint in the backend later
        const res = await api.get('/auth/health-check'); 
        const serverTime = res.data.server_time || Date.now();
        const clientReceiveTime = Date.now();
        
        const roundTrip = clientReceiveTime - clientSentTime;
        const estimatedServerTime = serverTime + (roundTrip / 2);
        
        setOffset(estimatedServerTime - clientReceiveTime);
        setIsSynced(true);
      } catch (error) {
        console.warn("Time sync failed, falling back to local system clock.");
        setIsSynced(true); // Fallback to allow exam to proceed
      }
    };
    
    syncTime();
  }, []);

  return {
    isSynced,
    ts: {
      now: () => Date.now() + offset
    }
  };
}