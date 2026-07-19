import { useState, useEffect } from 'react';

export default function LiveCountdown({ rawDate, duration, isUpcoming, ts, className }) {
  const [timeLeft, setTimeLeft] = useState('...');

  useEffect(() => {
    if (!rawDate || !ts) return;

    const startTimeMs = new Date(rawDate).getTime();
    const endTimeMs = isUpcoming ? startTimeMs : startTimeMs + (parseInt(duration) || 0) * 60000;

    const updateTimer = () => {
      const now = ts.now();
      const diff = endTimeMs - now;

      if (diff <= 0) {
        setTimeLeft(isUpcoming ? 'Starting Soon...' : 'Exam Ended');
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 60000) % 60);
        const s = Math.floor((diff / 1000) % 60);

        if (days > 0) setTimeLeft(`${days}d ${hours}h ${m}m`);
        else if (hours > 0) setTimeLeft(`${hours}h ${m}m ${s}s`);
        else setTimeLeft(`${m}m ${s < 10 ? '0' : ''}${s}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [rawDate, duration, isUpcoming, ts]);

  return <span className={className || 'font-mono'}>{timeLeft}</span>;
}
