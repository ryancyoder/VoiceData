import type { TableSchema } from "@/lib/db";

export default function SchemaPanel({ tables }: { tables: TableSchema[] }) {
  if (tables.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No tables yet. Try saying something like “Create a contacts table with
        name, phone, and email.”
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tables.map((table) => (
        <div
          key={table.name}
          className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {table.name}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {table.columns.map((col) => (
              <li
                key={col.name}
                className="flex justify-between font-mono text-xs text-zinc-600 dark:text-zinc-400"
              >
                <span>{col.name}</span>
                <span className="text-zinc-400 dark:text-zinc-600">{col.type}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
