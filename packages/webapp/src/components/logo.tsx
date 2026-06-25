export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 128 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Weysabi"
    >
      <path
        d="M4 24L12 8L20 24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8L20 24L28 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      <text x="36" y="22" fontFamily="inherit" fontSize="16" fontWeight="700" fill="currentColor">
        Weysabi
      </text>
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="W"
    >
      <path
        d="M4 24L12 8L20 24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8L20 24L28 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
    </svg>
  );
}
