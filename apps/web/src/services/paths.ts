export const appHome = import.meta.env.BASE_URL || '/';
export function applicationPath(pathname: string, base = appHome): string {
  return base !== '/' && pathname.startsWith(base)
    ? `/${pathname.slice(base.length)}`
    : pathname;
}
