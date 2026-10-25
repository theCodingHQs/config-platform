import { useEffect, useState, type RefObject } from "react";

/** The zoom at which a width × height drawing fits inside the element (less its padding), kept up to date as it resizes */
export function useFitZoom(ref: RefObject<HTMLElement | null>, width: number, height: number): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const h = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (w > 0 && h > 0) setZoom(Math.max(0.1, Math.min(w / width, h / height)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, width, height]);
  return zoom;
}
