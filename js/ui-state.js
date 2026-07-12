/* ============================================================
   VaaniAI · ui-state.js
   Reflects the pipeline stage (idle / listening / thinking /
   speaking) on the avatar frame via CSS classes. This replaced
   the old avatar.js after the 3D VRM tier was retired in favour
   of the photorealistic D-ID video avatar.
   ============================================================ */

const stage = document.getElementById("stage");

export function setState(state) {
  stage.classList.remove("listening", "thinking", "speaking");
  if (state !== "idle") stage.classList.add(state);
}
