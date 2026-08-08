export default function EstimateHeader({ estimate, onUpdate }) {
  return (
    <div className="flex flex-wrap gap-4 items-end px-6 py-4 border-b border-gray-100 bg-gray-50/60">
      <div className="flex-1 min-w-36">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Client Name
        </label>
        <input
          type="text"
          placeholder="John Smith"
          value={estimate.clientName}
          onChange={e => onUpdate('clientName', e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5
                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                     placeholder:text-gray-300"
        />
      </div>
      <div className="flex-1 min-w-36">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Project Name
        </label>
        <input
          type="text"
          placeholder="Backyard Renovation"
          value={estimate.projectName}
          onChange={e => onUpdate('projectName', e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5
                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                     placeholder:text-gray-300"
        />
      </div>
      <div className="w-36">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Date
        </label>
        <input
          type="date"
          value={estimate.date}
          onChange={e => onUpdate('date', e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5
                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>
    </div>
  );
}
