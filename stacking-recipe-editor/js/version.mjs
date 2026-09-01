// version.mjs — one version number for the editor and every page beside it.
//
// nests.html shows the same version as the recipe editor so a screenshot is
// enough to tell which build someone is on (Zac 2026-08-18). index.html keeps
// its own inline const because its script is not a module; the test suite
// asserts the two match, so drift fails CI instead of quietly showing the
// wrong number on one screen.
export const APP_VERSION = '4.02';
