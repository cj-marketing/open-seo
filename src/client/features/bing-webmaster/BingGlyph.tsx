/** Bing "b" brand mark in currentColor so it inherits muted nav/icon styling. */
export function BingGlyphMuted({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M5 0l4.1 1.44v14.43l5.78-3.34-2.98-1.4-1.88-4.49 9.94 3.49v5.02L9.1 20.32 5 22.7V0z"
      />
    </svg>
  );
}
