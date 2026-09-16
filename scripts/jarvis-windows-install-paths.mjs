import path from 'node:path';

// AppData created by a packaged desktop installer may exist only inside its
// MSIX overlay. A Task Scheduler process does not inherit that overlay.
export function assertWindowsServicePaths(releaseRoot, stateRoot, environment) {
  const paths = [releaseRoot, stateRoot, ...Object.entries(environment)
    .filter(([key]) => key.endsWith('_PATH') || key.endsWith('_DIR')).map(([, value]) => value)];
  for (const value of paths) {
    if (typeof value !== 'string' || !path.win32.isAbsolute(value) || /[\r\n\0]/.test(value)) throw Error('Absolute Windows service paths required');
    const normalized = path.win32.normalize(value);
    if (/(?:^|\\)(?:AppData|WindowsApps)(?:\\|$)/i.test(normalized)) {
      throw Error('Service files must be outside AppData and package storage; stage a protected native installation first');
    }
  }
}
