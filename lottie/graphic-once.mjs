// Lottie Player (play once) - OGraf web component, stepCount 0
// Same player as graphic.mjs, fixed to "play once, then clear": playAction resolves when the screen is clear,
// with currentStep undefined, so the renderer knows the graphic has ended.
import LottiePlayer from "./graphic.mjs";

export default class LottiePlayerOnce extends LottiePlayer {
  _mode() { return "once-clear"; }
}
