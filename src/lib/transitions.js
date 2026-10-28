// Native View Transition helpers, shared by nav links and the ⌘K palette.
//
// Runs navigation inside document.startViewTransition when the browser
// supports it (and the user hasn't asked for reduced motion). Uses the
// standard preventDefault()-then-navigate() contract that Link already
// honors, so it works regardless of react-router-dom's exact version.

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Navigate with a view transition if available, plain navigate otherwise.
export function startViewTransition(navigate, to) {
  if (document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(() => navigate(to));
  } else {
    navigate(to);
  }
}
