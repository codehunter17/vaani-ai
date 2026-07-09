/* ============================================================
   VaaniAI · avatar.js
   Two-tier avatar:
   1. VRM 3D head (three.js + @pixiv/three-vrm) — framed head to
      neck, lip-synced via the model's own 'aa' viseme blendshape,
      with blinking and idle micro-motion.
   2. SVG vector face — instant fallback shown until the VRM is
      ready, and permanently if WebGL/CDN/model loading fails.
   Public API is identical either way:
   setState / startTalking / wordBeat / stopTalking / initVRMAvatar
   ============================================================ */

const MOUTH = {
  closed: "M86 126 Q100 132 114 126 Q100 134 86 126 Z",
  mid:    "M86 124 Q100 136 114 124 Q100 140 86 124 Z",
  open:   "M88 121 Q100 121 112 121 Q112 138 100 141 Q88 138 88 121 Z",
};

const stage = document.getElementById("stage");
const disc  = stage.querySelector(".avatar-disc");
const svg   = disc.querySelector("svg");
const mouth = document.getElementById("mouth");
const pill  = document.getElementById("pipelinePill");

let mouthTimer = null;

/* ---- VRM state ---- */
let vrmActive = false;
let vrm = null;
let mouthTarget = 0;     // 0..1, smoothed toward in the render loop
let currentState = "idle";

export function setState(state) {
  currentState = state;
  stage.classList.remove("listening", "thinking", "speaking");
  if (state !== "idle") stage.classList.add(state);
  pill.textContent = state;
  pill.className = "pill" + (state === "listening" || state === "speaking" ? " live" : "");
}

export function startTalking() {
  stopTalking();
  mouthTimer = setInterval(() => {
    const r = Math.random();
    if (vrmActive) {
      mouthTarget = r < 0.3 ? 0.05 : r < 0.65 ? 0.45 : 0.9;
    } else {
      mouth.setAttribute("d", r < 0.34 ? MOUTH.closed : r < 0.7 ? MOUTH.mid : MOUTH.open);
    }
  }, 90);
}

export function wordBeat() {
  if (vrmActive) mouthTarget = Math.random() < 0.5 ? 0.6 : 1.0;
  else mouth.setAttribute("d", Math.random() < 0.5 ? MOUTH.mid : MOUTH.open);
}

export function stopTalking() {
  clearInterval(mouthTimer);
  mouthTimer = null;
  mouthTarget = 0;
  mouth.setAttribute("d", MOUTH.closed);
}

/* ------------------------------------------------------------
   VRM loader — progressive enhancement, never blocks the app.
   ------------------------------------------------------------ */
export async function initVRMAvatar(url) {
  try {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { VRMLoaderPlugin, VRMUtils } = await import("@pixiv/three-vrm");

    const size = disc.clientWidth || 180;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xfff3e0, 1.1);
    key.position.set(0.4, 1.2, 1.5);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(18, 1, 0.05, 20);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    VRMUtils.rotateVRM0(vrm);            // VRM 0.x models face away by default
    scene.add(vrm.scene);
    vrm.scene.updateMatrixWorld(true);

    /* Frame head to neck using the model's real bounding box —
       bone distances vary wildly between VRM models, but
       "neck to crown of the bounding box" is reliable. */
    const headBone = vrm.humanoid.getNormalizedBoneNode("head");
    const neckBone = vrm.humanoid.getNormalizedBoneNode("neck") || headBone;
    const hp = new THREE.Vector3(); headBone.getWorldPosition(hp);
    const np = new THREE.Vector3(); neckBone.getWorldPosition(np);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const crownY = box.max.y;                              // top of the head incl. hair
    const bodyH = Math.max(box.max.y - box.min.y, 0.5);
    const frameH = Math.max(crownY - np.y, bodyH * 0.12) * 1.35;  // neck→crown + margin
    const cy = (crownY + np.y) / 2;                        // vertical centre of the head
    const dist = (frameH / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    camera.position.set(hp.x, cy, hp.z + dist);
    camera.lookAt(hp.x, cy, hp.z);

    /* Swap: hide vector face, show 3D head */
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    svg.style.display = "none";
    disc.appendChild(renderer.domElement);
    vrmActive = true;

    /* ---- animation loop: mouth smoothing, blink, idle sway ---- */
    const clock = new THREE.Clock();
    const expr = vrm.expressionManager;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let mouthNow = 0, blinkNow = 0, nextBlink = 2 + Math.random() * 3, t = 0;

    function setExpr(name, v) { try { expr && expr.setValue(name, v); } catch (_) {} }

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;

      /* lip sync: chase the target the TTS cadence sets */
      mouthNow += (mouthTarget - mouthNow) * Math.min(1, dt * 18);
      setExpr("aa", mouthNow);

      /* blink every 2–5 s */
      nextBlink -= dt;
      if (nextBlink <= 0) { blinkNow = 1; nextBlink = 2 + Math.random() * 3; }
      blinkNow = Math.max(0, blinkNow - dt * 9);
      setExpr("blink", Math.min(1, blinkNow * 1.4));

      /* idle micro-motion; a touch livelier while speaking */
      if (!reduceMotion && headBone) {
        const amp = currentState === "speaking" ? 0.045 : 0.02;
        headBone.rotation.y = Math.sin(t * 0.9) * amp;
        headBone.rotation.x = Math.sin(t * 1.3 + 1) * amp * 0.6;
      }

      vrm.update(dt);
      renderer.render(scene, camera);
    });

    return true;
  } catch (err) {
    /* CDN down, WebGL missing, model failed — vector avatar stays */
    console.warn("VRM avatar unavailable, using vector fallback:", err);
    return false;
  }
}
