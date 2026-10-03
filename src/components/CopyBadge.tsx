/** A small label on a binder row or a trade line: a copy's condition ("LP") or language ("JA"). */
export function CopyBadge({ text, title }: { text: string; title?: string }) {
  return <span className="copy-badge" title={title}>{text}</span>
}
