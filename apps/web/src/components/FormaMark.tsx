/** Wordmark glyph: a ring with a lock arc and an ink core — the smallest possible "position". */
export function FormaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="#0e1a2b" strokeOpacity=".18" strokeWidth="4" />
      <circle
        cx="16"
        cy="16"
        r="12"
        fill="none"
        stroke="#b8f229"
        strokeWidth="4"
        pathLength={100}
        strokeDasharray="68 100"
        transform="rotate(-90 16 16)"
      />
      <circle cx="16" cy="16" r="7" fill="#0e1a2b" />
    </svg>
  );
}
