/**
 * Gets the organization ID from local storage or cookies
 * @returns The organization ID or null if not found
 */
export async function getOrganizationId(): Promise<string | null> {
  // First try to get from localStorage
  if (typeof window !== 'undefined') {
    const orgId = localStorage.getItem('organizationId');
    if (orgId) return orgId;
  }

  // If not found in localStorage, try to get from cookies
  const cookies = document.cookie.split(';');
  const orgCookie = cookies.find(cookie => cookie.trim().startsWith('organizationId='));
  if (orgCookie) {
    return orgCookie.split('=')[1];
  }

  // If not found in cookies, try to get from session storage
  if (typeof window !== 'undefined') {
    const orgId = sessionStorage.getItem('organizationId');
    if (orgId) return orgId;
  }

  // If not found anywhere, return a default organization ID (for development purposes)
  // In production, you should handle this case differently
  return process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID || null;
} 