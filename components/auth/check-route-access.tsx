import { MenuSection, User } from "@/types/types";
import { getNavData } from "@/components/dashboard-layout/menu-items";

export const checkRoutePermission = async (
  user: User | null,
  pathname: string
) => {
  try {
    // If no user, deny access
    if (!user) {
      return false;
    }

    // Always allow access to the root path
    // if (pathname === "/") {
    //   return true;
    // }

    // Get navigation data based on user
    const { navMain } = getNavData(user);

    // Check if current path is accessible based on user's navigation items
    const isAuthorized = checkRouteAccess(pathname, navMain);

    return isAuthorized;
  } catch (error) {
    console.error("Route permission check failed:", error);
    return false;
  }
};

// Function to check if the current route is accessible based on navigation items
export const checkRouteAccess = (
  currentPath: string,
  navItems: MenuSection[]
): boolean => {
  // Root path is always accessible if the user is logged in
  if (currentPath === "/") {
    return true;
  }

  // Flatten the navigation structure for easier checking
  const allRoutes = flattenNavigation(navItems);

  // Check if the current path matches any route or is a child of any route
  return allRoutes.some((route) => {
    // Exact match
    if (route === currentPath) {
      return true;
    }

    // Check if current path is a child of this route
    // For example, if route is "/users" and currentPath is "/users/123"
    if (route !== "/" && currentPath.startsWith(route + "/")) {
      return true;
    }

    return false;
  });
};

// Helper function to flatten the nested navigation structure
function flattenNavigation(navItems: MenuSection[]): string[] {
  const routes: string[] = [];

  // Process each navigation item
  navItems.forEach((item) => {
    // Add main section URLs if they're not just anchors
    if (item.url && item.url !== "#") {
      routes.push(item.url);
    }

    // Process items in each section
    if (item.items && Array.isArray(item.items)) {
      item.items.forEach((subItem) => {
        if (subItem.url) {
          routes.push(subItem.url);
        }

        // Handle nested items (if any)
        if (subItem.items && Array.isArray(subItem.items)) {
          subItem.items.forEach((nestedItem) => {
            if (nestedItem.url) {
              routes.push(nestedItem.url);
            }
          });
        }
      });
    }
  });

  return routes;
}
