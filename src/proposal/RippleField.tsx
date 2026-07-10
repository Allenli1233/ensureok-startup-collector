/**
 * RippleField —— 自包含 WebGL 鼠标跟随水波纹(零第三方依赖)。
 * 一张 <canvas> 铺在 Bento 层背景(pointer-events:none,不挡点击),水波随光标扩散(位移 + 高光)。
 * 只动 canvas 内像素(GPU 合成),不触发布局 / 回流;requestAnimationFrame 唯一循环。
 *
 * 生命周期与降级(硬性):
 *   - visibilitychange:document.hidden 时停 rAF,可见再起(省电、防后台空转)。
 *   - prefers-reduced-motion:根本不初始化 WebGL,组件返回 null。
 *   - WebGL 不可用 / shader 编译 / program link 失败:try/catch 捕获、清理资源、降级为 null,绝不抛错。
 *   - ResizeObserver 同步尺寸;devicePixelRatio 上限 2 控性能。
 *
 * TODO(unicornstudio): 现为自包含 WebGL 着色器,零依赖。将来若接 UnicornStudio 托管场景:
 *   1) 渲染 <div data-us-project="<PROJECT_ID>" class="rp-ripple-canvas" /> 取代本 <canvas>;
 *   2) 动态注入其 script 后在挂载时调用
 *      window.UnicornStudio?.addScene({ elementId, projectId: '<PROJECT_ID>', ... })
 *      并在卸载时销毁该 scene;
 *   3) 保持本组件对外 props / 定位 / pointer-events:none / reduced-motion 降级不变。
 */
import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useEffect, useRef } from 'react';

const MAX_WAVES = 8;

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// 暖调深色底(品牌 ink)上叠跟随光标的同心水波:位移折射 + 白色高光,低 alpha 作背景水光。
const FRAG_SRC = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform vec3 uWaves[${MAX_WAVES}]; // (uvx, uvy, birthTime)

const float FREQ = 26.0;
const float SPEED = 2.4;
const float FALLOFF = 3.2;
const float DECAY = 1.35;

void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float ring = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec3 w = uWaves[i];
    float age = uTime - w.z;
    if (age < 0.0 || age > 6.0) continue;
    vec2 c = vec2(w.x * uAspect, w.y);
    float d = distance(p, c);
    float phase = d * FREQ - age * SPEED;
    ring += sin(phase) * exp(-d * FALLOFF) * exp(-age * DECAY);
  }
  // (a) 位移:用 ring 扰动一张程序化径向暖光的采样 uv,制造水面折射
  vec2 disp = uv + ring * 0.02;
  float glow = smoothstep(1.05, 0.0, distance(disp, vec2(0.5)));
  vec3 warm = mix(vec3(0.137, 0.122, 0.106), vec3(0.42, 0.22, 0.12), glow * 0.55);
  // (b) 高光:白色 spec
  float spec = smoothstep(0.18, 0.62, ring);
  vec3 col = warm + spec * vec3(0.92, 0.82, 0.70);
  float alpha = clamp(abs(ring) * 0.5 + spec * 0.4, 0.0, 0.45);
  gl_FragColor = vec4(col * alpha, alpha); // 预乘 alpha
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

export function RippleField(): React.ReactElement | null {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduce) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;

    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let disposed = false;

    // 波源 ring buffer:(uvx, uvy, birthTime),birth 远负 = 死波
    const waves = new Float32Array(MAX_WAVES * 3);
    for (let i = 0; i < MAX_WAVES; i++) waves[i * 3 + 2] = -1e9;
    let waveIdx = 0;
    let lastX = -1;
    let lastY = -1;
    let lastPush = 0;
    const start = performance.now();
    const nowSec = () => (performance.now() - start) / 1000;

    try {
      gl =
        (canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) as
          | WebGLRenderingContext
          | null) ||
        (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
      if (!gl) return; // WebGL 不可用 → 静默降级(canvas 保持透明)

      const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      program = gl.createProgram();
      if (!program) throw new Error('createProgram failed');
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('program link failed: ' + gl.getProgramInfoLog(program));
      }

      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // 全屏四边形(TRIANGLE_STRIP)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const uTime = gl.getUniformLocation(program, 'uTime');
      const uAspect = gl.getUniformLocation(program, 'uAspect');
      const uWaves = gl.getUniformLocation(program, 'uWaves[0]');

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 预乘 alpha
      gl.clearColor(0, 0, 0, 0);

      let aspect = 1;
      const resize = () => {
        if (!gl) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(host.clientWidth * dpr));
        const h = Math.max(1, Math.round(host.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        aspect = host.clientWidth > 0 && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1;
        gl.viewport(0, 0, w, h);
      };
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(host);
      }

      const onMove = (e: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ux = (e.clientX - rect.left) / rect.width;
        const uy = 1 - (e.clientY - rect.top) / rect.height; // GL uv y 向上
        const t = nowSec();
        const moved = Math.hypot(ux - lastX, uy - lastY);
        // 采样:移动超阈值或 ~90ms 采一次,形成拖尾扩散
        if (lastX < 0 || moved > 0.02 || t - lastPush > 0.09) {
          waves[waveIdx * 3 + 0] = ux;
          waves[waveIdx * 3 + 1] = uy;
          waves[waveIdx * 3 + 2] = t;
          waveIdx = (waveIdx + 1) % MAX_WAVES;
          lastX = ux;
          lastY = uy;
          lastPush = t;
        }
      };
      host.addEventListener('pointermove', onMove);

      const render = () => {
        if (disposed || !gl) return;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(uTime, nowSec());
        gl.uniform1f(uAspect, aspect);
        gl.uniform3fv(uWaves, waves);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        raf = requestAnimationFrame(render);
      };

      const onVisibility = () => {
        if (document.hidden) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        } else if (!raf && !disposed) {
          raf = requestAnimationFrame(render);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);

      if (!document.hidden) raf = requestAnimationFrame(render);

      return () => {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        host.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVisibility);
        ro?.disconnect();
        if (gl) {
          if (buffer) gl.deleteBuffer(buffer);
          if (program) gl.deleteProgram(program);
          const ext = gl.getExtension('WEBGL_lose_context');
          ext?.loseContext();
        }
      };
    } catch {
      // 编译 / link / 运行任一环节失败 → 清理、静默降级,绝不影响 Bento
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
      return;
    }
  }, [reduce]);

  if (reduce) return null;
  return <canvas ref={canvasRef} className="rp-ripple-canvas" aria-hidden="true" />;
}
