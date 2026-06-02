export default function Field({ label, ...props }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5">{label}</label>
      <input
        className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:border-cyan-500 outline-none bg-slate-50"
        {...props}
      />
    </div>
  );
}