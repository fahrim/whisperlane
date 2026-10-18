// WebGL meniscus lens + Gaussian blur + chromatic dispersion renderer for
// LiquidGlassSurface desktop backdrops.
//
// Replaces CPU-bound SVG `feDisplacementMap` (`backdrop-filter: url(#...)`) and
// compositor CSS `filter: blur(...)` with a single-pass GPU fragment shader over
// the raw RGBA buffer returned by `set_pill_blur_region` / `continue_pill_drag`.

export interface BackdropPacket {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  outW: number;
  outH: number;
  rgba: Uint8Array;
}

interface GlState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  texW: number;
  texH: number;
  uSurfaceSize: WebGLUniformLocation | null;
  uSurfaceOffset: WebGLUniformLocation | null;
  uCropSize: WebGLUniformLocation | null;
  uRadius: WebGLUniformLocation | null;
  uMeniscus: WebGLUniformLocation | null;
  uRefractPx: WebGLUniformLocation | null;
  uBlurPx: WebGLUniformLocation | null;
}

const glStates = new WeakMap<HTMLCanvasElement, GlState | null>();

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_surfaceSize;
uniform vec2 u_surfaceOffset;
uniform vec2 u_cropSize;
uniform float u_radius;
uniform float u_meniscus;
uniform float u_refractPx;
uniform float u_blurPx;

vec3 sampleBlurred(vec2 baseUV, vec2 stepUV) {
  // 13-tap 2-ring isotropic Gaussian disk kernel leveraging hardware bilinear
  // filtering for smooth, real-time backdrop blur.
  vec3 sum = texture2D(u_tex, baseUV).rgb * 0.22;

  vec2 r1 = stepUV * 0.52;
  sum += texture2D(u_tex, baseUV + vec2( r1.x,  0.0 )).rgb * 0.095;
  sum += texture2D(u_tex, baseUV + vec2(-r1.x,  0.0 )).rgb * 0.095;
  sum += texture2D(u_tex, baseUV + vec2( 0.0,   r1.y)).rgb * 0.095;
  sum += texture2D(u_tex, baseUV + vec2( 0.0,  -r1.y)).rgb * 0.095;
  sum += texture2D(u_tex, baseUV + vec2( r1.x,  r1.y) * 0.7071).rgb * 0.065;
  sum += texture2D(u_tex, baseUV + vec2(-r1.x, -r1.y) * 0.7071).rgb * 0.065;

  vec2 r2 = stepUV;
  sum += texture2D(u_tex, baseUV + vec2( r2.x,  r2.y) * 0.7071).rgb * 0.045;
  sum += texture2D(u_tex, baseUV + vec2(-r2.x,  r2.y) * 0.7071).rgb * 0.045;
  sum += texture2D(u_tex, baseUV + vec2( r2.x, -r2.y) * 0.7071).rgb * 0.045;
  sum += texture2D(u_tex, baseUV + vec2(-r2.x, -r2.y) * 0.7071).rgb * 0.045;
  sum += texture2D(u_tex, baseUV + vec2( r2.x,  0.0 )).rgb * 0.045;
  sum += texture2D(u_tex, baseUV + vec2(-r2.x,  0.0 )).rgb * 0.045;

  return sum;
}

void main() {
  vec2 halfSize = u_surfaceSize * 0.5;
  vec2 p = (v_uv - 0.5) * u_surfaceSize;
  float r = min(u_radius, min(halfSize.x, halfSize.y));

  // Signed distance to the rounded-rectangle silhouette (d <= 0 inside).
  vec2 q = abs(p) - (halfSize - vec2(r));
  vec2 w = max(q, 0.0);
  float d = min(max(q.x, q.y), 0.0) + length(w) - r;
  float inward = max(0.0, -d);

  // Smooth C1 outward unit normal across straight runs and rounded corners.
  vec2 grad = (length(w) > 1e-4)
    ? normalize(w)
    : ((q.x > q.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 normal = sign(p) * grad;

  // Meniscus lens profile: strictly 0 across the flat interior so text and
  // waveforms stay undistorted, rising smoothly toward the curved outer rim.
  float rimT = clamp(1.0 - inward / max(1.0, u_meniscus), 0.0, 1.0);
  float meniscus = rimT * rimT * (2.0 - rimT);

  // Extra 2D curvature magnification at the rounded end-caps / corners.
  float wLenSq = dot(w, w);
  float cornerBoost = (wLenSq > 1e-3) ? (2.0 * w.x * w.y) / wLenSq : 0.0;
  float bendPx = meniscus * (1.0 + 0.38 * cornerBoost) * u_refractPx;

  // Convex droplet refraction pulls background rays along the inward normal.
  vec2 dispLog = -normal * bendPx;

  vec2 fragLog = v_uv * u_surfaceSize;
  vec2 baseUV = (u_surfaceOffset + fragLog) / u_cropSize;
  vec2 dispUV = dispLog / u_cropSize;

  // Tighten blur slightly inside the high-curvature meniscus rim so refracted
  // background edges stay crisp like a physical glass lens.
  float localBlurPx = u_blurPx * mix(1.0, 0.72, meniscus);
  vec2 blurStepUV = vec2(localBlurPx) / u_cropSize;

  vec3 col;
  if (meniscus > 0.02) {
    // Chromatic dispersion (R/G/B refractive index separation) at the rim.
    vec3 colR = sampleBlurred(baseUV + dispUV * 0.80, blurStepUV);
    vec3 colG = sampleBlurred(baseUV + dispUV * 1.00, blurStepUV);
    vec3 colB = sampleBlurred(baseUV + dispUV * 1.22, blurStepUV);
    col = vec3(colR.r, colG.g, colB.b);
  } else {
    col = sampleBlurred(baseUV, blurStepUV);
  }

  // Optical saturation boost (120%) so desktop colours glow warmly through the
  // dark navy-indigo liquid glass body.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(luma), col, 1.20), 0.0, 1.0);

  // Subtle physical meniscus caustic highlight along top-left & bottom-right
  // curved bevel normals.
  float topLight = max(0.0, dot(normal, normalize(vec2(-0.45, -0.89))));
  float botLight = max(0.0, dot(normal, normalize(vec2( 0.45,  0.89))));
  float rimEdge = pow(rimT, 2.4);
  col += vec3(0.84, 0.80, 1.0) * (rimEdge * topLight * 0.14);
  col += vec3(0.45, 0.56, 0.98) * (rimEdge * botLight * 0.10);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function getOrInitGlState(canvas: HTMLCanvasElement): GlState | null {
  if (glStates.has(canvas)) {
    return glStates.get(canvas) ?? null;
  }

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    glStates.set(canvas, null);
    return null;
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) {
    glStates.set(canvas, null);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    glStates.set(canvas, null);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    glStates.set(canvas, null);
    return null;
  }

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  if (!texture) {
    glStates.set(canvas, null);
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const state: GlState = {
    gl,
    program,
    texture,
    texW: 0,
    texH: 0,
    uSurfaceSize: gl.getUniformLocation(program, "u_surfaceSize"),
    uSurfaceOffset: gl.getUniformLocation(program, "u_surfaceOffset"),
    uCropSize: gl.getUniformLocation(program, "u_cropSize"),
    uRadius: gl.getUniformLocation(program, "u_radius"),
    uMeniscus: gl.getUniformLocation(program, "u_meniscus"),
    uRefractPx: gl.getUniformLocation(program, "u_refractPx"),
    uBlurPx: gl.getUniformLocation(program, "u_blurPx"),
  };
  glStates.set(canvas, state);
  return state;
}

export function parseBackdropPacket(
  raw: ArrayBuffer | Uint8Array | null | undefined,
): BackdropPacket | null {
  if (!raw) return null;
  const buf =
    raw instanceof Uint8Array
      ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      : raw;
  if (!buf || buf.byteLength < 24) return null;

  const view = new DataView(buf, 0, 24);
  const cropX = view.getFloat32(0, true);
  const cropY = view.getFloat32(4, true);
  const cropW = view.getFloat32(8, true);
  const cropH = view.getFloat32(12, true);
  const outW = view.getUint32(16, true);
  const outH = view.getUint32(20, true);
  const pixelBytes = outW * outH * 4;
  if (outW === 0 || outH === 0 || buf.byteLength < 24 + pixelBytes) {
    return null;
  }

  return {
    cropX,
    cropY,
    cropW,
    cropH,
    outW,
    outH,
    rgba: new Uint8Array(buf as ArrayBuffer, 24, pixelBytes),
  };
}

export function renderLiquidGlassCanvas(
  canvas: HTMLCanvasElement,
  packet: BackdropPacket,
  surfaceRect: DOMRectReadOnly,
  cornerRadius: number,
): void {
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) return;

  const state = getOrInitGlState(canvas);
  if (!state) return;

  const { gl } = state;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetW = Math.max(1, Math.round(surfaceRect.width * dpr));
  const targetH = Math.max(1, Math.round(surfaceRect.height * dpr));
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;

  gl.viewport(0, 0, targetW, targetH);
  gl.useProgram(state.program);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texture);
  if (state.texW !== packet.outW || state.texH !== packet.outH) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      packet.outW,
      packet.outH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      packet.rgba,
    );
    state.texW = packet.outW;
    state.texH = packet.outH;
  } else {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      packet.outW,
      packet.outH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      packet.rgba,
    );
  }

  const isCapsule = cornerRadius >= 26;
  gl.uniform2f(state.uSurfaceSize, surfaceRect.width, surfaceRect.height);
  gl.uniform2f(
    state.uSurfaceOffset,
    surfaceRect.left - packet.cropX,
    surfaceRect.top - packet.cropY,
  );
  gl.uniform2f(state.uCropSize, packet.cropW, packet.cropH);
  gl.uniform1f(state.uRadius, cornerRadius);
  gl.uniform1f(state.uMeniscus, isCapsule ? 13.5 : 12.0);
  gl.uniform1f(state.uRefractPx, isCapsule ? 8.5 : 6.5);
  gl.uniform1f(state.uBlurPx, 4.2);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
