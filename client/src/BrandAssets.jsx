import { useReducedMotion } from 'framer-motion'

export function BrandLogo({ className = '' }) {
  return <span className={`brand-logo ${className}`} aria-hidden="true" />
}

export function PointsLogo({ className = '' }) {
  return (
    <svg className={`points-logo ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9L12 2.75Z" />
      <circle cx="12" cy="8" r="1.45" />
      <circle cx="8.55" cy="14.25" r="1.45" />
      <circle cx="15.45" cy="14.25" r="1.45" />
      <path d="m11.3 9.25-1.75 3.05m2.9-3.05 1.75 3.05m-4.2 1.95h4" />
    </svg>
  )
}

export function ElectricDisplacementFilter() {
  const reduceMotion = useReducedMotion()

  return (
    <svg className="electric-filter-definitions" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="electric-border-displace"
          colorInterpolationFilters="sRGB"
          x="-24%"
          y="-70%"
          width="148%"
          height="240%"
        >
          <feTurbulence type="turbulence" baseFrequency="0.016 0.11" numOctaves="4" result="verticalNoiseA" seed="1" />
          <feOffset in="verticalNoiseA" dx="0" dy="0" result="verticalOffsetA">
            {!reduceMotion && <animate attributeName="dy" values="180; 0" dur="6s" repeatCount="indefinite" calcMode="linear" />}
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.016 0.11" numOctaves="4" result="verticalNoiseB" seed="1" />
          <feOffset in="verticalNoiseB" dx="0" dy="0" result="verticalOffsetB">
            {!reduceMotion && <animate attributeName="dy" values="0; -180" dur="6s" repeatCount="indefinite" calcMode="linear" />}
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.028 0.075" numOctaves="4" result="horizontalNoiseA" seed="2" />
          <feOffset in="horizontalNoiseA" dx="0" dy="0" result="horizontalOffsetA">
            {!reduceMotion && <animate attributeName="dx" values="320; 0" dur="6s" repeatCount="indefinite" calcMode="linear" />}
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.028 0.075" numOctaves="4" result="horizontalNoiseB" seed="2" />
          <feOffset in="horizontalNoiseB" dx="0" dy="0" result="horizontalOffsetB">
            {!reduceMotion && <animate attributeName="dx" values="0; -320" dur="6s" repeatCount="indefinite" calcMode="linear" />}
          </feOffset>

          <feComposite in="verticalOffsetA" in2="verticalOffsetB" result="verticalCurrent" />
          <feComposite in="horizontalOffsetA" in2="horizontalOffsetB" result="horizontalCurrent" />
          <feBlend in="verticalCurrent" in2="horizontalCurrent" mode="color-dodge" result="electricNoise" />
          <feDisplacementMap in="SourceGraphic" in2="electricNoise" scale="14" xChannelSelector="R" yChannelSelector="B" />
        </filter>
      </defs>
    </svg>
  )
}
