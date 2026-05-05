// pixel-dissolve fragment shader (skeleton)
//
// After authoring, register minified text inside `packages/shader-transitions/src/shaders/registry.ts`
// under the `shaders` map.
//
// Headers:
//   H  = precision mediump float, v_uv, u_from, u_to, u_progress, u_resolution,
//        u_accent, u_accent_dark, u_accent_bright
//   NQ = hash(p), vnoise(p), fbm(p)  — pick whichever you need
//
// (See common.ts)

// ── Shader body region ─────────────────────────────────────────────────────

void main() {
    // TODO 1: Quantize UV into macro blocks
    //   - ~30 horizontal blocks (tweak between 20–50)
    //   - blockUv = floor(v_uv * 30.0) / 30.0
    //   - Or perfectly square blocks: floor(v_uv * 30.0 * vec2(aspect, 1.0)) / 30.0 / vec2(aspect, 1.0)
    //     where aspect = u_resolution.x / u_resolution.y

    // TODO 2: Assign a noise threshold per block
    //   - threshold = vnoise(blockUv * 50.0)
    //   - or fbm(blockUv * 5.0) — more organic

    // TODO 3: Compare progress and derive mask
    //   - hard edge:  mask = step(threshold, u_progress)
    //   - soft edge:  mask = smoothstep(threshold - 0.05, threshold + 0.05, u_progress)

    // TODO 4: Sample from/to textures and mix
    //   - vec4 fromColor = texture2D(u_from, v_uv);
    //   - vec4 toColor   = texture2D(u_to, v_uv);
    //   - gl_FragColor = mix(fromColor, toColor, mask);

    // (Optional) TODO 5: Edge glow
    //   - Glow near dissolve boundary (threshold ≈ progress)
    //   - float edge = smoothstep(0.05, 0.0, abs(threshold - u_progress));
    //   - gl_FragColor.rgb += u_accent_bright * edge * 0.5;

    // Temporary placeholder — remove once implemented
    gl_FragColor = vec4(v_uv, 0.0, 1.0);
}

// ── Example registry entry after minification (reference) ───────────────────
//
// "pixel-dissolve": {
//   frag: H + NQ +
//     "void main(){" +
//     "vec2 b=floor(v_uv*30.)/30.;" +
//     "float t=vnoise(b*50.);" +
//     "float m=smoothstep(t-.05,t+.05,u_progress);" +
//     "vec4 A=texture2D(u_from,v_uv);" +
//     "vec4 B=texture2D(u_to,v_uv);" +
//     "gl_FragColor=mix(A,B,m);}",
// },
//
// Minify manually for consistency (other shaders are hand-minified).
// Build pipeline does not auto-minify.
