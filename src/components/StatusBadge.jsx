// StatusBadge — colored status tag
export default function StatusBadge({ status }) {
  const cls = status ? `status-tag status-${status}` : "status-tag status-none";
  return <span className={cls}>{status || "unrated"}</span>;
}
