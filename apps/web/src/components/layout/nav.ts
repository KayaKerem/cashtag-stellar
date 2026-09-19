export const NAV_ITEMS = [
  { href: "/", label: "Campaigns" },
  { href: "/brand/new", label: "Brand" },
  { href: "/me", label: "My dashboard" },
  { href: "/arbiter", label: "Arbiter" },
] as const;

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/c/");
  if (href === "/brand/new") return pathname.startsWith("/brand");
  return pathname.startsWith(href);
}
