import { useLayoutEffect, useRef } from 'react';

/** Ref that always holds the latest render value; safe to read from effects and event handlers. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
