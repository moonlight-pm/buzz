/**
 * Display-only Moonlight release label.
 *
 * Updater / `latest.json` stay on pure semver (`0.5.14`). A `-moonlight`
 * postfix in that version would break tauri-plugin-updater precedence.
 */

export const MOONLIGHT_RELEASE_LABEL = "moonlight";

/** Format the Tauri package version for UI: `0.5.14` → `0.5.14-moonlight`. */
export function formatMoonlightAppVersion(appVersion: string): string {
  if (!appVersion || appVersion === "unknown") {
    return appVersion;
  }
  if (appVersion.endsWith(`-${MOONLIGHT_RELEASE_LABEL}`)) {
    return appVersion;
  }
  return `${appVersion}-${MOONLIGHT_RELEASE_LABEL}`;
}
