interface RoleAccess {
  action: string;
  resource: string;
}

interface Role {
  name: string;
  description: string;
  role_accessCollection: {
    edges: Array<{
      node: RoleAccess;
    }>;
  };
}

interface UserProfile {
  id: string;
  email: string;
  roles: Role;
  role_id: string;
  is_active: boolean;
  first_name: string;
  last_name: string;
  created_at: string;
  last_login: string | null;
  updated_at: string;
  profile_image: string;
}

interface UserData {
  user: {
    user_profileCollection: {
      edges: Array<{
        node: UserProfile;
      }>;
    };
  };
}

export function hasPermission(userData: UserData, resource: string, action: string): boolean {
  try {
    const userProfile = userData.user.user_profileCollection.edges[0]?.node;
    if (!userProfile) return false;

    const roleAccess = userProfile.roles.role_accessCollection.edges;
    
    return roleAccess.some(
      (access) => access.node.resource === resource && access.node.action === action
    );
  } catch (error) {
    console.error('Error checking permissions:', error);
    return false;
  }
}

export function canAccessModule(userData: UserData, resource: string): boolean {
  return hasPermission(userData, resource, 'read');
}

export function parseUserData(cookieData: string): UserData | null {
  try {
    const decodedData = decodeURIComponent(cookieData);
    return JSON.parse(decodedData);
  } catch (error) {
    console.error('Error parsing user data:', error);
    return null;
  }
} 