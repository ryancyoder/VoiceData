import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders synthesized wiki markdown. The repo has no typography plugin (and
// Tailwind's preflight strips default element styles), so every element is
// explicitly styled here. Server component — no client JS needed.
const components: Components = {
  h1: (p) => <h1 className="mt-6 mb-3 text-xl font-semibold text-zinc-900 dark:text-zinc-50" {...p} />,
  h2: (p) => <h2 className="mt-6 mb-2 border-b border-zinc-200 pb-1 text-lg font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100" {...p} />,
  h3: (p) => <h3 className="mt-4 mb-2 text-base font-semibold text-zinc-800 dark:text-zinc-200" {...p} />,
  p: (p) => <p className="my-3 leading-7 text-zinc-700 dark:text-zinc-300" {...p} />,
  ul: (p) => <ul className="my-3 list-disc space-y-1 pl-6 text-zinc-700 dark:text-zinc-300" {...p} />,
  ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-6 text-zinc-700 dark:text-zinc-300" {...p} />,
  li: (p) => <li className="leading-7" {...p} />,
  a: ({ href, ...p }) => (
    <a
      href={href}
      className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500 dark:text-indigo-400"
      {...p}
    />
  ),
  strong: (p) => <strong className="font-semibold text-zinc-900 dark:text-zinc-100" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  blockquote: (p) => <blockquote className="my-3 border-l-2 border-zinc-300 pl-4 text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400" {...p} />,
  code: (p) => <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" {...p} />,
  pre: (p) => <pre className="my-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-sm text-zinc-100" {...p} />,
  hr: () => <hr className="my-6 border-zinc-200 dark:border-zinc-800" />,
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-left font-semibold dark:border-zinc-800 dark:bg-zinc-900" {...p} />,
  td: (p) => <td className="border border-zinc-200 px-2 py-1 dark:border-zinc-800" {...p} />,
};

export default function WikiMarkdown({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>;
}
