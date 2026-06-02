export default function StatusBadge({ status }) {
  const styles = {
    live:      'bg-red-50 text-red-700 border-red-200 animate-pulse',
    upcoming:  'bg-indigo-50 text-indigo-700 border-indigo-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    draft:     'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
}