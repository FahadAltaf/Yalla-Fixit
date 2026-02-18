
// GraphQL query for fetching all rolesCollection
export const GET_ALL_ROLES = `
 query GetAllRoles {
  rolesCollection {
    edges {
      node {
        id
        name
        description
        created_at
        updated_at
      }
    }
  }
}
`;

// GraphQL query for fetching a role by ID
export const GET_ROLE_BY_ID = `
  query GetRoleById($id: UUID!) {
    roles_by_pk(id: $id) {
      id
      name
      description
      created_at
      updated_at
    }
  }
`;

// GraphQL query for fetching rolesCollection with access permissions
export const GET_ROLES_WITH_ACCESS = `
  query GetRolesWithAccess {
    rolesCollection {
      edges {
        node {
          id
          name
          description
          role_accessCollection {
            edges {
              node {
                id
                resource
                action
              }
            }
          }
        }
      }
    }
  }
`;

// GraphQL query for fetching rolesCollection with pagination
export const GET_ROLES_PAGINATED = `
  query GetRoles($filter: rolesFilter, $limit: Int, $offset: Int) {
  rolesCollection(
    filter: $filter
    orderBy: [{ created_at: DescNullsLast }]
 
  ) {
    edges {
      node {
        id
        name
        description
        created_at
        updated_at
       
      }
    }
  }
}
`;

export const GET_ROLES_COUNT = `
query CountRoles($filter: rolesFilter, $limit: Int, $offset: Int) {
  rolesCollection(
    filter: $filter 
  ) {
    edges{
      node{
        id
      }
    }
  }
}
`;

// GraphQL query for searching rolesCollection by name
export const SEARCH_ROLES = `
  query SearchRoles($searchTerm: String!) {
    rolesCollection(where: {name: {_ilike: $searchTerm}}) {
      id
      name
      description
      created_at
      updated_at
    }
  }
`;

// GraphQL query to fetch user role by name
export const GET_ROLE_BY_NAME = `
 query GetRoleByName($name: String!) {
  rolesCollection(filter: { name: { eq: $name } }) {
    edges {
      node {
        id
        name
      }
    }
  }
}
`;

// GraphQL query for creating a new role
export const CREATE_ROLE = `
  mutation InsertRole($objects: [rolesInsertInput!]!) {
    insertIntorolesCollection(objects: $objects) {
      affectedCount
      records {
        id
        name
        description
        created_at
      }
    }
  }
`;

// GraphQL query for updating a role
export const UPDATE_ROLE = `
 mutation UpdateRole(
    $id: UUID!
    $name: String
    $description: String
  ) {
    updaterolesCollection(
      filter: { id: { eq: $id } }
      set: {
        name: $name
        description: $description
      }
    ) {
      affectedCount
      records {
        id
        name
        description
        created_at
      }
    }
  }
`;

// GraphQL query for deleting a role
export const DELETE_ROLE = `
 mutation DeleteRole($id: UUID!) {
  deleteFromrolesCollection(filter: {id: {eq: $id}}) {
    affectedCount
  }
}
`;

// GraphQL query for fetching role access permissions
export const GET_ROLE_ACCESS = `
  query GetRoleAccess($filter: role_accessFilter) {
    role_accessCollection(
      filter: $filter
      orderBy: [{ created_at: DescNullsLast }]
    ) {
      edges {
        node {
          id
          role_id
          resource
          action
          created_at
          updated_at
          roles {
          
                name
            
          }
        }
      }
    }
  }
`;

// GraphQL query for creating a new role access
export const CREATE_ROLE_ACCESS = `
  mutation CreateRoleAccess($objects: [role_accessInsertInput!]!) {
    insertIntorole_accessCollection(objects: $objects) {
      affectedCount
      records {
        id
        role_id
        resource
        action
      }
    }
  }
`;

// GraphQL query for deleting a role access
export const DELETE_ROLE_ACCESS = `
  mutation DeleteRoleAccess($id: UUID!) {
    deleteFromrole_accessCollection(filter: {id: {eq: $id}}) {
      affectedCount
    }
  }
`;

// GraphQL query for deleting all role access for a role
export const DELETE_ROLE_ACCESS_BY_ROLE = `
  mutation DeleteRoleAccessByRole($roleId: UUID!) {
    deleteFromrole_accessCollection(filter: {role_id: {eq: $roleId}}) {
      affectedCount
    }
  }
`;
