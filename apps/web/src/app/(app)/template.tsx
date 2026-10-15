'use client';
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Page entrance: every navigation inside the app fades and rises in once. Opacity-only (no movement) under prefers-reduced-motion. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
