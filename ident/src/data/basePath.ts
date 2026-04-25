export function appPath(pathname: string): string {
  const url = appUrl(pathname);
  return `${url.pathname}${url.search}`;
}

export function appWebSocketUrl(pathname: string): string {
  const url = appUrl(pathname);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function appUrl(pathname: string): URL {
  const relative = pathname.replace(/^\/+/, "");
  return new URL(relative, window.location.href);
}
