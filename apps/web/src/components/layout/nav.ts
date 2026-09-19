export const NAV_ITEMS = [
  { href: "/", label: "Kampanyalar" },
  { href: "/brand/new", label: "Marka" },
  { href: "/me", label: "Panelim" },
  { href: "/arbiter", label: "Hakem" },
] as const;

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/c/");
  if (href === "/brand/new") return pathname.startsWith("/brand");
  return pathname.startsWith(href);
}
