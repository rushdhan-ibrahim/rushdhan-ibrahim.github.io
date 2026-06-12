// WebGL-based supernova renderer
// Renders supernova as a background effect that interacts with page content

import { startCosmicAudio, stopCosmicAudio } from '../audio/cosmic';

// Maximum number of content boxes we can track for occlusion
const MAX_CONTENT_BOXES = 12;

// Fragment shader - supernova phenomena only (no background stars/nebula)
// Outputs with alpha for proper blending with existing page content
const FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 R;
uniform float T;
uniform vec2 M;
uniform float fate;
uniform float age;
uniform float mobile;  // 1.0 on mobile, 0.0 on desktop
uniform vec2 uDiskPrecess;  // Pre-computed (cos, sin) for disk precession

// Content box occlusion uniforms
// Each box is: vec4(x, y, width, height) in normalized screen coords (0-1)
uniform vec4 contentBoxes[${MAX_CONTENT_BOXES}];
uniform float boxOpacities[${MAX_CONTENT_BOXES}];  // 0 = transparent, 1 = opaque
uniform float boxTypes[${MAX_CONTENT_BOXES}];      // 0 = excluded, 1 = viz box, 2 = text box
uniform int numBoxes;

#define PI 3.14159265
#define TAU 6.28318530

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

float h(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1,0)), f.x),
               mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y);
}

// PERFORMANCE: Precomputed rotation matrices (GPU constants vs per-call trig)
const mat2 ROT_05 = mat2(0.8776, 0.4794, -0.4794, 0.8776);  // rot2D(0.5)
const mat2 ROT_04 = mat2(0.9211, 0.3894, -0.3894, 0.9211);  // rot2D(0.4)

// Optimized FBM - 3 octaves with precomputed rotation
float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * n(p);
        p = ROT_05 * p * 2.0 + 0.3;
        a *= 0.5;
    }
    return v;
}

// Cheap FBM - 2 octaves for non-critical areas
float fbm2(vec2 p) {
    return n(p) * 0.7 + n(ROT_04 * p * 2.0) * 0.3;
}

// Single noise call - cheapest option
float fbm1(vec2 p) {
    return n(p);
}

// Domain warping for fluid-like nebulae
// PERFORMANCE: Mobile uses single noise sample (3x reduction)
float warp(vec2 p, float t) {
    if (mobile > 0.5) {
        // Mobile: single noise sample instead of 3
        return fbm1(p + t * 0.06) * 0.7 + 0.3;
    }
    // Desktop: full quality (3 noise samples)
    vec2 q = vec2(fbm1(p), fbm1(p + vec2(5.2, 1.3)));
    return fbm2(p + 2.5 * q + t * 0.06);
}

// 2D rotation matrix (for dynamic rotations only)
mat2 rot2D(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// ══════════════════════════════════════════════════════════════
// COLOR PALETTE
// ══════════════════════════════════════════════════════════════

vec3 rose = vec3(0.67, 0.29, 0.43);
vec3 teal = vec3(0.22, 0.53, 0.61);
vec3 purple = vec3(0.45, 0.29, 0.61);
vec3 blue = vec3(0.29, 0.37, 0.67);
vec3 dust = vec3(0.71, 0.55, 0.39);
vec3 warmWhite = vec3(1.0, 0.94, 0.88);

// ══════════════════════════════════════════════════════════════
// iOS-STYLE GLASS PHYSICS
// ══════════════════════════════════════════════════════════════

// Signed distance to a box (negative inside, positive outside)
float sdBox(vec2 p, vec2 boxCenter, vec2 boxHalfSize) {
    vec2 d = abs(p - boxCenter) - boxHalfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Get the nearest edge normal for a point near a box
vec2 getBoxEdgeNormal(vec2 p, vec2 boxCenter, vec2 boxHalfSize) {
    vec2 d = p - boxCenter;
    vec2 ad = abs(d) - boxHalfSize;

    // Determine which edge we're closest to
    if (ad.x > ad.y) {
        return vec2(sign(d.x), 0.0);
    } else {
        return vec2(0.0, sign(d.y));
    }
}

// Glass physics structure - returns multiple effects for three-tier system
// Tier 0: Excluded (nav) - no effects
// Tier 1: Viz boxes - light pooling, caustic edges
// Tier 2: Text boxes - dramatic refraction, obscuration during flash
struct GlassData {
    // Core properties
    float behindGlass;
    float fresnel;
    float refraction;
    float specular;
    float edgeBevel;
    vec2 refractionOffset;
    float glassOpacity;

    // Tier identification
    float glassType;           // 0 = none, 1 = viz box, 2 = text box

    // Light pooling (viz boxes - Type 1)
    float poolGradient;        // Edge-to-center gradient (1 at center, 0 at edges)
    float focusingStrength;    // Edge light focusing intensity
    vec2 boxCenter;            // Center of current box (for pooling calculations)
    vec2 boxHalfSize;          // Half-size of current box

    // Dramatic effects (text boxes - Type 2)
    float warpFactor;          // Light warping magnitude
    float obscurationLevel;    // Content obscuration during flash
};

// ══════════════════════════════════════════════════════════════
// LIGHT POOLING - Viz boxes capture and concentrate light
// ══════════════════════════════════════════════════════════════

vec3 calculateLightPooling(vec2 screenUV, vec2 boxCenter, vec2 boxHalfSize,
                           float lightIntensity, float flashLevel) {
    vec3 poolEffect = vec3(0.0);

    // Normalized position within box (-1 to 1 range)
    vec2 normalizedPos = (screenUV - boxCenter) / boxHalfSize;
    float centerDist = length(normalizedPos);

    // ═══ INTERIOR GLOW ═══
    // Brighter at center, creating a "pooled light" effect
    float poolGradient = 1.0 - smoothstep(0.0, 0.85, centerDist);
    float poolIntensity = poolGradient * poolGradient; // Quadratic falloff

    // Base pool color - warm golden interior
    vec3 poolColor = mix(warmWhite, vec3(1.0, 0.92, 0.8), 0.3);
    poolEffect += poolColor * poolIntensity * lightIntensity * 0.35;

    // MOBILE OPTIMIZATION: Skip expensive caustic/edge/depth effects
    // Just use interior glow with flash boost (saves ~6 operations per pixel)
    if (mobile > 0.5) {
        float flashBoost = 1.0 + flashLevel * 3.0;
        return poolEffect * flashBoost;
    }

    // ═══ EDGE FOCUSING ═══ (DESKTOP ONLY)
    // Light appears to "pour in" at the edges and focus toward center
    float edgeFocus = smoothstep(0.5, 0.92, centerDist);

    // Caustic-like shimmer at edges
    float causticPhase = T * 0.8;
    float caustic = sin(centerDist * 15.0 + causticPhase) * 0.5 + 0.5;
    caustic *= sin(atan(normalizedPos.y, normalizedPos.x) * 3.0 + causticPhase * 0.5) * 0.3 + 0.7;
    caustic *= edgeFocus;
    poolEffect += teal * 0.25 * caustic * lightIntensity;

    // ═══ CORNER BRIGHTENING ═══
    // Corners collect more light (Fresnel-like accumulation)
    float cornerFactor = abs(normalizedPos.x) * abs(normalizedPos.y);
    cornerFactor = smoothstep(0.25, 0.7, cornerFactor);
    poolEffect += vec3(0.95, 0.9, 0.85) * cornerFactor * lightIntensity * 0.15;

    // ═══ FLASH AMPLIFICATION ═══
    // During supernova flash, pooling becomes much more intense
    float flashBoost = 1.0 + flashLevel * 3.0;
    poolEffect *= flashBoost;

    // ═══ DEPTH PARALLAX ═══
    // Subtle layered effect suggesting depth
    float depth1 = sin(centerDist * 8.0 - T * 0.3) * 0.5 + 0.5;
    float depth2 = sin(centerDist * 5.0 + T * 0.2) * 0.5 + 0.5;
    float parallaxLayer = mix(depth1, depth2, 0.5) * poolGradient;
    poolEffect += blue * 0.08 * parallaxLayer * lightIntensity;

    return poolEffect;
}

// ══════════════════════════════════════════════════════════════
// TEXT BOX WARPING - Dramatic light distortion
// ══════════════════════════════════════════════════════════════

vec2 calculateTextWarp(vec2 screenUV, vec2 boxCenter, vec2 boxHalfSize,
                       float flashLevel) {
    vec2 normalizedPos = (screenUV - boxCenter) / boxHalfSize;
    float dist = length(normalizedPos);

    // Warp direction - radial from center
    vec2 warpDir = normalize(normalizedPos + vec2(0.001));

    // Warp strength - peaks during flash
    float warpBase = 0.015;
    float warpFlash = warpBase * (1.0 + flashLevel * 6.0);

    // Add turbulence using noise for organic feel
    float turbulence = fbm2(normalizedPos * 3.0 + T * 0.4);
    warpFlash *= (0.6 + turbulence * 0.8);

    // Stronger warp near edges (like light bending around thick glass)
    float edgeWarp = smoothstep(0.2, 0.85, dist);

    return warpDir * warpFlash * edgeWarp;
}

GlassData calculateGlassPhysics(vec2 screenUV, float lightIntensity, float flashLevel) {
    GlassData glass;
    // Core properties
    glass.behindGlass = 0.0;
    glass.fresnel = 0.0;
    glass.refraction = 0.0;
    glass.specular = 0.0;
    glass.edgeBevel = 0.0;
    glass.refractionOffset = vec2(0.0);
    glass.glassOpacity = 0.0;
    // Tier identification
    glass.glassType = 0.0;
    // Light pooling (viz boxes)
    glass.poolGradient = 0.0;
    glass.focusingStrength = 0.0;
    glass.boxCenter = vec2(0.0);
    glass.boxHalfSize = vec2(0.0);
    // Dramatic effects (text boxes)
    glass.warpFactor = 0.0;
    glass.obscurationLevel = 0.0;

    float minDist = 1000.0;
    vec2 closestNormal = vec2(0.0);
    float closestOpacity = 0.0;
    float closestType = 0.0;
    vec2 closestBoxCenter = vec2(0.0);
    vec2 closestBoxHalfSize = vec2(0.0);

    for (int i = 0; i < ${MAX_CONTENT_BOXES}; i++) {
        if (i >= numBoxes) break;

        vec4 box = contentBoxes[i];
        float opacity = boxOpacities[i];
        float boxType = boxTypes[i];

        // Skip excluded elements (type 0) or invisible boxes
        if (opacity < 0.01 || boxType < 0.5) continue;

        vec2 boxCenter = box.xy + box.zw * 0.5;
        vec2 boxHalfSize = box.zw * 0.5;

        float dist = sdBox(screenUV, boxCenter, boxHalfSize);

        // Track closest box for edge effects
        if (abs(dist) < abs(minDist)) {
            minDist = dist;
            closestNormal = getBoxEdgeNormal(screenUV, boxCenter, boxHalfSize);
            closestOpacity = opacity;
            closestType = boxType;
            closestBoxCenter = boxCenter;
            closestBoxHalfSize = boxHalfSize;
        }

        // Inside the glass
        if (dist < 0.0) {
            glass.behindGlass = max(glass.behindGlass, opacity);
            glass.glassOpacity = max(glass.glassOpacity, opacity);
            glass.glassType = boxType;
            glass.boxCenter = boxCenter;
            glass.boxHalfSize = boxHalfSize;

            float edgeDist = -dist;
            vec2 normal = getBoxEdgeNormal(screenUV, boxCenter, boxHalfSize);
            vec2 normalizedPos = (screenUV - boxCenter) / boxHalfSize;
            float centerDist = length(normalizedPos);

            // ═══ TYPE 1: VIZ BOX - Light pooling ═══
            if (boxType > 0.5 && boxType < 1.5) {
                // Wider refraction zone for stronger glass presence
                float refractionStrength = 0.018 * (1.0 - smoothstep(0.0, 0.12, edgeDist));
                refractionStrength *= opacity;
                glass.refractionOffset += normal * refractionStrength;
                glass.refraction = max(glass.refraction, refractionStrength * 8.0);

                // Pool gradient for interior glow
                glass.poolGradient = 1.0 - smoothstep(0.0, 0.85, centerDist);

                // Edge focusing strength
                glass.focusingStrength = smoothstep(0.5, 0.92, centerDist) * lightIntensity;
            }
            // ═══ TYPE 2: TEXT BOX - Dramatic warping ═══
            else if (boxType > 1.5) {
                // Standard refraction with flash amplification
                float refractionStrength = 0.02 * (1.0 - smoothstep(0.0, 0.1, edgeDist));
                refractionStrength *= opacity * (1.0 + flashLevel * 2.5);
                glass.refractionOffset += normal * refractionStrength;
                glass.refraction = max(glass.refraction, refractionStrength * 12.0);

                // Warp calculation is expensive - skip on mobile
                if (mobile < 0.5) {
                    vec2 warp = calculateTextWarp(screenUV, boxCenter, boxHalfSize, flashLevel);
                    glass.refractionOffset += warp;
                    glass.warpFactor = length(warp) * 15.0;
                }

                // Obscuration during flash (text can be partially hidden)
                glass.obscurationLevel = flashLevel * 0.5 * opacity;
            }
        }
    }

    // ═══ EDGE EFFECTS (only if near a box) ═══
    float absMinDist = abs(minDist);

    if (absMinDist < 0.06) {
        // Mobile: simplified edge effects (fresnel only, no bevel/specular)
        // These subtle effects are barely visible on small screens
        if (mobile > 0.5) {
            float fresnelWidth = 0.025;
            if (absMinDist < fresnelWidth) {
                float fresnel = 1.0 - (absMinDist / fresnelWidth);
                glass.fresnel = fresnel * closestOpacity * 0.8;
            }
        } else {
            // Desktop: full edge effects
            // ═══ FRESNEL EDGE GLOW ═══
            float fresnelWidth = 0.025;
            if (absMinDist < fresnelWidth) {
                float fresnel = 1.0 - (absMinDist / fresnelWidth);
                fresnel = pow(fresnel, 1.5);
                float lightFacing = max(0.0, dot(closestNormal, vec2(0.0, 1.0)) * 0.5 + 0.5);
                glass.fresnel = fresnel * (0.6 + lightFacing * 0.4) * closestOpacity;
            }

            // ═══ BEVEL HIGHLIGHT ═══
            float bevelWidth = 0.008;
            if (absMinDist < bevelWidth) {
                float bevel = 1.0 - (absMinDist / bevelWidth);
                bevel = pow(bevel, 2.0);
                glass.edgeBevel = bevel * closestOpacity;
            }

            // ═══ SPECULAR HIGHLIGHT ═══
            vec2 lightDir = normalize(vec2(0.0) - screenUV);
            float specAngle = dot(closestNormal, lightDir);

            if (minDist < 0.0 && minDist > -0.03) {
                float spec = pow(max(0.0, specAngle), 8.0);
                spec *= (1.0 - smoothstep(0.0, 0.03, -minDist));
                glass.specular = spec * lightIntensity * closestOpacity * 0.8;
            }
        }
    }

    return glass;
}

// Chromatic aberration - sample colors at slightly offset positions
vec3 sampleWithChromaticAberration(vec2 uv, vec2 offset, float strength) {
    // This will be used to offset R, G, B channels differently
    // Returns the offset amounts for each channel
    return vec3(
        strength * 1.0,   // Red shifts most
        strength * 0.0,   // Green stays centered
        strength * -1.0   // Blue shifts opposite
    );
}

// ══════════════════════════════════════════════════════════════
// PROGENITOR STAR - Breathing, growing
// ══════════════════════════════════════════════════════════════

vec3 progenitor(vec2 p, float t) {
    float r = length(p);
    float vis = 1.0 - smoothstep(9.0, 10.0, t);
    if (vis < 0.01) return vec3(0.0);

    float inst = smoothstep(0.0, 9.0, t);
    float pulse = 0.7 + 0.3 * sin(t * (1.5 + inst * 5.0));
    pulse += fbm2(vec2(atan(p.y, p.x) * 2.0, t * 3.0)) * 0.15 * inst;

    float size = 1.0 + inst * 0.8;
    if (t > 8.5) size *= 1.0 + (t - 8.5) * 4.0;
    if (t > 9.5) size *= max(0.0, 1.0 - (t - 9.5) * 3.0);

    float core = exp(-r * r * (80.0 / (size * size)));
    float corona = exp(-r * r * (15.0 / (size * size))) * (0.3 + inst * 0.4);

    vec3 coreCol = warmWhite;
    vec3 coronaCol = mix(dust, rose * 0.8, inst * 0.5);

    vec3 col = coreCol * core * (1.5 + inst * 0.8);
    col += coronaCol * corona;

    return col * vis * pulse;
}

// ══════════════════════════════════════════════════════════════
// EXPLOSION - Flash, shockwaves, light rays, debris
// ══════════════════════════════════════════════════════════════

vec3 explosion(vec2 p, float t) {
    float r = length(p);
    float ang = atan(p.y, p.x);

    float elapsed = t - 10.0;
    if (elapsed < 0.0) return vec3(0.0);

    float prog = clamp(elapsed / 12.0, 0.0, 1.0);
    float intensity = smoothstep(0.0, 0.03, prog) * (1.0 - smoothstep(0.25, 1.0, prog));

    vec3 col = vec3(0.0);

    // Expanding shell
    float shellR = 0.02 + prog * 1.0;
    float shellW = 0.04 + prog * 0.12;
    float shell = exp(-pow((r - shellR) / shellW, 2.0));

    float fil = fbm2(vec2(ang * 5.0, r * 4.0 - t * 0.08));
    shell *= 0.4 + 0.6 * fil;

    float temp = smoothstep(shellR + 0.05, shellR - 0.1, r);
    vec3 shellCol = mix(teal * 1.5, mix(dust, rose, 0.4) * 2.0, smoothstep(0.0, 0.5, temp));
    shellCol = mix(shellCol, warmWhite, pow(temp, 2.0));

    col += shellCol * shell * intensity;

    // Multiple shockwave rings with organic wobble
    // MOBILE: 2 rings with 1 sin() each (vs 4 rings × 3 sin() on desktop)
    float maxRings = mobile > 0.5 ? 2.0 : 4.0;
    for (float i = 0.0; i < 4.0; i++) {
        if (i >= maxRings) break;  // Early exit on mobile

        float delay = i * 0.015;
        float ringProg = clamp((elapsed - delay) / (6.0 + i), 0.0, 1.0);
        float baseRingR = ringProg * 1.2;

        float morphSpeed = 12.0 + i * 2.0;
        float morphPhase = t * morphSpeed + i * 1.5;

        // MOBILE: single sin() vs 3 sin() calls
        float distort = 0.0;
        if (mobile > 0.5) {
            distort = sin(ang * 2.0 + morphPhase) * 0.025;  // Single sin
        } else {
            distort += sin(ang * 1.0 + morphPhase) * 0.03;
            distort += sin(ang * 2.0 - morphPhase * 0.7) * 0.015;
            distort += sin(ang * 3.0 + morphPhase * 1.3) * 0.008;
        }

        float ringR = baseRingR * (1.0 + distort);
        float ringW = 0.008 + ringProg * 0.004;
        float delta = (r - ringR) / ringW;
        float ring = exp(-delta * delta);  // Optimized: no pow()
        ring *= 1.0 - ringProg;

        vec3 ringCol = i < 1.0 ? blue * 1.5 :
                       i < 2.0 ? dust * 1.3 :
                       i < 3.0 ? purple * 1.2 : teal * 1.1;
        col += ringCol * ring * 0.4;
    }

    // Light rays
    float rayIntensity = intensity * (1.0 - smoothstep(0.0, 0.3, prog));
    float numRays = 24.0;
    float rayAng = ang + t * 0.02;
    float rays = pow(abs(sin(rayAng * numRays * 0.5)), 8.0);
    rays *= exp(-r * 2.0) * rayIntensity;
    col += warmWhite * 0.15 * rays;

    // Lens flares
    float flareDist = length(p - vec2(0.08, -0.05));
    float flare1 = exp(-flareDist * flareDist * 80.0) * intensity;
    col += blue * 0.3 * flare1;

    flareDist = length(p - vec2(-0.12, 0.08));
    float flare2 = exp(-flareDist * flareDist * 120.0) * intensity;
    col += rose * 0.25 * flare2;

    flareDist = length(p - vec2(0.15, 0.1));
    float flare3 = exp(-flareDist * flareDist * 200.0) * intensity;
    col += teal * 0.35 * flare3;

    // Anamorphic streak
    float streak = exp(-p.y * p.y * 400.0) * exp(-abs(p.x) * 3.0);
    streak *= intensity * (1.0 - smoothstep(0.0, 0.2, prog));
    col += warmWhite * 0.4 * streak;

    return col;
}

// ══════════════════════════════════════════════════════════════
// NEBULA - Soft elliptical clouds with domain warping (background)
// ══════════════════════════════════════════════════════════════

vec3 nebula(vec2 p, float t, vec2 parallax) {
    // Nebula only appears after explosion (t=10)
    float nebulaVis = smoothstep(10.0, 12.0, t);
    if (nebulaVis < 0.01) return vec3(0.0);

    vec2 q = (p + parallax * 0.06) * 0.55;

    // Domain warping for fluid-like motion
    float w = warp(q * 0.8, t * 0.3);

    // PERFORMANCE: fbm2 instead of fbm3 (saves 1 noise sample)
    float n1 = fbm2(q * 1.4 + t * 0.004);
    float n2 = fbm2(q * 2.2 + 5.0 - t * 0.003);
    float n3 = fbm2(q * 0.9 + vec2(3.0, -2.0));

    // Mix warped and regular noise for organic feel
    float dens = pow(n1, 2.0) * 0.4 + pow(n2, 2.3) * 0.25 + pow(n3, 2.5) * 0.15;
    dens += pow(w, 2.2) * 0.2; // Add warped layer

    // Highlight ridges in the warped noise (volumetric feel)
    float ridges = smoothstep(0.5, 0.7, w);

    // Blend nebula colors
    vec3 col = purple * 0.4;
    col = mix(col, rose * 0.35, n1);
    col = mix(col, teal * 0.3, n2 * 0.6);
    col = mix(col, blue * 0.25, n3 * 0.4);

    // Add bright ridge highlights
    col += vec3(0.8, 0.7, 0.9) * ridges * 0.15;

    return col * dens * 0.6 * nebulaVis;
}

// ══════════════════════════════════════════════════════════════
// REMNANT NEBULA - Subtle filamentary structure with fluid motion
// ══════════════════════════════════════════════════════════════

vec3 remnant(vec2 p, float t, float nebulaAge) {
    float appear = smoothstep(12.0, 18.0, t);
    if (appear < 0.01) return vec3(0.0);

    float te = t - 12.0 + nebulaAge * 4.0;
    float r = length(p);
    float th = atan(p.y, p.x);

    float shellR = 0.06 + 0.9 * (1.0 - exp(-te * 0.15));
    float shellW = 0.10 + 0.015 * smoothstep(0.0, 10.0, te);

    // Fluid domain warping
    vec2 q = p;
    float fluidWarp = warp(q * 1.2, te * 0.2);

    // Additional displacement
    vec2 warpDisp = vec2(
        fbm2(q * 1.0 + vec2(17.0, te * 0.03)),
        fbm2(q * 1.0 + vec2(43.0, -te * 0.02))
    );
    q += (warpDisp - 0.5) * 0.18;

    // Subtle filaments - PERFORMANCE: fbm2 instead of fbm3
    float noiseVal = fbm2(q * 2.2 + 11.0);
    float ridge = 1.0 - abs(2.0 * noiseVal - 1.0);
    ridge = pow(ridge, 1.8);

    // Volumetric ridge highlights from fluid warp
    float fluidRidges = smoothstep(0.5, 0.75, fluidWarp);

    float shell = exp(-pow((r - shellR) / shellW, 2.0));
    float interior = exp(-r * r / ((shellR * 1.1 + 0.15) * (shellR * 1.1 + 0.15)));

    // Soft clouds
    float clouds = fbm2(q * 0.7 + 23.0 + te * 0.015);
    clouds = pow(clouds, 2.5);

    // Rayleigh-Taylor fingers
    float fingers = n(vec2(th * 5.0 + 5.0, r * 4.0 - te * 0.2));
    fingers = pow(1.0 - abs(2.0 * fingers - 1.0), 2.0);

    // Combine density layers
    float density = 0.0;
    density += shell * (0.5 + 0.35 * ridge);
    density += interior * (0.15 + 0.2 * pow(noiseVal, 1.5));
    density += interior * clouds * 0.2;
    density += interior * fluidWarp * 0.15; // Add fluid contribution
    density *= (0.85 + 0.2 * fingers);
    density *= exp(-te * 0.025);

    // Astrophotography colors
    vec3 H_alpha = rose * 1.1;
    vec3 O_III = teal * 1.2;
    vec3 violet = purple * 1.2;
    vec3 dustCol = dust * 0.7;

    // Mix based on noise and position
    float mixHO = smoothstep(0.3, 0.7, noiseVal);
    vec3 col = mix(H_alpha, O_III, mixHO);
    col = mix(col, violet, 0.2 * ridge);
    col = mix(col, dustCol, 0.3 * smoothstep(shellR - 0.05, shellR + 0.15, r));

    // Volumetric ridge highlights from fluid warping
    col += vec3(0.9, 0.85, 1.0) * fluidRidges * 0.2 * interior;

    // Soft blue interior
    col += blue * 0.15 * interior * (1.0 - r * 2.0);

    return col * density * appear;
}

// ══════════════════════════════════════════════════════════════
// NEUTRON STAR - Rapid flickering core with precessing lighthouse beams
// ══════════════════════════════════════════════════════════════

vec3 neutron(vec2 p, float t) {
    float r = length(p);
    float appear = smoothstep(16.0, 20.0, t);
    if (appear < 0.01) return vec3(0.0);

    // Tiny brilliant core
    float core = exp(-r * r * 12000.0);

    // Slower, more stately flickering
    float flicker1 = sin(t * 3.0) * 0.2 + 0.8;
    float flicker2 = sin(t * 5.0 + 0.5) * 0.15 + 0.85;
    float flicker3 = sin(t * 7.0 + 1.2) * 0.1 + 0.9;
    float flicker4 = sin(t * 1.5 + 2.0) * 0.1 + 0.9;
    float flicker = flicker1 * flicker2 * flicker3 * flicker4;

    // Add noise-based variation for organic feel
    float noiseFlicker = 0.9 + 0.1 * n(vec2(t * 1.5, 0.0));
    flicker *= noiseFlicker;

    // Soft glow responds to flicker
    float glow = exp(-r * r * 1800.0) * flicker;
    float outerGlow = exp(-r * r * 400.0) * (0.3 + flicker * 0.2);

    // Surface texture - subtle granulation
    float texture = 0.9 + 0.1 * fbm2(vec2(atan(p.y, p.x) * 3.0, r * 20.0 + t * 0.5));

    vec3 col = vec3(0.88, 0.93, 1.0) * core * 2.8 * texture * flicker;
    col += blue * 1.2 * glow * 0.7;
    col += teal * outerGlow * 0.35;

    // ─── PRECESSING LIGHTHOUSE BEAMS ───
    // The pulsar's rotation axis wobbles (precession)
    float precessionPeriod = 15.0; // Slow wobble
    float precessionAngle = 0.3 * sin(t * TAU / precessionPeriod);

    // Pulsar spin - visible rotation (~1.5 rotations per second)
    float spinRate = 1.5;
    float spinAngle = t * spinRate;

    // Combine precession with spin
    float beamAngle = spinAngle + precessionAngle;

    // Rotate coordinates for beam calculation
    mat2 beamRot = rot2D(beamAngle);
    vec2 rotP = beamRot * p;

    // Jet 1 - Primary beam (brighter when facing us)
    float beamWidth1 = abs(rotP.x);
    float beamDist1 = rotP.y;
    float jet1 = exp(-beamWidth1 * beamWidth1 * 200.0);
    jet1 *= exp(-abs(beamDist1) * 2.5);
    jet1 *= smoothstep(0.0, 0.05, r); // Fade near core
    jet1 *= smoothstep(0.8, 0.0, r);  // Fade at distance

    // Jet visibility pulses as beam sweeps past our line of sight
    float beamPulse1 = pow(max(0.0, cos(beamAngle * 2.0)), 4.0);
    jet1 *= 0.4 + 0.6 * beamPulse1;

    // Jet 2 - Opposite beam (180° offset, slightly dimmer)
    vec2 rotP2 = rot2D(beamAngle + PI) * p;
    float beamWidth2 = abs(rotP2.x);
    float beamDist2 = rotP2.y;
    float jet2 = exp(-beamWidth2 * beamWidth2 * 200.0);
    jet2 *= exp(-abs(beamDist2) * 2.5);
    jet2 *= smoothstep(0.0, 0.05, r);
    jet2 *= smoothstep(0.8, 0.0, r);

    float beamPulse2 = pow(max(0.0, cos(beamAngle * 2.0 + PI)), 8.0);
    jet2 *= 0.3 + 0.7 * beamPulse2;

    // Beam colors - slightly different for visual interest
    vec3 jet1Col = mix(vec3(0.4, 0.7, 1.0), vec3(0.8, 0.9, 1.0), beamPulse1);
    vec3 jet2Col = mix(vec3(0.3, 0.5, 0.9), vec3(0.7, 0.85, 1.0), beamPulse2);

    // Add jets with HDR brightness
    col += jet1Col * jet1 * 3.0;
    col += jet2Col * jet2 * 2.0;

    // ─── MAGNETOSPHERE ───
    // Toroidal magnetic field glow
    float magAngle = atan(p.y, p.x);
    float magTorus = exp(-pow(r - 0.15, 2.0) * 100.0);
    magTorus *= 0.5 + 0.5 * sin(magAngle * 4.0 + t * 3.0);
    col += purple * 0.15 * magTorus;

    // Soft magnetosphere halo
    col += teal * 0.12 * exp(-r * r * 120.0);

    return col * appear;
}

// ══════════════════════════════════════════════════════════════
// SHADER-BASED STARS - For gravitational lensing effects
// ══════════════════════════════════════════════════════════════

vec3 stars(vec2 p, float t, vec2 parallax) {
    vec3 col = vec3(0.0);

    // PERFORMANCE: Reduced layers (2 desktop, 1 mobile) with higher density
    float maxLayers = mobile > 0.5 ? 1.0 : 2.0;

    for (float layer = 0.0; layer < 2.0; layer++) {
        if (layer >= maxLayers) break;

        float pStr = 0.02 + layer * 0.03;
        float scale = 45.0 + layer * 50.0;
        float density = 0.038 - layer * 0.008;  // Increased base density

        vec2 sp = (p + parallax * pStr) * scale;
        vec2 id = floor(sp);
        vec2 f = fract(sp) - 0.5;
        float rnd = h(id + layer * 100.0);

        if (rnd > 1.0 - density) {
            float d = length(f);
            float core = exp(-d * d * 55.0);
            float halo = exp(-d * d * 15.0) * 0.2;

            // Gentle twinkle
            float twinkle = 0.6 + 0.4 * sin(t * (0.3 + rnd * 1.0) + rnd * TAU);

            // Color variation
            vec3 starCol = mix(vec3(0.9, 0.88, 0.85), vec3(0.85, 0.88, 0.95), rnd);
            if (rnd > 0.97) starCol = mix(starCol, vec3(1.0, 0.9, 0.8), 0.5); // Bright warm

            col += starCol * (core + halo) * twinkle * (0.6 + layer * 0.15);
        }
    }

    return col;
}

// ══════════════════════════════════════════════════════════════
// GRAVITATIONAL WAVES - Spacetime ripples from BH formation
// ══════════════════════════════════════════════════════════════

vec2 gravitationalWaves(vec2 uv, float t, float bhForm) {
    if (bhForm < 0.01) return vec2(0.0);

    float r = length(uv);
    float ang = atan(uv.y, uv.x);

    float waveStart = 12.0;
    float elapsed = t - waveStart;
    if (elapsed < 0.0) return vec2(0.0);

    vec2 totalOffset = vec2(0.0);

    // Initial burst during collapse
    float burstAge = elapsed;
    if (burstAge < 8.0) {
        float burstR = burstAge * 0.15;
        float burstW = 0.03 + burstAge * 0.02;

        float wave = sin((r - burstR) * 40.0 - burstAge * 3.0);
        wave *= exp(-pow((r - burstR) / burstW, 2.0));
        wave *= exp(-burstAge * 0.4);

        // Quadrupole pattern
        float hPlus = wave * cos(2.0 * ang);
        float hCross = wave * sin(2.0 * ang);

        float amplitude = 0.015 * bhForm;
        totalOffset += vec2(hPlus, hCross) * amplitude;
    }

    // Ringdown waves (QNM ringing)
    // PERFORMANCE: Reduced from 3 to 2 modes
    float ringdownStart = 4.0;
    float ringdownAge = elapsed - ringdownStart;
    if (ringdownAge > 0.0 && ringdownAge < 12.0) {
        for (float mode = 0.0; mode < 2.0; mode++) {
            float freq = 2.5 - mode * 0.6;
            float decay = 0.3 + mode * 0.15;
            float phase = mode * 1.5;

            float modeR = ringdownAge * (0.08 + mode * 0.03);
            float modeW = 0.025 + ringdownAge * 0.015;

            float wave = sin((r - modeR) * (30.0 - mode * 5.0) + phase);
            wave *= exp(-pow((r - modeR) / modeW, 2.0));
            wave *= exp(-ringdownAge * decay);
            wave *= (1.0 - mode * 0.3);

            float hPlus = wave * cos(2.0 * ang + mode);
            float hCross = wave * sin(2.0 * ang + mode);

            float amplitude = 0.008 * bhForm;
            totalOffset += vec2(hPlus, hCross) * amplitude;
        }
    }

    // Continuous subtle waves
    if (bhForm > 0.5) {
        float continuousWave = sin(r * 25.0 - t * 1.5) * 0.3;
        continuousWave += sin(r * 18.0 - t * 2.1 + 1.0) * 0.2;
        continuousWave *= exp(-r * 2.0);
        continuousWave *= (bhForm - 0.5) * 2.0;

        float hh = continuousWave * cos(2.0 * ang + t * 0.1);
        totalOffset += vec2(hh, hh * 0.5) * 0.003;
    }

    return totalOffset;
}

// Visible gravitational wave glow
// MOBILE: 2 waves instead of 4, optimized pow()
vec3 gravitationalWaveGlow(vec2 uv, float t, float bhForm) {
    if (bhForm < 0.01) return vec3(0.0);

    float r = length(uv);
    float elapsed = t - 12.0;
    if (elapsed < 0.0) return vec3(0.0);

    vec3 col = vec3(0.0);

    // Expanding wave fronts - MOBILE: 2 waves vs 4
    float maxWaves = mobile > 0.5 ? 2.0 : 4.0;
    for (float i = 0.0; i < 4.0; i++) {
        if (i >= maxWaves) break;

        float waveStart = i * 1.5;
        float waveAge = elapsed - waveStart;

        if (waveAge > 0.0 && waveAge < 10.0) {
            float waveR = waveAge * 0.12;
            float waveW = 0.015 + waveAge * 0.008;

            float delta = (r - waveR) / waveW;
            float wave = exp(-delta * delta);  // Optimized: no pow()
            wave *= exp(-waveAge * 0.35);
            wave *= smoothstep(0.0, 0.5, waveAge);

            vec3 waveCol = mix(purple, blue, 0.5) * 0.15;
            col += waveCol * wave * bhForm;
        }
    }

    return col;
}

// ══════════════════════════════════════════════════════════════
// GRAVITATIONAL LENSING - Light bending around black hole
// ══════════════════════════════════════════════════════════════

vec2 gravitationalLens(vec2 uv, float strength, float time) {
    if (strength < 0.001) return uv;

    float r = length(uv);
    if (r < 0.001) return uv;

    // Schwarzschild radius scaled down 50% for performance
    float rs = 0.04 * strength;
    float rPhoton = rs * 1.5;

    // Radial deflection
    float deflection = (rs * rs) / (r * r + rs * rs * 0.2);
    deflection *= 1.5;

    // Enhanced magnification near photon sphere
    float photonBoost = exp(-pow((r - rPhoton) / (rs * 0.6), 2.0)) * 0.8;
    deflection += photonBoost;

    // Frame dragging (Kerr black hole spin)
    float spin = 0.85;
    float frameDrag = spin * rs * rs / (r * r + rs * 0.15);
    float dragAngle = frameDrag * strength * (1.0 + 0.4 * sin(time * 0.15));

    vec2 dir = uv / r;

    // Rotate by frame-dragging
    float c = cos(dragAngle);
    float s = sin(dragAngle);
    vec2 rotatedDir = vec2(dir.x * c - dir.y * s, dir.x * s + dir.y * c);

    // Push coordinates outward
    vec2 lensedUV = uv + rotatedDir * deflection * r;

    // Event horizon collapse
    float horizonPull = smoothstep(rs * 2.0, rs * 0.8, r);
    lensedUV = mix(lensedUV, uv * 0.05, horizonPull * strength);

    // Tangential stretching
    float tangentStretch = 1.0 + (rs / (r + rs * 0.5)) * 0.6 * strength;
    float ang = atan(lensedUV.y, lensedUV.x);
    float newR = length(lensedUV);
    lensedUV = vec2(cos(ang), sin(ang)) * newR * tangentStretch;

    return lensedUV;
}

// Secondary lensing for Einstein ring ghost images
vec2 secondaryLens(vec2 uv, float strength) {
    if (strength < 0.01) return uv;

    float r = length(uv);
    float rs = 0.04 * strength;  // Scaled down 50%

    float wrapFactor = rs * rs / (r * r + rs * rs * 0.3);
    float ang = atan(uv.y, uv.x) + PI * wrapFactor * 2.5;
    float newR = r * (1.0 + wrapFactor);

    return vec2(cos(ang), sin(ang)) * newR;
}

// Tertiary lensing - even more wrapped light
vec2 tertiaryLens(vec2 uv, float strength) {
    if (strength < 0.1) return uv;

    float r = length(uv);
    float rs = 0.04 * strength;  // Scaled down 50%

    float wrapFactor = rs * rs / (r * r + rs * rs * 0.2);
    float ang = atan(uv.y, uv.x) + PI * 2.0 * wrapFactor * 3.0;
    float newR = r * (1.0 + wrapFactor * 1.5);

    return vec2(cos(ang), sin(ang)) * newR;
}

// ══════════════════════════════════════════════════════════════
// BLACK HOLE - Enhanced with Einstein ring and multiple photon rings
// ══════════════════════════════════════════════════════════════

vec3 blackhole(vec2 p, float t) {
    float r = length(p);
    float ang = atan(p.y, p.x);

    float form = smoothstep(16.0, 20.0, t);
    if (form < 0.01) return vec3(0.0);

    // Larger black hole for dramatic effect
    float rH = 0.08 * form;
    float rPhoton = rH * 1.5;

    vec3 col = vec3(0.0);

    // Shadow - larger and darker
    float shadow = smoothstep(rH * 0.85, rH * 1.8, r);

    // Photon ring - brighter shimmer
    float ringW = rH * 0.15;
    float ringDelta = (r - rPhoton) / ringW;
    float ring = exp(-ringDelta * ringDelta);
    float shimmer = 0.6 + 0.4 * sin(ang * 6.0 + t * 2.5);
    shimmer *= 0.8 + 0.2 * sin(ang * 13.0 - t * 1.8);
    col += mix(dust, rose, 0.4) * ring * shimmer * form * 0.7;

    // Accretion disk with Doppler
    float diskTilt = 0.38;
    // diskPrecess cos/sin pre-computed in JS and passed as uniform
    float ca = uDiskPrecess.x, sa = uDiskPrecess.y;
    vec2 diskP = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    diskP.y /= diskTilt;

    float diskR = length(diskP);
    float diskAng = atan(diskP.y, diskP.x);

    float diskInner = rH * 2.3;
    float diskOuter = rH * 7.5;
    float diskW = rH * 1.1;

    float diskDelta = (diskR - (diskInner + diskOuter) * 0.5) / diskW;
    float diskBand = exp(-diskDelta * diskDelta);
    diskBand *= smoothstep(diskInner * 0.9, diskInner * 1.2, diskR);
    diskBand *= smoothstep(diskOuter * 1.1, diskOuter * 0.8, diskR);

    // Doppler effect
    float doppler = 0.5 + 0.5 * cos(diskAng - 0.6);
    doppler = pow(doppler, 1.7);

    float turb = fbm2(vec2(diskAng * 4.0 + t * 0.2, diskR * 14.0));
    diskBand *= 0.45 + 0.55 * turb;

    float diskTemp = smoothstep(diskOuter, diskInner, diskR);
    vec3 diskCool = dust * 0.6;
    vec3 diskWarm = mix(rose, dust, 0.5);
    vec3 diskHot = mix(blue, teal, 0.4) * 1.2;

    vec3 diskCol = mix(diskCool, diskWarm, diskTemp);
    diskCol = mix(diskCol, diskHot, diskTemp * diskTemp);

    float diskMask = smoothstep(rH * 1.1, rH * 2.3, r);
    col += diskCol * diskBand * doppler * diskMask * form * 0.6;

    // Secondary lensed arc
    vec2 diskP2 = diskP;
    diskP2.y = abs(diskP2.y) + rH * 1.0;
    float diskR2 = length(diskP2);

    float secDelta = (diskR2 - (diskInner + diskOuter) * 0.5) / (diskW * 0.28);
    float secondaryBand = exp(-secDelta * secDelta);
    secondaryBand *= exp(-r * 7.0);
    secondaryBand *= smoothstep(rH * 1.0, rH * 1.9, r);

    col += diskCol * secondaryBand * form * 0.3;

    // Relativistic jets
    float jetW = rH * 0.2;
    float jetX = p.x / jetW;
    float jet = exp(-jetX * jetX) * exp(-abs(p.y) * 1.0);
    jet *= smoothstep(rH * 1.0, rH * 3.5, abs(p.y));
    col += blue * 0.5 * jet * form * 0.2;

    // Inner glow
    float innerDelta = r - rH * 1.15;
    float innerGlow = exp(-innerDelta * innerDelta * 90.0);
    innerGlow *= smoothstep(rH * 0.95, rH * 1.4, r);
    col += purple * 0.35 * innerGlow * form;

    // Event horizon
    float horizon = 1.0 - smoothstep(rH * 0.88, rH * 1.0, r);
    col *= (1.0 - horizon);
    col *= shadow;

    // Edge glow
    float edgeDelta = r - rH;
    float edgeGlow = exp(-edgeDelta * edgeDelta * 180.0) * (1.0 - horizon);
    col += purple * 0.3 * edgeGlow * form;

    // ─── EINSTEIN RING ───
    float einsteinR = rH * 2.8;
    float einsteinW = rH * 0.2;
    float einsteinDelta = (r - einsteinR) / einsteinW;
    float einstein = exp(-einsteinDelta * einsteinDelta);

    float ringVar = 0.6 + 0.4 * sin(ang * 2.0 + t * 0.4);
    ringVar *= 0.75 + 0.25 * sin(ang * 7.0 - t * 0.25);

    vec3 einsteinCol = mix(warmWhite, mix(dust, teal, 0.5), 0.25);
    einsteinCol = mix(einsteinCol, rose * 1.3, sin(ang + t * 0.15) * 0.35 + 0.35);

    col += einsteinCol * einstein * ringVar * form * 0.5;

    // ─── SECONDARY PHOTON RING ───
    float secondaryR = rH * 1.6;
    float secondaryW = rH * 0.08;
    float secRingDelta = (r - secondaryR) / secondaryW;
    float secondary = exp(-secRingDelta * secRingDelta);
    secondary *= 0.5 + 0.5 * sin(ang * 4.0 - t * 0.7);
    col += mix(blue, purple, 0.5) * secondary * form * 0.3;

    // ─── TERTIARY PHOTON RING ───
    float tertiaryR = rH * 1.25;
    float tertiaryW = rH * 0.04;
    float tertDelta = (r - tertiaryR) / tertiaryW;
    float tertiary = exp(-tertDelta * tertDelta);
    tertiary *= 0.6 + 0.4 * sin(ang * 5.0 + t * 0.5);
    col += teal * 0.8 * tertiary * form * 0.2;

    return col;
}

// ══════════════════════════════════════════════════════════════
// MAIN - Compose scene with iOS glass physics
// ══════════════════════════════════════════════════════════════

// Helper to sample stellar phenomena only (for compositing with separately-lensed background)
vec3 sampleSupernova(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    // Foreground stellar phenomena (not affected by BH lensing - they're "in front")
    col += progenitor(uv, t);
    col += explosion(uv, t);
    col += remnant(uv, t, age);

    if (fate < 0.5) {
        col += neutron(uv, t);
    } else {
        float bhAppear = smoothstep(16.0, 20.0, t);
        vec3 bh = blackhole(uv, t);
        col = mix(col, col + bh, bhAppear);
    }

    return col;
}

// Complete scene sample including background (for blur sampling through glass)
vec3 sampleSceneComplete(vec2 uv, float t) {
    vec2 m = (M / R) * 2.0 - 1.0;
    m.x *= R.x / R.y;
    vec2 parallax = m * 0.08;

    vec3 col = nebula(uv, t, parallax);
    col += stars(uv, t, parallax) * 0.3;
    col += sampleSupernova(uv, t);
    return col;
}

// ══════════════════════════════════════════════════════════════
// GAUSSIAN BLUR SIMULATION - iOS-style frosted glass
// ══════════════════════════════════════════════════════════════

vec3 sampleWithBlur(vec2 uv, float blurRadius) {
    // PERFORMANCE: Mobile uses NO blur (single sample) for maximum performance
    // Desktop uses 5-sample cross pattern
    if (mobile > 0.5) {
        // Single sample - no blur on mobile (blur simulated in CSS instead)
        return sampleSceneComplete(uv, T);
    }

    vec3 total = vec3(0.0);
    {
        // 5-sample cross pattern for desktop - was 9-sample Gaussian
        float weights[5];
        weights[0] = 0.4;   // center
        weights[1] = 0.15;  // up
        weights[2] = 0.15;  // down
        weights[3] = 0.15;  // left
        weights[4] = 0.15;  // right

        vec2 offsets[5];
        offsets[0] = vec2(0.0, 0.0);
        offsets[1] = vec2(0.0, -1.0);
        offsets[2] = vec2(0.0, 1.0);
        offsets[3] = vec2(-1.0, 0.0);
        offsets[4] = vec2(1.0, 0.0);

        for (int i = 0; i < 5; i++) {
            vec2 sampleUV = uv + offsets[i] * blurRadius * 0.004;
            vec3 s = sampleSceneComplete(sampleUV, T);
            total += s * weights[i];
        }
    }

    return total;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / R.y;
    vec2 screenUV = gl_FragCoord.xy / R;  // 0-1 screen coordinates

    // ═══ COSMIC PHENOMENA SCALE ═══
    // Scale factor for all stellar phenomena (progenitor, explosion, NS, BH)
    // 2.2 = 55% size reduction for performance optimization
    const float cosmicScale = 2.2;

    // Additional mobile scale adjustment
    float mobileScale = mobile > 0.5 ? 1.35 : 1.0;
    uv *= cosmicScale * mobileScale;

    vec2 m = (M / R) * 2.0 - 1.0;
    m.x *= R.x / R.y;
    vec2 parallax = m * 0.08;

    // Gentle drift
    uv += vec2(sin(T * 0.018), cos(T * 0.014)) * 0.008;

    // Subtle zoom during explosion
    float zoom = mix(1.04, 1.0, smoothstep(0.0, 12.0, T));
    uv *= zoom;

    // ═══ FLASH CALCULATION ═══
    float flash = smoothstep(9.8, 10.0, T) * (1.0 - smoothstep(10.0, 11.5, T));
    float screenFlash = smoothstep(9.9, 10.05, T) * (1.0 - smoothstep(10.05, 10.8, T));
    float totalFlash = flash + screenFlash;
    float flashLevel = smoothstep(9.5, 10.0, T) * (1.0 - smoothstep(10.0, 12.0, T));

    // ═══ BLACK HOLE GRAVITATIONAL EFFECTS ═══
    float bhFormation = 0.0;
    float lensStrength = 0.0;
    if (fate > 0.5) {
        bhFormation = smoothstep(12.0, 20.0, T);
        lensStrength = smoothstep(16.0, 24.0, T);
    }

    // Apply gravitational wave distortion to coordinates
    vec2 gwOffset = gravitationalWaves(uv, T, bhFormation);
    vec2 gwDistortedUV = uv + gwOffset;

    // ═══ iOS GLASS PHYSICS (THREE-TIER SYSTEM) ═══
    float lightIntensity = totalFlash * 2.0 + 0.5;
    GlassData glass = calculateGlassPhysics(screenUV, lightIntensity, flashLevel);

    vec3 col;

    if (glass.behindGlass > 0.01) {
        vec2 refractedUV = uv + glass.refractionOffset * 0.5;

        // ═══════════════════════════════════════════════════════════
        // TYPE 1: VIZ BOX - Light pooling effect
        // ═══════════════════════════════════════════════════════════
        if (glass.glassType > 0.5 && glass.glassType < 1.5) {
            // Sample with iOS-style blur for viz boxes
            float blurRadius = 2.0 + glass.poolGradient * 1.5;
            col = sampleWithBlur(refractedUV, blurRadius);

            // Chromatic aberration - skip extra samples on mobile or during BH phase
            if (mobile < 0.5 && bhFormation < 0.5) {
                float caStrength = glass.refraction * 0.015 * (1.0 + totalFlash * 0.5);
                vec2 caDir = normalize(glass.refractionOffset + vec2(0.001));
                vec3 colR = sampleSceneComplete(refractedUV + caDir * caStrength, T);
                vec3 colB = sampleSceneComplete(refractedUV - caDir * caStrength, T);
                col = vec3(colR.r, col.g, colB.b);
            } else if (bhFormation >= 0.5) {
                // Fake CA during BH phase (much cheaper than 2 extra samples)
                float caShift = 0.015 * (1.0 + totalFlash * 0.5);
                col.r *= 1.0 + caShift;
                col.b *= 1.0 - caShift * 0.5;
            }

            // Add flash
            col += warmWhite * flash * exp(-length(refractedUV) * 1.0) * 1.8;
            col += warmWhite * screenFlash * 1.0;

            // ═══ LIGHT POOLING ═══
            // Interior glow that concentrates light
            vec3 poolEffect = calculateLightPooling(
                screenUV, glass.boxCenter, glass.boxHalfSize,
                lightIntensity, flashLevel
            );
            col += poolEffect;

            // ═══ EDGE FOCUSING ═══
            // Caustic shimmer at edges where light "pours in"
            float caustic = sin(glass.focusingStrength * 25.0 + T * 1.5) * 0.5 + 0.5;
            col += teal * 0.12 * caustic * glass.focusingStrength;

            // Moderate frosting with saturation boost
            float luma = dot(col, vec3(0.3, 0.6, 0.1));
            float frostAmount = glass.glassOpacity * 0.35;
            col = mix(col, vec3(luma), frostAmount * 0.3);
            // Saturation boost to compensate (iOS style)
            col = mix(vec3(luma), col, 1.15);
            col *= mix(1.0, 0.5, glass.glassOpacity);

        // ═══════════════════════════════════════════════════════════
        // TYPE 2: TEXT BOX - Dramatic light warping
        // ═══════════════════════════════════════════════════════════
        } else if (glass.glassType > 1.5) {
            // Mobile: simplified rendering (single sample + flash)
            // Desktop: full chromatic aberration with color bleeding
            // Mobile or BH phase: simplified rendering (saves 3-5 samples)
            if (mobile > 0.5 || bhFormation >= 0.5) {
                // Simple sample with basic CA approximation
                col = sampleSceneComplete(refractedUV, T);
                // Fake CA by shifting color channels slightly
                float caShift = 0.02 * (1.0 + flashLevel * 2.0);
                col.r *= 1.0 + caShift;
                col.b *= 1.0 - caShift * 0.5;
            } else {
                // ═══ ENHANCED CHROMATIC ABERRATION ═══
                float caBase = 0.025;
                float caFlash = caBase * (1.0 + flashLevel * 4.0);
                float flutter = sin(T * 3.0) * 0.3 + sin(T * 7.0) * 0.15;
                caFlash *= (1.0 + flutter * flashLevel);

                vec2 caDir = normalize(glass.refractionOffset + vec2(0.001));
                vec3 colR = sampleSceneComplete(refractedUV + caDir * caFlash * 1.5, T);
                vec3 colG = sampleSceneComplete(refractedUV, T);
                vec3 colB = sampleSceneComplete(refractedUV - caDir * caFlash * 1.5, T);
                col = vec3(colR.r, colG.g, colB.b);

                // ═══ COLOR BLEEDING DURING FLASH ═══
                if (flashLevel > 0.1) {
                    vec3 bleed = vec3(0.0);
                    bleed.r = sampleSceneComplete(refractedUV + vec2(0.025, 0.0) * flashLevel, T).r;
                    bleed.b = sampleSceneComplete(refractedUV - vec2(0.025, 0.0) * flashLevel, T).b;
                    col = mix(col, bleed, flashLevel * 0.35);
                }
            }

            // Add flash with extra intensity
            col += warmWhite * flash * exp(-length(refractedUV) * 1.0) * 2.2;
            col += warmWhite * screenFlash * 1.3;

            // ═══ OBSCURATION LAYER ═══
            // Semi-transparent overlay during flash - "too bright to read" effect
            float obscure = glass.obscurationLevel;
            col = mix(col, warmWhite * 1.8, obscure * 0.4);

            // Frosting with saturation boost
            float luma = dot(col, vec3(0.3, 0.6, 0.1));
            float frostAmount = glass.glassOpacity * 0.4;
            vec3 frostedCol = mix(col, vec3(luma), frostAmount * 0.35);
            // Strong saturation boost (iOS style)
            frostedCol = mix(vec3(luma), frostedCol, 1.25);
            col = frostedCol;
            col *= mix(1.0, 0.4, glass.glassOpacity);

        // ═══════════════════════════════════════════════════════════
        // FALLBACK: Generic glass (shouldn't happen but safety net)
        // ═══════════════════════════════════════════════════════════
        } else {
            col = sampleSceneComplete(refractedUV, T);
            col += warmWhite * flash * exp(-length(refractedUV) * 1.2) * 1.5;
            col += warmWhite * screenFlash * 0.9;
        }

        // ═══ COMMON GLASS EFFECTS ═══
        // Internal light scattering
        float scatter = glass.behindGlass * (0.12 + totalFlash * 0.35);
        col += warmWhite * scatter * 0.12;

        // Specular highlight
        col += warmWhite * glass.specular * (1.0 + totalFlash * 2.5);

    } else {
        // ═══ OUTSIDE GLASS: Full intensity supernova with gravitational effects ═══

        // ═══ SHADER-BASED BACKGROUND WITH GRAVITATIONAL LENSING ═══
        // MOBILE: Skip ALL lensing (expensive sqrt, atan2, trig per pixel)
        if (lensStrength > 0.01 && mobile < 0.5) {
            // Desktop: full gravitational lensing
            vec2 lensedBgUV = gravitationalLens(gwDistortedUV, lensStrength, T);

            // Lensed nebula - warped by black hole gravity
            col = nebula(lensedBgUV, T, parallax) * (1.0 + lensStrength * 0.3);

            // Lensed stars
            col += stars(lensedBgUV, T, parallax) * 0.3;

            // Add secondary lensed ghost images (Einstein ring effect)
            if (lensStrength > 0.05) {
                vec2 secondaryUV = secondaryLens(gwDistortedUV, lensStrength * 0.7);
                float ringMask = smoothstep(0.06, 0.12, length(gwDistortedUV));
                ringMask *= smoothstep(0.25, 0.15, length(gwDistortedUV));
                col += stars(secondaryUV, T, parallax) * ringMask * 0.15;
                col += nebula(secondaryUV * 0.85, T, parallax) * ringMask * 0.1;
            }

            // Tertiary lensing for extreme cases (light orbited 2+ times)
            if (lensStrength > 0.3) {
                vec2 tertiaryUV = tertiaryLens(gwDistortedUV, lensStrength * 0.5);
                float innerRingMask = smoothstep(0.04, 0.08, length(gwDistortedUV));
                innerRingMask *= smoothstep(0.15, 0.10, length(gwDistortedUV));
                col += stars(tertiaryUV, T, parallax) * innerRingMask * 0.08;
            }
        } else {
            // Mobile OR no lensing: simple background with subtle darkening
            col = nebula(gwDistortedUV, T, parallax);
            col += stars(gwDistortedUV, T, parallax) * 0.3;

            // Mobile: fake BH effect with simple darkening at center
            if (mobile > 0.5 && lensStrength > 0.01) {
                float bhDarken = smoothstep(0.15, 0.02, length(gwDistortedUV));
                col *= 1.0 - bhDarken * lensStrength * 0.7;
            }
        }

        // Main supernova with GW distortion
        col += sampleSupernova(gwDistortedUV, T);

        // Gravitational wave glow rings
        if (bhFormation > 0.01) {
            col += gravitationalWaveGlow(gwDistortedUV, T, bhFormation);
        }

        // Flash effects
        col += warmWhite * flash * exp(-length(gwDistortedUV) * 1.2) * 1.5;
        col += warmWhite * screenFlash * 0.9;
    }

    // ═══ FRESNEL EDGE GLOW ═══
    vec3 fresnelColor = mix(warmWhite, vec3(0.9, 0.95, 1.0), 0.3);
    col += fresnelColor * glass.fresnel * (0.6 + totalFlash * 1.5);

    // ═══ BEVEL HIGHLIGHT ═══
    col += warmWhite * glass.edgeBevel * (0.4 + totalFlash * 0.8);

    // ═══ ALPHA CALCULATION ═══
    float intensity = length(col);
    float alpha = smoothstep(0.0, 0.1, intensity);

    alpha = max(alpha, screenFlash * 0.95);
    alpha = max(alpha, flash * 0.9);

    // Type-specific alpha adjustments
    if (glass.glassType > 0.5 && glass.glassType < 1.5) {
        // Viz boxes: keep light visible, moderate readability reduction
        alpha *= mix(1.0, 0.6, glass.behindGlass);
    } else if (glass.glassType > 1.5) {
        // Text boxes: allow dramatic obscuration during flash
        alpha *= mix(1.0, 0.45, glass.behindGlass * (1.0 - flashLevel * 0.3));
    } else {
        alpha *= mix(1.0, 0.5, glass.behindGlass);
    }

    alpha = max(alpha, glass.fresnel * 0.8);
    alpha = max(alpha, glass.edgeBevel * 0.9);

    // ═══ GRACEFUL FADEOUT (T 24-28) ═══
    // Smoothly fade everything to black during fadeout phase
    float fadeout = 1.0 - smoothstep(24.0, 28.0, T);
    col *= fadeout;
    alpha *= fadeout;

    // Tone mapping
    col = col / (0.8 + col);
    col = pow(col, vec3(0.42));

    gl_FragColor = vec4(col, alpha);
}
`;

const VERTEX_SHADER = `attribute vec2 p; void main() { gl_Position = vec4(p, 0, 1); }`;

export interface ContentBox {
    x: number;      // Left edge (0-1 normalized)
    y: number;      // Top edge (0-1 normalized)
    width: number;  // Width (0-1 normalized)
    height: number; // Height (0-1 normalized)
    opacity: number; // 0 = transparent, 1 = opaque
    boxType: number; // 0 = excluded, 1 = viz box (light pooling), 2 = text box (dramatic)
}

export interface WebGLSupernovaConfig {
    fate: number;  // 0 = neutron star, 1 = black hole
    onPhaseChange?: (phase: string, time: number) => void;
    onComplete?: () => void;
}

export interface WebGLSupernovaRenderer {
    start: () => void;
    stop: () => void;
    destroy: () => void;
    getTime: () => number;
    isRunning: () => boolean;
    updateContentBoxes: (boxes: ContentBox[]) => void;
}

// Timeline phases (in seconds)
export const WEBGL_PHASES = {
    progenitor: { start: 0, end: 10 },
    explosion: { start: 10, end: 12 },
    remnant: { start: 12, end: 16 },
    finalState: { start: 16, end: 24 },
    fadeout: { start: 24, end: 28 }
};

// Query DOM for content boxes with three-tier classification
// Type 0: EXCLUDED (nav) - no glass effects
// Type 1: VIZ BOXES - light pooling effect
// Type 2: TEXT BOXES - dramatic refraction/warping
function queryContentBoxes(): ContentBox[] {
    const boxes: ContentBox[] = [];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // ═══════════════════════════════════════════════════════════════
    // CONTENT BOX SYSTEM - DISABLED
    // ═══════════════════════════════════════════════════════════════
    // The original stardust reference had ONE glass pane.
    // Our page has MANY panels, which creates visual noise from
    // overlapping edge effects. Instead:
    // - WebGL renders the cosmic event (supernova, stars, GW lensing)
    // - CSS handles panel-level glass effects via .df-glass-active overlay system
    //
    // All selectors are empty to disable WebGL box effects.
    // The CSS system provides rim glow, backdrop-filter, etc.
    // ═══════════════════════════════════════════════════════════════

    const vizBoxSelectors: string[] = [];
    const structuralSelectors: string[] = [];
    const textBoxSelectors: string[] = [];

    // Query viz boxes (Type 1, highest priority)
    vizBoxSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < viewportHeight &&
                rect.right > 0 && rect.left < viewportWidth &&
                rect.width > 0 && rect.height > 0) {
                boxes.push({
                    x: rect.left / viewportWidth,
                    y: rect.top / viewportHeight,
                    width: rect.width / viewportWidth,
                    height: rect.height / viewportHeight,
                    opacity: 0.92,
                    boxType: 1  // VIZ BOX
                });
            }
        });
    });

    // Query structural elements (Type 1)
    structuralSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < viewportHeight &&
                rect.right > 0 && rect.left < viewportWidth &&
                rect.width > 0 && rect.height > 0) {
                // Avoid duplicates from viz boxes
                const isDuplicate = boxes.some(box =>
                    Math.abs(box.x - rect.left / viewportWidth) < 0.01 &&
                    Math.abs(box.y - rect.top / viewportHeight) < 0.01
                );
                if (!isDuplicate) {
                    boxes.push({
                        x: rect.left / viewportWidth,
                        y: rect.top / viewportHeight,
                        width: rect.width / viewportWidth,
                        height: rect.height / viewportHeight,
                        opacity: 0.85,
                        boxType: 1  // Structural as VIZ BOX type
                    });
                }
            }
        });
    });

    // Query text boxes (Type 2)
    textBoxSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            const htmlEl = el as HTMLElement;
            // PERFORMANCE: Using offsetHeight/offsetWidth instead of getComputedStyle
            if (htmlEl.offsetHeight === 0 || htmlEl.offsetWidth === 0) return;
            const rect = htmlEl.getBoundingClientRect();

            if (rect.height > 10 &&
                rect.bottom > 0 && rect.top < viewportHeight &&
                rect.right > 0 && rect.left < viewportWidth) {
                boxes.push({
                    x: rect.left / viewportWidth,
                    y: rect.top / viewportHeight,
                    width: rect.width / viewportWidth,
                    height: rect.height / viewportHeight,
                    opacity: 0.5,
                    boxType: 2  // TEXT BOX
                });
            }
        });
    });

    return boxes.slice(0, MAX_CONTENT_BOXES);
}

// The machine is built once and kept warm: context creation and the large
// fragment-shader compile used to happen at the moment of trigger — a visible
// hitch. Now the first build (ideally during idle prewarm) pays that cost,
// and every event after reuses the same canvas, context, and program.
let cachedRenderer: WebGLSupernovaRenderer | null = null;
let cachedRebind: ((c: WebGLSupernovaConfig) => void) | null = null;

/** Build (and warm) the renderer during idle time so the first real event is instant. */
export function prewarmWebGLSupernova(): void {
    if (cachedRenderer) return;
    createWebGLSupernova({ fate: 0 });
}

export function createWebGLSupernova(config: WebGLSupernovaConfig): WebGLSupernovaRenderer | null {
    if (cachedRenderer && cachedRebind) {
        cachedRebind(config);
        return cachedRenderer;
    }

    // Create canvas - positioned behind content
    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-supernova-canvas';
    canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.5s ease-out;
        mix-blend-mode: screen;
    `;
    document.body.appendChild(canvas);

    // Detect mobile early for WebGL context options
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                           (window.innerWidth < 768);

    // MOBILE OPTIMIZATION: Add body.mobile class for CSS overrides (like stardust)
    if (isMobileDevice) {
        document.body.classList.add('mobile');
    }

    // Get WebGL context with alpha for transparency
    // MOBILE OPTIMIZATION: powerPreference and desynchronized reduce latency
    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        powerPreference: isMobileDevice ? 'low-power' : 'high-performance',
        desynchronized: true  // Reduces input latency, especially on mobile
    });

    if (!gl) {
        console.error('WebGL not available');
        canvas.remove();
        return null;
    }

    // PERFORMANCE: Disable unused GL state
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Compile shaders WITHOUT querying status: a status query forces the
    // driver to finish compiling synchronously on this very frame. Failures
    // surface at link-finalization instead, where we can afford to look.
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
        canvas.remove();
        return null;
    }
    const vs = vertexShader;
    const fs = fragmentShader;
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);
    gl.shaderSource(fs, FRAGMENT_SHADER);
    gl.compileShader(fs);

    // Create program
    const program = gl.createProgram();
    if (!program) {
        canvas.remove();
        return null;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Deliberately NO LINK_STATUS query here: any program query forces the
    // main thread to wait for the (large) compile. With
    // KHR_parallel_shader_compile the driver links on background threads and
    // we poll; everything that must touch the linked program waits in
    // finalizeProgram().
    const parallelExt = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;

    // Create vertex buffer (fullscreen triangle) — independent of linking.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Use the early mobile detection (already set body.mobile class)
    const isMobile = isMobileDevice;

    // Uniform locations are resolved after the link completes.
    let uR: WebGLUniformLocation | null = null;
    let uT: WebGLUniformLocation | null = null;
    let uM: WebGLUniformLocation | null = null;
    let uFate: WebGLUniformLocation | null = null;
    let uAge: WebGLUniformLocation | null = null;
    let uMobile: WebGLUniformLocation | null = null;
    let uDiskPrecessLoc: WebGLUniformLocation | null = null;
    let uNumBoxes: WebGLUniformLocation | null = null;
    const uContentBoxes: WebGLUniformLocation[] = [];
    const uBoxOpacities: WebGLUniformLocation[] = [];
    const uBoxTypes: WebGLUniformLocation[] = [];

    let programReady = false;
    let programBroken = false;

    function finalizeProgram(): boolean {
        if (programReady) return true;
        if (programBroken) return false;

        if (!gl!.getProgramParameter(program!, gl!.LINK_STATUS)) {
            console.error('Program link error:', gl!.getProgramInfoLog(program!));
            console.error('VS log:', gl!.getShaderInfoLog(vs));
            console.error('FS log:', gl!.getShaderInfoLog(fs));
            programBroken = true;
            return false;
        }

        gl!.useProgram(program!);

        const pAttr = gl!.getAttribLocation(program!, 'p');
        gl!.enableVertexAttribArray(pAttr);
        gl!.vertexAttribPointer(pAttr, 2, gl!.FLOAT, false, 0, 0);

        uR = gl!.getUniformLocation(program!, 'R');
        uT = gl!.getUniformLocation(program!, 'T');
        uM = gl!.getUniformLocation(program!, 'M');
        uFate = gl!.getUniformLocation(program!, 'fate');
        uAge = gl!.getUniformLocation(program!, 'age');
        uMobile = gl!.getUniformLocation(program!, 'mobile');
        uDiskPrecessLoc = gl!.getUniformLocation(program!, 'uDiskPrecess');
        uNumBoxes = gl!.getUniformLocation(program!, 'numBoxes');

        for (let i = 0; i < MAX_CONTENT_BOXES; i++) {
            const boxLoc = gl!.getUniformLocation(program!, `contentBoxes[${i}]`);
            const opacityLoc = gl!.getUniformLocation(program!, `boxOpacities[${i}]`);
            const typeLoc = gl!.getUniformLocation(program!, `boxTypes[${i}]`);
            if (boxLoc) uContentBoxes.push(boxLoc);
            if (opacityLoc) uBoxOpacities.push(opacityLoc);
            if (typeLoc) uBoxTypes.push(typeLoc);
        }

        // One tiny hidden draw flushes any remaining lazy compile now.
        canvas.width = 8;
        canvas.height = 8;
        gl!.viewport(0, 0, 8, 8);
        gl!.uniform2f(uR, 8, 8);
        gl!.uniform1f(uT, 0.01);
        gl!.uniform2f(uM, 4, 4);
        gl!.uniform1f(uFate, 0);
        gl!.uniform1f(uAge, 0);
        gl!.uniform1f(uMobile, isMobile ? 1.0 : 0.0);
        gl!.uniform2f(uDiskPrecessLoc, 1, 0);
        gl!.uniform1i(uNumBoxes, 0);
        gl!.clearColor(0, 0, 0, 0);
        gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);

        programReady = true;
        return true;
    }

    // Poll for background link completion; finalize off the hot path.
    if (parallelExt) {
        const poll = () => {
            if (programReady || programBroken) return;
            if (gl!.getProgramParameter(program!, parallelExt.COMPLETION_STATUS_KHR)) {
                finalizeProgram();
            } else {
                window.setTimeout(poll, 120);
            }
        };
        window.setTimeout(poll, 120);
    } else {
        // No extension: finalize soon, but never on the construction frame.
        window.setTimeout(() => finalizeProgram(), 400);
    }

    // State
    let activeConfig: WebGLSupernovaConfig = config;
    let width = 0;
    let height = 0;
    let mouse = [0, 0];
    let smoothMouse = [0, 0];
    let startTime = 0;
    let running = false;
    let animationId: number | null = null;
    let lastPhase = '';
    let contentBoxes: ContentBox[] = [];
    let boxUpdateCounter = 0;

    // Store a guaranteed non-null reference for use in closures
    const glContext = gl;

    // ══════════════════════════════════════════════════════════════
    // DETERMINISTIC GLASS STATE
    // No canvas sampling - calculated from timeline phase
    // ══════════════════════════════════════════════════════════════
    let cssFrameCounter = 0;  // Frame counter for CSS update throttling

    // Smoothed values for glass physics
    let glassLum = 0;
    let glassImpulse = 0;
    let glassRGB = [180, 170, 200];
    let lightDir = [0, -0.7];

    // Supernova position tracking (for scroll-aware lighting)
    let supernovaScreenX = 0.5;  // Normalized screen position (0-1)
    let supernovaScreenY = 0.5;
    let scrollAtStart = 0;

    // Glass element cache - flag-based invalidation (fixes flickering on scroll)
    let glassElements: HTMLElement[] = [];
    let glassQueryStale = true;  // Start stale to force initial query

    // FLICKERING FIX: Cache stable rects for containers with animating children
    // Prevents layout thrashing from getBoundingClientRect during CSS animations
    const stableRects = new WeakMap<HTMLElement, DOMRect>();

    // CSS variable cache to avoid redundant DOM writes
    const cssCache: Map<HTMLElement, Map<string, string>> = new Map();

    // Utility functions
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smoothstep = (a: number, b: number, x: number) => {
        const t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
    };

    // Query glass elements (flag-based cache - invalidated on scroll)
    function queryGlassElements(): HTMLElement[] {
        // Return cached if not stale and we have elements
        if (!glassQueryStale && glassElements.length > 0) {
            return glassElements;
        }
        glassQueryStale = false;  // Mark as fresh

        // STYLED PANELS ONLY - elements with VISIBLE BACKGROUNDS
        // These get: rim effects (::before/::after), backdrop blur, BH/GW transforms
        // EXCLUDED (no visible background): .section-header, .closing, .verdict, etc.
        // NOTE: Target OUTER containers, not inner elements (prevents nested glass effects)

        // PERFORMANCE: Single combined selector instead of 13 separate queries
        // Changed: .credence-bar → .credence-dashboard (outer container)
        // Added: .mirror-section (outer container for mirror viz, blockquote, attribution)
        const PANEL_SELECTOR = '.collapsible-inner, blockquote, .card, .distinction-card, .equation-box, .interactive-box, .show-quote, .thought-experiment, .ascii-interactive, .credence-dashboard, .character-card, .hybrid-card, .attribution, .mirror-section';

        const elements: HTMLElement[] = [];
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        // PERFORMANCE: Single querySelectorAll with combined selector
        document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(el => {
            // Skip if hidden (offsetHeight/Width are 0 for display:none)
            if (el.offsetHeight === 0 || el.offsetWidth === 0) return;

            // Skip elements nested inside another panel element
            // This prevents the "taped on" look where inner elements get separate effects
            const hasGlassParent = el.parentElement?.closest(PANEL_SELECTOR);
            if (hasGlassParent) return;  // Parent will handle glass effects

            // FLICKERING FIX: For Glass Forest container, use aggressive caching
            // The inner animations cause layout thrashing - cache rect once and stick with it
            const isAsciiInteractive = el.classList.contains('ascii-interactive');
            const isGlassForestContainer = isAsciiInteractive &&
                el.querySelector('#glass-forest-container');

            let rect: DOMRect;
            // MOBILE OPTIMIZATION: Cache ALL rects on mobile (not just glass forest)
            // Mobile doesn't scroll/resize as dynamically, so cached rects are stable
            // This eliminates layout thrashing from getBoundingClientRect() calls
            if (isMobile && stableRects.has(el)) {
                // Mobile: ALWAYS use cached rect for all elements
                rect = stableRects.get(el)!;
            } else if (isGlassForestContainer && stableRects.has(el)) {
                // Glass Forest: ALWAYS use cached rect to prevent flicker
                rect = stableRects.get(el)!;
            } else {
                rect = el.getBoundingClientRect();
                // Cache rect for ascii-interactive containers OR all elements on mobile
                if (isAsciiInteractive || isMobile) {
                    stableRects.set(el, rect);
                }
            }

            if (rect.height > 10 &&
                rect.bottom > 0 && rect.top < viewportHeight &&
                rect.right > 0 && rect.left < viewportWidth) {
                elements.push(el);
            }
        });

        glassElements = elements;
        return elements;
    }

    // ═══════════════════════════════════════════════════════════════════
    // OVERLAY INJECTION SYSTEM
    // Dynamic injection of glass overlay divs (matching stardust architecture)
    // ═══════════════════════════════════════════════════════════════════

    // HTML template for glass overlay structure (8 effect layers)
    const GLASS_OVERLAY_HTML = `
<div class="df-glass-overlay">
    <div class="df-glass-bloom"></div>
    <div class="df-glass-flash"></div>
    <div class="df-glass-warm"></div>
    <div class="df-glass-nebula"></div>
    <div class="df-glass-edge"></div>
    <div class="df-glass-caustic"></div>
    <div class="df-glass-highlight"></div>
    <div class="df-glass-noise"></div>
</div>`;

    // Track elements that have received overlays (for cleanup)
    const overlayElements = new Set<HTMLElement>();

    // PERFORMANCE FIX: Bidirectional sync to prevent flickering
    // Synchronize overlays with current query results - removes stale, adds new
    function syncGlassOverlays(currentElements: HTMLElement[]): void {
        const currentSet = new Set(currentElements);

        // 1. REMOVE overlays from elements no longer in query (fixes flickering!)
        // HYSTERESIS: Don't remove from Glass Forest or animating containers
        overlayElements.forEach(element => {
            if (!currentSet.has(element)) {
                // Check if this is the Glass Forest container - NEVER remove its overlay
                const isAsciiInteractive = element.classList.contains('ascii-interactive');
                const isGlassForest = isAsciiInteractive &&
                    element.querySelector('#glass-forest-container');

                if (isGlassForest) {
                    // Glass Forest: Keep overlay unconditionally to prevent flicker
                    return; // Skip removal, element stays in overlayElements
                }

                // Check for other animating containers
                const hasAnimatingChildren = isAsciiInteractive &&
                    element.querySelector('.glass-node.firing, .glass-node.observing, .glass-node.dead, .glass-node.defector');

                if (hasAnimatingChildren) {
                    return; // Skip removal during animation
                }

                // Element left viewport or became hidden
                const overlay = element.querySelector('.df-glass-overlay');
                if (overlay) overlay.remove();
                element.classList.remove('df-glass-active', 'bh-active');
                cssCache.delete(element);  // Clear cached CSS vars
                overlayElements.delete(element);
            }
        });

        // 2. ADD overlays to new elements
        currentElements.forEach(element => {
            if (!overlayElements.has(element)) {
                element.classList.add('df-glass-active');
                element.insertAdjacentHTML('afterbegin', GLASS_OVERLAY_HTML);
                overlayElements.add(element);
            }
        });
    }

    // Toggle black hole active class based on phase
    function updateBlackHoleClass(elements: HTMLElement[], bhActive: boolean): void {
        elements.forEach(element => {
            element.classList.toggle('bh-active', bhActive);
        });
    }

    // Remove overlay divs from all tracked glass elements
    function removeGlassOverlays(): void {
        overlayElements.forEach(element => {
            // Remove overlay container
            const overlay = element.querySelector('.df-glass-overlay');
            if (overlay) overlay.remove();

            // Remove classes
            element.classList.remove('df-glass-active', 'bh-active');
        });

        overlayElements.clear();
    }

    // Set CSS variable with caching to avoid redundant DOM writes
    function setGlassVar(element: HTMLElement, name: string, value: string): void {
        let cache = cssCache.get(element);
        if (!cache) {
            cache = new Map();
            cssCache.set(element, cache);
        }
        if (cache.get(name) === value) return;
        cache.set(name, value);
        element.style.setProperty(name, value);
    }

    // ═══════════════════════════════════════════════════════════════════
    // DETERMINISTIC GLASS LIGHTING - No GPU readback stalls
    // Calculates expected luminance from timeline phase instead of sampling canvas
    // This eliminates readPixels which causes GPU→CPU sync stalls
    // ═══════════════════════════════════════════════════════════════════
    function updateGlassAdaptive(t: number): void {
        const elements = queryGlassElements();
        if (elements.length === 0) return;

        // ═══ DETERMINISTIC LUMINANCE FROM TIMELINE ═══
        // Matches stardust_merged approach - no readPixels!
        // MOBILE: Higher base luminance for visibility (pseudo-elements need stronger signal)
        const mobileLumBoost = isMobile ? 1.5 : 1.0;
        let targetLum = (isMobile ? 0.18 : 0.12);  // Higher base on mobile
        let impulse = 0;
        let tintR = 140, tintG = 130, tintB = 180;  // Default purple nebula tint

        // ─── PROGENITOR PHASE (T < 9.8) ───
        if (t < 9.8) {
            const inst = smoothstep(0, 9, t);
            // Star breathing pulse - boosted on mobile
            targetLum = (0.15 + 0.08 * Math.sin(t * (1.5 + inst * 3)) * (1 + inst)) * mobileLumBoost;
            // Warm tint from star
            const warmth = 0.3 + inst * 0.4;
            tintR = lerp(140, 255, warmth);
            tintG = lerp(130, 220, warmth);
            tintB = lerp(180, 180, warmth);

            // Instability flicker near end
            if (t > 8.0) {
                targetLum += 0.1 * Math.sin(t * 15) * (t - 8.0) / 1.8;
            }
        }
        // ─── THE FLASH (T 9.8 - 11.5) ───
        else if (t < 11.5) {
            const flashPeak = 10.0;
            const flash = Math.exp(-Math.pow((t - flashPeak) * 2.5, 2));
            targetLum = (0.15 + flash * 0.85) * mobileLumBoost;
            impulse = flash * (isMobile ? 1.3 : 1.0);  // Boost impulse on mobile for visibility
            // White flash
            tintR = lerp(180, 255, flash);
            tintG = lerp(160, 250, flash);
            tintB = lerp(200, 240, flash);
        }
        // ─── SHOCKWAVE & REMNANT (T 11.5 - 16) ───
        else if (t < 16) {
            const remnantGrow = smoothstep(12, 16, t);
            targetLum = (0.18 + remnantGrow * 0.12) * mobileLumBoost;
            // Nebula colors emerging
            tintR = lerp(200, 170, remnantGrow);
            tintG = lerp(180, 140, remnantGrow);
            tintB = lerp(220, 200, remnantGrow);
        }
        // ─── FINAL PHASE (T > 16) ───
        else {
            if (activeConfig.fate < 0.5) {
                // Neutron star - pulsar flashes
                const pulsarRate = 1.5;
                const pulse = 0.5 + 0.5 * Math.sin(t * pulsarRate * Math.PI * 2);
                targetLum = (0.15 + 0.15 * pulse) * mobileLumBoost;
                // Cool blue tint
                tintR = 100; tintG = 140; tintB = 200;
            } else {
                // Black hole - dark with occasional Einstein ring glint
                const bhForm = smoothstep(16, 20, t);
                targetLum = (0.12 * (1 - bhForm * 0.5)) * mobileLumBoost;
                // Occasional ring glint - boosted on mobile
                targetLum += 0.08 * Math.pow(Math.sin(t * 0.8), 4) * bhForm * mobileLumBoost;
                // Dark with warm accretion tint
                tintR = lerp(140, 180, bhForm * Math.sin(t * 0.3) * 0.5 + 0.5);
                tintG = lerp(130, 120, bhForm);
                tintB = lerp(180, 140, bhForm);
            }
        }

        // ─── SMOOTH TRANSITIONS ───
        glassLum += (targetLum - glassLum) * 0.12;
        glassImpulse += (impulse - glassImpulse) * 0.2;
        glassRGB[0] += (tintR - glassRGB[0]) * 0.08;
        glassRGB[1] += (tintG - glassRGB[1]) * 0.08;
        glassRGB[2] += (tintB - glassRGB[2]) * 0.08;

        const imp = clamp01(glassImpulse * 3);

        // ─── DETERMINISTIC LIGHT DIRECTION ───
        // Point toward supernova during event, shift to BH during that phase
        const scrollDelta = window.scrollY - scrollAtStart;
        const supernovaY = supernovaScreenY - scrollDelta / window.innerHeight;

        if (t > 9.5 && t < 45 && elements.length > 0) {
            const primary = elements[0];
            const rect = primary.getBoundingClientRect();
            const elemCenterX = (rect.left + rect.width * 0.5) / window.innerWidth;
            const elemCenterY = (rect.top + rect.height * 0.5) / window.innerHeight;

            // Direction from primary element toward supernova
            const dx = supernovaScreenX - elemCenterX;
            const dy = supernovaY - elemCenterY;
            const mag = Math.hypot(dx, dy);

            if (mag > 0.02) {
                const blendStrength = glassLum * 0.8;
                lightDir[0] = lerp(lightDir[0], dx / mag, blendStrength);
                lightDir[1] = lerp(lightDir[1], -dy / mag, blendStrength);
            }
        }

        // ─── BLACK HOLE GRAVITATIONAL EFFECTS ───
        let bhStrength = 0;
        let bhRedshift = 0;
        let gwIntensity = 0;
        let gwPhase = 0;

        if (activeConfig.fate > 0.5 && t > 12) {
            // BH forms at T=16, strength builds
            bhStrength = smoothstep(16, 36, t);
            bhStrength *= 1.0 + 0.1 * Math.sin(t * 0.15);

            // Redshift increases with proximity
            bhRedshift = bhStrength * (0.5 + glassLum * 0.5);

            // Light direction shifts toward BH (center/up)
            const bhLightInfluence = bhStrength * 0.6;
            lightDir[0] += (0 - lightDir[0]) * bhLightInfluence * 0.1;
            lightDir[1] += (-0.8 - lightDir[1]) * bhLightInfluence * 0.1;

            // ─── GRAVITATIONAL WAVES (OPTIMIZED) ───
            // Pre-computed wave parameters: [delay, decay, scale]
            const gwElapsed = t - 12;  // gwStart = 12

            if (gwElapsed > 0 && gwElapsed < 16) {  // gwEnd - gwStart = 28 - 12 = 16
                // PERFORMANCE: Pre-computed wave params instead of calculating in loop
                // Each wave: [delay, decay, intensityScale]
                const waves = [
                    [0,   0.4, 1.00],  // Wave 0
                    [1.8, 0.5, 0.85],  // Wave 1
                    [3.6, 0.6, 0.70],  // Wave 2
                    [5.4, 0.7, 0.55],  // Wave 3
                    [7.2, 0.8, 0.40],  // Wave 4
                ];
                const wavePeak = 1.5;
                let totalIntensity = 0;

                for (let i = 0; i < 5; i++) {
                    const waveAge = gwElapsed - waves[i][0];
                    if (waveAge > 0 && waveAge < 8) {
                        const intensity = waveAge < wavePeak
                            ? smoothstep(0, wavePeak, waveAge)
                            : Math.exp(-(waveAge - wavePeak) * waves[i][1]);
                        totalIntensity += intensity * waves[i][2];
                    }
                }

                gwIntensity = clamp01(totalIntensity * 0.5) * smoothstep(12, 16, t);
                gwPhase = (Math.sin(gwElapsed * 0.8) * 0.5 + 0.5) * gwIntensity;
            }
        }

        // ─── ADAPTIVE TEXT COLORS ───
        // Dark bg → light text, Bright bg → dark text (like stardust)
        const tMix = smoothstep(0.25, 0.7, glassLum);

        const mainR = Math.round(lerp(255, 20, tMix));
        const mainG = Math.round(lerp(255, 18, tMix));
        const mainB = Math.round(lerp(255, 25, tMix));
        const mainA = lerp(0.9, 0.95, tMix);

        const bodyR = Math.round(lerp(255, 35, tMix));
        const bodyG = Math.round(lerp(255, 32, tMix));
        const bodyB = Math.round(lerp(255, 42, tMix));
        const bodyA = lerp(0.8, 0.9, tMix);

        const muteR = Math.round(lerp(200, 70, tMix));
        const muteG = Math.round(lerp(195, 68, tMix));
        const muteB = Math.round(lerp(210, 80, tMix));
        const muteA = lerp(0.7, 0.8, tMix);

        // ─── DIRECTIONAL SHADOWS ───
        // Shadow casts AWAY from light source
        const shadowMag = 1 + glassLum * 4 + imp * 3;
        const sx = -lightDir[0] * shadowMag;
        const sy = -lightDir[1] * shadowMag;
        const shadowBlur = 6 + glassLum * 8 + imp * 4;
        const shadowAlpha = 0.25 + glassLum * 0.4 + imp * 0.15;

        // ─── DYNAMIC BORDER ───
        // Border glows with sampled color during flash
        const borderR = Math.round(200 + glassLum * 55);
        const borderG = Math.round(195 + glassLum * 60);
        const borderB = Math.round(215 + glassLum * 40);
        const borderA = 0.08 + glassLum * 0.4;

        // ─── SYNC OVERLAYS (bidirectional - fixes flickering) ───
        syncGlassOverlays(elements);

        // ─── TOGGLE BLACK HOLE CLASS ───
        // BH phase starts at t>16 with fate>0.5
        const bhPhaseActive = t > 16 && bhStrength > 0.1;
        updateBlackHoleClass(elements, bhPhaseActive);

        // ─── PERFORMANCE: PRE-COMPUTE ALL FORMATTED STRINGS ONCE ───
        // Avoids 18+ toFixed() calls per element per frame (reduces GC pressure)
        const fmt = {
            lum: String(Math.round(glassLum * 1000) / 1000),
            impulse: String(Math.round(imp * 1000) / 1000),
            tintR: String(Math.round(glassRGB[0])),
            tintG: String(Math.round(glassRGB[1])),
            tintB: String(Math.round(glassRGB[2])),
            lightX: String(Math.round(lightDir[0] * 1000) / 1000),
            lightY: String(Math.round(lightDir[1] * 1000) / 1000),
            textMain: `rgba(${mainR},${mainG},${mainB},${Math.round(mainA * 100) / 100})`,
            textBody: `rgba(${bodyR},${bodyG},${bodyB},${Math.round(bodyA * 100) / 100})`,
            textMute: `rgba(${muteR},${muteG},${muteB},${Math.round(muteA * 100) / 100})`,
            shadowX: `${Math.round(sx * 10) / 10}px`,
            shadowY: `${Math.round(sy * 10) / 10}px`,
            shadowBlur: `${Math.round(shadowBlur * 10) / 10}px`,
            shadowA: String(Math.round(shadowAlpha * 1000) / 1000),
            borderColor: `rgba(${borderR},${borderG},${borderB},${Math.round(borderA * 100) / 100})`,
            bhStrength: String(Math.round(bhStrength * 10000) / 10000),
            bhRedshift: String(Math.round(bhRedshift * 10000) / 10000),
            gwIntensity: String(Math.round(gwIntensity * 10000) / 10000),
            gwPhase: String(Math.round(gwPhase * 10000) / 10000),
        };

        // ─── SET GLOBAL BH/GW VARS ON :root (identical for all elements) ───
        const root = document.documentElement;
        root.style.setProperty('--bh-strength', fmt.bhStrength);
        root.style.setProperty('--bh-redshift', fmt.bhRedshift);
        root.style.setProperty('--gw-intensity', fmt.gwIntensity);
        root.style.setProperty('--gw-phase', fmt.gwPhase);

        // ─── UPDATE CSS VARIABLES ON ALL GLASS ELEMENTS ───
        // PERFORMANCE: During BH phase, update CSS every 3rd frame (50% reduction)
        // During non-BH, update every 2nd frame (matches typical 30fps visual update rate)
        cssFrameCounter++;
        const cssUpdateInterval = bhPhaseActive ? 3 : 2;
        const shouldUpdateCSS = (cssFrameCounter % cssUpdateInterval) === 0;

        elements.forEach(element => {
            // Always sync lum/impulse for responsiveness, throttle others during BH
            setGlassVar(element, '--lum', fmt.lum);
            setGlassVar(element, '--impulse', fmt.impulse);

            // MOBILE OPTIMIZATION: Only update critical 3 vars (lum, impulse, bh-strength)
            // Mobile pseudo-elements only use these vars, skip all others to reduce DOM writes by 80%
            if (isMobile) return;

            // Skip non-critical updates during BH phase to reduce DOM writes
            if (!shouldUpdateCSS && bhPhaseActive) return;

            // Sampled tint color
            setGlassVar(element, '--tint-r', fmt.tintR);
            setGlassVar(element, '--tint-g', fmt.tintG);
            setGlassVar(element, '--tint-b', fmt.tintB);

            // Light direction
            setGlassVar(element, '--light-x', fmt.lightX);
            setGlassVar(element, '--light-y', fmt.lightY);

            // Adaptive text colors
            setGlassVar(element, '--text-main', fmt.textMain);
            setGlassVar(element, '--text-body', fmt.textBody);
            setGlassVar(element, '--text-mute', fmt.textMute);

            // Directional shadows
            setGlassVar(element, '--shadow-x', fmt.shadowX);
            setGlassVar(element, '--shadow-y', fmt.shadowY);
            setGlassVar(element, '--shadow-blur', fmt.shadowBlur);
            setGlassVar(element, '--shadow-a', fmt.shadowA);

            // Dynamic border
            setGlassVar(element, '--border-color', fmt.borderColor);
        });
    }

    // Clear glass CSS variables and remove overlays when effect ends
    function clearGlassEffects(): void {
        // Remove overlay divs and classes
        removeGlassOverlays();

        // Reset all CSS variables
        glassElements.forEach(element => {
            element.style.removeProperty('--lum');
            element.style.removeProperty('--impulse');
            element.style.removeProperty('--tint-r');
            element.style.removeProperty('--tint-g');
            element.style.removeProperty('--tint-b');
            element.style.removeProperty('--light-x');
            element.style.removeProperty('--light-y');
            element.style.removeProperty('--text-main');
            element.style.removeProperty('--text-body');
            element.style.removeProperty('--text-mute');
            element.style.removeProperty('--shadow-x');
            element.style.removeProperty('--shadow-y');
            element.style.removeProperty('--shadow-blur');
            element.style.removeProperty('--shadow-a');
            element.style.removeProperty('--border-color');
            element.style.removeProperty('--bh-strength');
            element.style.removeProperty('--bh-redshift');
            element.style.removeProperty('--gw-intensity');
            element.style.removeProperty('--gw-phase');
        });
        cssCache.clear();
        glassElements = [];
    }

    function updateContentBoxes(boxes: ContentBox[]) {
        contentBoxes = boxes.slice(0, MAX_CONTENT_BOXES);
    }

    function resize() {
        // Lower DPR cap on mobile for better performance
        // MOBILE OPTIMIZATION: More aggressive DPR reduction for smaller screens
        let maxDpr = 1.5;
        if (isMobile) {
            if (window.innerWidth < 400) {
                maxDpr = 0.6;  // Very small screens (SE, mini)
            } else if (window.innerWidth < 500) {
                maxDpr = 0.75;  // Small phones
            } else {
                maxDpr = 1.0;  // Normal phones
            }
        }
        const dpr = Math.min(maxDpr, window.devicePixelRatio);
        width = Math.floor(window.innerWidth * dpr);
        height = Math.floor(window.innerHeight * dpr);
        canvas.width = width;
        canvas.height = height;
        glContext.viewport(0, 0, width, height);

        if (smoothMouse[0] === 0) {
            smoothMouse[0] = mouse[0] = width / 2;
            smoothMouse[1] = mouse[1] = height / 2;
        }

        // Invalidate glass cache on resize (mobile orientation changes)
        glassQueryStale = true;

        // Clear stableRects cache - rects are invalid after resize
        // WeakMap doesn't have clear(), but setting new instance is fine
        // since the old elements may have moved/resized
        glassElements.forEach(el => stableRects.delete(el));

        // Update content boxes on resize
        contentBoxes = queryContentBoxes();
    }

    function handleMouseMove(e: MouseEvent) {
        const sx = width / window.innerWidth;
        const sy = height / window.innerHeight;
        mouse[0] = e.clientX * sx;
        mouse[1] = (window.innerHeight - e.clientY) * sy;
    }

    // PERFORMANCE: Debounced scroll handler to reduce DOM queries
    let scrollTimeout: number | undefined;
    function handleScroll() {
        // Immediately invalidate glass cache (fixes flickering on scroll)
        glassQueryStale = true;

        // Debounce content box updates
        if (scrollTimeout !== undefined) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = window.setTimeout(() => {
            contentBoxes = queryContentBoxes();
        }, 100);  // 100ms debounce
    }

    function getTime(): number {
        if (!running) return 0;
        return (performance.now() - startTime) / 1000;
    }

    function getCurrentPhase(t: number): string {
        if (t < WEBGL_PHASES.progenitor.end) return 'progenitor';
        if (t < WEBGL_PHASES.explosion.end) return 'explosion';
        if (t < WEBGL_PHASES.remnant.end) return 'remnant';
        if (t < WEBGL_PHASES.finalState.end) return activeConfig.fate > 0.5 ? 'blackhole' : 'neutron';
        if (t < WEBGL_PHASES.fadeout.end) return 'fadeout';
        return 'complete';
    }

    function render() {
        if (!running) return;

        // Smooth mouse movement
        smoothMouse[0] += (mouse[0] - smoothMouse[0]) * 0.05;
        smoothMouse[1] += (mouse[1] - smoothMouse[1]) * 0.05;

        const t = getTime();

        // Check phase changes
        const currentPhase = getCurrentPhase(t);
        if (currentPhase !== lastPhase) {
            lastPhase = currentPhase;
            activeConfig.onPhaseChange?.(currentPhase, t);

            if (currentPhase === 'complete') {
                stop();
                activeConfig.onComplete?.();
                return;
            }
        }

        // Periodically update content boxes (every 10 frames)
        boxUpdateCounter++;
        if (boxUpdateCounter % 10 === 0) {
            contentBoxes = queryContentBoxes();
        }

        // Update uniforms
        glContext.uniform2f(uR, width, height);
        glContext.uniform1f(uT, t);
        glContext.uniform2f(uM, smoothMouse[0], smoothMouse[1]);
        glContext.uniform1f(uFate, activeConfig.fate);
        glContext.uniform1f(uAge, 0);
        glContext.uniform1f(uMobile, isMobile ? 1.0 : 0.0);
        // Pre-compute disk precession trig (was per-pixel, now once per frame)
        const diskPrecess = 0.5 + 0.08 * Math.sin(t * 0.12);
        glContext.uniform2f(uDiskPrecessLoc, Math.cos(diskPrecess), Math.sin(diskPrecess));
        glContext.uniform1i(uNumBoxes, contentBoxes.length);

        // Update content box uniforms (with three-tier system)
        for (let i = 0; i < MAX_CONTENT_BOXES; i++) {
            if (i < contentBoxes.length) {
                const box = contentBoxes[i];
                // Convert to shader coordinates (flip Y)
                glContext.uniform4f(
                    uContentBoxes[i],
                    box.x,
                    1.0 - box.y - box.height,  // Flip Y
                    box.width,
                    box.height
                );
                glContext.uniform1f(uBoxOpacities[i], box.opacity);
                glContext.uniform1f(uBoxTypes[i], box.boxType);  // 0=excluded, 1=viz, 2=text
            } else {
                glContext.uniform4f(uContentBoxes[i], 0, 0, 0, 0);
                glContext.uniform1f(uBoxOpacities[i], 0);
                glContext.uniform1f(uBoxTypes[i], 0);  // Excluded by default
            }
        }

        // Clear with transparency
        glContext.clearColor(0, 0, 0, 0);
        glContext.clear(glContext.COLOR_BUFFER_BIT);
        glContext.drawArrays(glContext.TRIANGLES, 0, 3);

        // Update glass elements with adaptive lighting
        // PERFORMANCE: Mobile updates every 3rd frame (20fps visual), desktop every frame
        const glassUpdateInterval = isMobile ? 3 : 1;
        if (boxUpdateCounter % glassUpdateInterval === 0) {
            updateGlassAdaptive(t);
        }

        animationId = requestAnimationFrame(render);
    }

    function start() {
        if (running) return;

        // If an event fires before the background link finished, finalize now
        // (a rare synchronous wait); if the program is broken, exit cleanly.
        if (!finalizeProgram()) {
            activeConfig.onComplete?.();
            return;
        }

        canvas.style.display = 'block';
        running = true;
        startTime = performance.now();
        lastPhase = '';
        boxUpdateCounter = 0;

        // Initialize scroll-aware supernova position
        scrollAtStart = window.scrollY;
        // Supernova spawns at center of viewport
        supernovaScreenX = 0.5;
        supernovaScreenY = 0.5;

        // Reset glass state
        glassLum = 0;
        glassImpulse = 0;
        glassRGB = [180, 170, 200];
        lightDir = [0, -0.7];

        // Reset overlay injection state
        overlayElements.clear();

        resize();
        contentBoxes = queryContentBoxes();

        window.addEventListener('resize', resize);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('scroll', handleScroll, { passive: true });

        // Start cosmic audio (synced with visual)
        startCosmicAudio(activeConfig.fate);

        // Fade in
        requestAnimationFrame(() => {
            canvas.style.opacity = '1';
        });

        render();
    }

    function stop() {
        running = false;

        if (animationId !== null) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        window.removeEventListener('resize', resize);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('scroll', handleScroll);

        // Stop cosmic audio
        stopCosmicAudio();

        // Clean up glass effects
        clearGlassEffects();

        // Fade out
        canvas.style.opacity = '0';
    }

    function destroy() {
        stop();

        // The machine stays warm for the next event: program, buffers and
        // canvas all survive. Only the compositor layer is released.
        setTimeout(() => {
            if (!running) canvas.style.display = 'none';
        }, 600);
    }

    canvas.style.display = 'none';

    const renderer: WebGLSupernovaRenderer = {
        start,
        stop,
        destroy,
        getTime,
        isRunning: () => running,
        updateContentBoxes
    };
    cachedRenderer = renderer;
    cachedRebind = (c) => { activeConfig = c; };
    return renderer;
}
