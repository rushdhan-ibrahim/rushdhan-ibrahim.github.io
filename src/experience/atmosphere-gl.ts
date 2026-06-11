// The deep field.
//
// A single fullscreen shader behind everything: slow domain-warped nebula fog
// that breathes with the act palette and drifts with the scroll. It is the
// page's weather. Renders at reduced resolution, pauses when the tab hides,
// degrades to nothing (the CSS nebulae remain) on weak or motion-averse
// devices.

import { onActChange } from './acts';
import { prefersReducedMotion } from '../utils/visibility';

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uAccent;
uniform float uIntensity;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(17.7, 9.2);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 p = uv;
    p.x *= uRes.x / uRes.y;

    vec2 q = p * 1.35 + vec2(uTime * 0.011, -uScroll * 1.2 - uTime * 0.004);
    vec2 warp = vec2(fbm(q), fbm(q + vec2(5.2, 1.3)));
    float f = fbm(q + 1.7 * warp + vec2(uTime * 0.006, 0.0));

    vec3 col = mix(uDeep, uMid, smoothstep(0.28, 0.78, f));
    col = mix(col, uAccent * 0.55, pow(smoothstep(0.58, 0.97, f), 2.4) * 0.32);

    // A second, thinner veil drifting the other way: depth without cost.
    float veil = fbm(p * 2.6 + vec2(-uTime * 0.007, uScroll * 0.5));
    col += uMid * pow(smoothstep(0.62, 0.95, veil), 2.0) * 0.25;

    // Vignette so the text column always sits in calm water.
    vec2 d = uv - vec2(0.5, 0.45);
    col *= 1.0 - dot(d, d) * 0.9;

    // Breath of grain to kill banding.
    col += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.016;

    gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

interface GlState {
    gl: WebGLRenderingContext;
    canvas: HTMLCanvasElement;
    uTime: WebGLUniformLocation;
    uScroll: WebGLUniformLocation;
    uRes: WebGLUniformLocation;
    uDeep: WebGLUniformLocation;
    uMid: WebGLUniformLocation;
    uAccent: WebGLUniformLocation;
    uIntensity: WebGLUniformLocation;
}

let state: GlState | null = null;
let rafId: number | null = null;
let palette = { deep: [9, 10, 18], mid: [22, 28, 48], accent: [138, 164, 198], intensity: 0.85 };
const start = performance.now();

function capable(): boolean {
    if (prefersReducedMotion()) return false;
    if (window.innerWidth < 769) return false;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (mem !== undefined && mem < 4) return false;
    return true;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return sh;
}

function fit(): void {
    if (!state) return;
    // Half-resolution internal buffer, CSS-upscaled: fog doesn't need pixels.
    const scale = 0.5;
    state.canvas.width = Math.max(2, Math.floor(window.innerWidth * scale));
    state.canvas.height = Math.max(2, Math.floor(window.innerHeight * scale));
    state.gl.viewport(0, 0, state.canvas.width, state.canvas.height);
}

function frame(): void {
    rafId = null;
    if (!state || document.hidden) return;
    const { gl } = state;
    const t = (performance.now() - start) / 1000;
    const doc = document.documentElement;
    const scroll = doc.scrollHeight > window.innerHeight
        ? window.scrollY / (doc.scrollHeight - window.innerHeight)
        : 0;

    gl.uniform1f(state.uTime, t);
    gl.uniform1f(state.uScroll, scroll);
    gl.uniform2f(state.uRes, state.canvas.width, state.canvas.height);
    gl.uniform3f(state.uDeep, palette.deep[0] / 255, palette.deep[1] / 255, palette.deep[2] / 255);
    gl.uniform3f(state.uMid, palette.mid[0] / 255, palette.mid[1] / 255, palette.mid[2] / 255);
    gl.uniform3f(state.uAccent, palette.accent[0] / 255, palette.accent[1] / 255, palette.accent[2] / 255);
    gl.uniform1f(state.uIntensity, palette.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    rafId = requestAnimationFrame(frame);
}

function resume(): void {
    if (state && rafId === null && !document.hidden) {
        rafId = requestAnimationFrame(frame);
    }
}

export function initAtmosphere(): void {
    if (!capable()) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'atmosphere-gl';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One oversized triangle beats a quad.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(program, n);
    const uTime = u('uTime'), uScroll = u('uScroll'), uRes = u('uRes'),
        uDeep = u('uDeep'), uMid = u('uMid'), uAccent = u('uAccent'), uIntensity = u('uIntensity');
    if (!uTime || !uScroll || !uRes || !uDeep || !uMid || !uAccent || !uIntensity) return;

    state = { gl, canvas, uTime, uScroll, uRes, uDeep, uMid, uAccent, uIntensity };
    document.body.prepend(canvas);
    document.body.classList.add('gl-on');
    fit();

    onActChange((deep, mid, accent, intensity) => {
        palette = { deep: [...deep], mid: [...mid], accent: [...accent], intensity };
    });

    window.addEventListener('resize', fit);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        } else {
            resume();
        }
    });

    resume();
}
