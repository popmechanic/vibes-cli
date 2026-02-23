import React from "react";

interface DesignIconProps {
  bgFill?: string;
  fill?: string;
  width?: number;
  height?: number;
}

export function DesignIcon({
  bgFill = "#fff",
  fill = "#2a2a2a",
  width = 44,
  height = 44,
}: DesignIconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="22" cy="22" r="22" fill={bgFill} />
      {/* Paint palette / design icon */}
      <path
        d="M22 10C15.373 10 10 15.373 10 22C10 28.627 15.373 34 22 34C23.105 34 24 33.105 24 32C24 31.51 23.82 31.07 23.52 30.73C23.23 30.39 23.05 29.95 23.05 29.5C23.05 28.395 23.945 27.5 25.05 27.5H27.5C31.09 27.5 34 24.59 34 21C34 14.925 28.627 10 22 10ZM14.5 22C13.672 22 13 21.328 13 20.5C13 19.672 13.672 19 14.5 19C15.328 19 16 19.672 16 20.5C16 21.328 15.328 22 14.5 22ZM17.5 17C16.672 17 16 16.328 16 15.5C16 14.672 16.672 14 17.5 14C18.328 14 19 14.672 19 15.5C19 16.328 18.328 17 17.5 17ZM26.5 17C25.672 17 25 16.328 25 15.5C25 14.672 25.672 14 26.5 14C27.328 14 28 14.672 28 15.5C28 16.328 27.328 17 26.5 17ZM30.5 22C29.672 22 29 21.328 29 20.5C29 19.672 29.672 19 30.5 19C31.328 19 32 19.672 32 20.5C32 21.328 31.328 22 30.5 22Z"
        fill={fill}
      />
    </svg>
  );
}
