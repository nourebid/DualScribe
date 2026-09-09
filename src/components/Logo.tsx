import React from 'react';

interface LogoProps {
  variant?: 'full' | 'compact' | 'icon';
  className?: string;
  dark?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  variant = 'full',
  className = '',
  dark = false,
}) => {
  const textColor = dark ? '#FFFFFF' : '#111111';
  const subtitleColor = dark ? '#A1A1AA' : '#333333';
  const bubbleFill = dark ? '#18181B' : '#FFFFFF';
  const bubbleStroke = dark ? '#FFFFFF' : '#111111';

  if (variant === 'icon') {
    return (
      <svg
        viewBox="0 0 100 90"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className || 'w-10 h-9'}
      >
        {/* Bubble 1 (Left: Latin 'A') */}
        <g>
          <path
            d="M24 16H34C42.837 16 50 23.163 50 32C50 40.837 42.837 48 34 48C32.1 48 30.27 47.65 28.6 47L18.8 53C17.97 53.5 16.96 52.78 17.2 51.85L19.2 43.6C13.43 41.28 9.7 35.65 9.7 32C9.7 23.163 16.863 16 25.7 16H24Z"
            fill={bubbleFill}
            stroke={bubbleStroke}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <text
            x="30"
            y="38"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif"
            fontSize="20"
            fontWeight="900"
            textAnchor="middle"
            fill={bubbleStroke}
          >
            A
          </text>
        </g>

        {/* Bubble 2 (Right: Arabic 'ع') */}
        <g>
          <path
            d="M58 32H68C76.837 32 84 39.163 84 48C84 56.837 76.837 64 68 64C66.1 64 64.27 63.65 62.6 63L52.8 69C51.97 69.5 50.96 68.78 51.2 67.85L53.2 59.6C47.43 57.28 43.7 51.65 43.7 48C43.7 39.163 50.863 32 59.7 32H58Z"
            fill={bubbleFill}
            stroke={bubbleStroke}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <text
            x="65"
            y="55"
            fontFamily="'Segoe UI', Tahoma, Arial, sans-serif"
            fontSize="22"
            fontWeight="bold"
            textAnchor="middle"
            fill={bubbleStroke}
          >
            ع
          </text>
        </g>
      </svg>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        <Logo variant="icon" className="w-8 h-7.5 shrink-0" dark={dark} />
        <span
          className="font-black text-xl tracking-tight text-neutral-900 leading-none"
          style={{ color: textColor }}
        >
          DUALSCRIBE
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <div className="relative flex items-center justify-center">
        <Logo variant="icon" className="w-16 h-14" dark={dark} />
      </div>
      <h1
        className="font-black text-3xl sm:text-4xl tracking-tight mt-1 text-center"
        style={{ color: textColor, letterSpacing: '-0.025em' }}
      >
        DUALSCRIBE
      </h1>
      <p
        className="text-xs sm:text-sm font-medium tracking-tight mt-0.5 text-center"
        style={{ color: subtitleColor }}
      >
        Instant, accurate bi-lingual notes
      </p>
    </div>
  );
};
