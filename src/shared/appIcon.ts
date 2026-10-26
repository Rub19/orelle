/** Select the safest Windows parsing name for an indexed application icon. */
export function iconParsingName(app: { appId: string; target: string | null }): string {
  const target = app.target?.trim();
  // Classic files should be extracted from the executable itself. Packaged
  // apps and URLs have no direct file target, so they stay on AppsFolder.
  if (target && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return target;
  return `shell:AppsFolder\\${app.appId}`;
}
