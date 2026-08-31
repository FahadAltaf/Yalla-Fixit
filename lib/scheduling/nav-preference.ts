// Name of the cookie holding the Scheduling section-nav collapsed state.
//
// It lives in a plain module rather than beside the component, because the
// component is "use client": importing a non-component export from a client
// module into a Server Component gives back a client-reference proxy, not the
// value -- so the layout's cookie lookup silently read `undefined` and the
// nav always rendered expanded.
//
// Deliberately not shadcn's `sidebar_state`: that one belongs to the main
// dashboard sidebar, and sharing it would make the two collapse together.
export const SCHEDULING_NAV_COOKIE = "yfi_scheduling_nav";
