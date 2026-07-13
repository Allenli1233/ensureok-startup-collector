/** 透明 2D Canvas 水波：只做视觉反馈，不接管指针事件；低动态偏好与触屏设备自动降级。 */
import { useEffect, useRef } from 'react';

interface Wave {
  x: number;
  y: number;
  born: number;
}

export function RippleField(): React.ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (reduce || coarse) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const waves: Wave[] = [];
    let frame = 0;
    let lastX = -100;
    let lastY = -100;
    let lastBorn = 0;
    let cssWidth = 1;
    let cssHeight = 1;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (now: number) => {
      context.clearRect(0, 0, cssWidth, cssHeight);
      for (let i = waves.length - 1; i >= 0; i -= 1) {
        const age = (now - waves[i].born) / 1050;
        if (age >= 1) {
          waves.splice(i, 1);
          continue;
        }
        const eased = 1 - (1 - age) ** 3;
        for (let ring = 0; ring < 3; ring += 1) {
          const radius = Math.max(0, eased * 88 - ring * 13);
          if (radius <= 0) continue;
          context.beginPath();
          context.arc(waves[i].x, waves[i].y, radius, 0, Math.PI * 2);
          context.strokeStyle = `rgba(255, 244, 232, ${Math.max(0, (1 - age) * (0.2 - ring * 0.045))})`;
          context.lineWidth = 1.25;
          context.stroke();
        }
      }
      frame = waves.length ? requestAnimationFrame(render) : 0;
    };

    const onMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = performance.now();
      if (Math.hypot(x - lastX, y - lastY) < 30 && now - lastBorn < 90) return;
      waves.push({ x, y, born: now });
      if (waves.length > 10) waves.shift();
      lastX = x;
      lastY = y;
      lastBorn = now;
      if (!frame) frame = requestAnimationFrame(render);
    };

    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(host);
    host.addEventListener('pointermove', onMove);
    return () => {
      host.removeEventListener('pointermove', onMove);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="rp-ripple-canvas" aria-hidden="true" />;
}
