// Placeholder mark in the "Concept A — Gradient E" direction (navy circle, gradient arc + dot).
// Replace with the final clean vector when the hybrid logo is chosen.
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Super Business Assistant">
      <defs>
        <linearGradient id="sba-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFC42E" />
          <stop offset="0.5" stopColor="#F08A2B" />
          <stop offset="1" stopColor="#8E2D8E" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="#12172B" stroke="#ffffff" strokeOpacity="0.15" />
      <path d="M10 30 A15 15 0 0 1 38 22" fill="none" stroke="url(#sba-arc)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="38" cy="22" r="3" fill="#F08A2B" />
      <text x="24" y="31" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="13" fill="#fff">
        SBA
      </text>
    </svg>
  );
}
