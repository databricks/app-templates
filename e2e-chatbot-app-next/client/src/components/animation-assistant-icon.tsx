import { motion, useAnimation } from 'framer-motion';
import { SparklesIcon } from 'lucide-react';
import { useEffect } from 'react';

type AnimatedAssistantIconProps = {
  /** Diameter of the inner SparklesIcon */
  size?: number;
  /** Run the pulse / rotate animation while true */
  isLoading?: boolean;
};

export const AnimatedAssistantIcon = ({
  size = 20,
  isLoading = false,
}: AnimatedAssistantIconProps) => {
  /* -----------------------------------------------------------------
   *  Gradient colours – we keep the original helper so the gradients
   *  stay exactly the same as before.
   * ----------------------------------------------------------------- */
  const { bottomGradient, solidGradient, topGradient } = getAiGradientStyle();

  /* -----------------------------------------------------------------
   *  Motion controls – we split the three animated layers in separate
   *  animation objects so each can have its own timing / easing.
   * ----------------------------------------------------------------- */
  const scaleControls = useAnimation(); // “pulse‑scale‑up”
  const rotateControls = useAnimation(); // “pulse‑rotate”

  useEffect(() => {
    if (isLoading) {
      // 1️⃣ Scale – grows from 0.9 → 1.1 and back (alternate)
      scaleControls.start({
        scale: [0.9, 1.1],
        transition: {
          repeat: Number.POSITIVE_INFINITY,
          repeatType: 'reverse',
          duration: 1,
          ease: 'easeInOut',
        },
      });

      // 3️⃣ Rotating gradient – full spin every 2 seconds (continuous)
      rotateControls.start({
        rotate: [0, 1800],
        transition: {
          repeat: Number.POSITIVE_INFINITY,
          duration: 2,
          ease: 'easeInOut',
        },
      });
    } else {
      // Stop all animations instantly – the circles stay at their “rest”
      scaleControls.stop();
      rotateControls.stop();

      /* ---------- SMOOTHLY RETURN TO RESTING STATE ------------- */
      scaleControls.start({
        scale: 1,
        transition: { duration: 0.5, ease: 'easeOut' },
      });
      rotateControls.start({
        rotate: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      });
    }
  }, [isLoading, scaleControls, rotateControls]);

  /* -----------------------------------------------------------------
   *  Component markup – three stacked <motion.div>s:
   *
   *   • outer   – pulsating scale & gradient rotation
   *   • middle  – solid gradient that also pulsates (scale down)
   *   • top     – static gradient that holds the SparklesIcon
   * ----------------------------------------------------------------- */
  return (
    <div
      className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background"
      style={{ position: 'relative' }}
    >
      {/* ---------- 1️⃣ OUTER GRADIENT (rotates + pulses) ---------- */}
      <motion.div
        animate={scaleControls}
        style={{
          position: 'absolute',
          inset: 0, // shorthand for top/right/bottom/left:0
          borderRadius: '50%',
        }}
      >
        <motion.div
          animate={rotateControls}
          style={{
            background: bottomGradient,
            width: '100%',
            height: '100%',
            borderRadius: '50%',
          }}
        />
      </motion.div>

      {/* ---------- 2️⃣ MIDDLE SOLID GRADIENT (pulses down) ---------- */}
      <motion.div
        animate={scaleControls}
        style={{
          background: solidGradient,
          position: 'absolute',
          inset: '2px',
          borderRadius: '100%',
        }}
      />

      {/* ---------- 3️⃣ TOP ICON (static) -------------------------- */}
      <div
        style={{
          background: topGradient,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          zIndex: 1,
        }}
      >
        <SparklesIcon size={size} />
      </div>
    </div>
  );
};

/**
 * Since we cannot use gradient colors for borders, we instead use composite background colors to achieve the same effect.
 *
 * Composite background colors are built from the top down, so the last one is also the one bottom one in the paint order.
 *
 * To achieve the design with gradient border colors, we use the following background colors:
 * [ON TOP] A transparent gradient color that is used as a background
 * [MIDDLE] A solid color that is used to back the next transparent background color
 * [BOTTOM] A gradient color that is used as a border
 *
 * We also make use of padding-box to create an "inset" effect controlled by the border-width.
 * This is what creates the illusion of a gradient border.
 */
export const getAiGradientStyle = () => {
  // Currently these are the same for both light and dark mode, but we may want to change this in the future.
  const branded = {
    ai: {
      /** For AI components, the top-left-oriented start color of gradient treatments. */
      gradientStart: '#4299E0',
      /** For AI components, the mid color of gradient treatments. */
      gradientMid: '#CA42E0',
      /** For AI components, the bottom-right-oriented end color of gradient treatments. */
      gradientEnd: '#FF5F46',
    },
  };

  const createGradient = (...colors: string[]) =>
    `linear-gradient(135deg, ${colors.join(', ')})`;

  const gradientColors = [
    branded.ai.gradientStart,
    branded.ai.gradientMid,
    branded.ai.gradientEnd,
  ];

  const topGradient = createGradient(
    ...gradientColors.map((color) => hexToRGBA(color, 0.08) ?? ''),
  );
  const solidGradient = createGradient(
    'var(--background)',
    'var(--background)',
  );
  const bottomGradient = createGradient(...gradientColors);

  return {
    topGradient,
    solidGradient,
    bottomGradient,
    styling: {
      border: '1px solid transparent',
      background: [
        `${topGradient} padding-box`,
        `${solidGradient} padding-box`,
        `${bottomGradient} border-box`,
      ].join(', '),
    },
  };
};

const hexToRGB = (hex: string): { r: number; g: number; b: number } | null => {
  try {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return {
      r: Number.parseInt(result[1], 16),
      g: Number.parseInt(result[2], 16),
      b: Number.parseInt(result[3], 16),
    };
  } catch {
    return null;
  }
};

/**
 * Converts a hex color to an RGBA string.
 * Useful if you need to add an alpha channel to a hex color.
 */
const hexToRGBA = (hex: string, alpha: number): string | null => {
  const rgb = hexToRGB(hex);
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  return null;
};
