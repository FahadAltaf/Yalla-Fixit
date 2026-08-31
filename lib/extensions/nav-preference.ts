// Name of the cookie holding the Extensions section-nav collapsed state.
//
// In a plain module, not beside the component: the component is "use client",
// and importing a non-component export from a client module into a Server
// Component yields a client-reference proxy rather than the value -- so the
// page's cookie lookup would silently read undefined.
//
// Separate from the Scheduling key and from shadcn's own `sidebar_state`, so
// the three navs collapse independently.
export const EXTENSIONS_NAV_COOKIE = "yfi_extensions_nav";
