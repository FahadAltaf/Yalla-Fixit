// GraphQL mutation to insert user into users table
export const INSERT_USER = `
  mutation InsertUser($objects: [user_profileInsertInput!]!) {
    insertIntouser_profileCollection(objects: $objects) {
      affectedCount
      records {
        id
        email
        role_id
        first_name
        last_name
        full_name
        is_active
        created_at
        profile_image
      }
    }
  }
`;

export const GET_USERS_BY_EMAIL = `
query GetUsersByEmail($filter: user_profileFilter) {
  user_profileCollection(filter: $filter) {
    edges {
      node {
        id
        email
        role_id
        first_name
        last_name
        is_active
        full_name
        last_login
        profile_image
        created_at
      }
    }
  }
}
`;

export const GET_USERS_PAGINATION = `
query GetUsers($filter: user_profileFilter, $limit: Int = 10, $offset: Int = 0, $sorting: [user_profileOrderBy!] = [{created_at: DescNullsLast}]) {
  user_profileCollection(
    filter: $filter
    first: $limit
    offset: $offset
    orderBy: $sorting
  ) {
    edges {
      node {
        id
        email
        role_id
        first_name
        last_name
        full_name
        is_active
       
        
        last_login
        profile_image
        created_at
        updated_at
     
       
          roles {
             name
             description
             role_accessCollection {
               edges {
                 node {
                   resource
                   action
                 }
               }
             }
           }
      }
    }
  }
}
`;
export const GET_USERS_COUNT = `
query CountUsers($filter: user_profileFilter) {
  user_profileCollection(
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

export const GET_USERS = `
    query GetUsers {
     user_profileCollection {
       edges {
         node {
           id
           email
           role_id
           first_name
           last_name
           full_name
           is_active
           last_login
           profile_image
           created_at
           updated_at
             roles {
             name
             description
             role_accessCollection {
               edges {
                 node {
                   resource
                   action
                 }
               }
             }
           }
         }
       }
     }
   }
   
   `;

export const GET_USERS_BY_ID = `
query GetUsersById($id: UUID!) {
 user_profileCollection(filter: {id: {eq: $id}}) {
   edges {
     node {
       id
       email
       role_id
       first_name
       last_name
       full_name
       is_active
       last_login
       profile_image
       created_at
   
       updated_at
          roles {
             name
             description
             role_accessCollection {
               edges {
                 node {
                   resource
                   action
                 }
               }
             }
           }
     }
   }
 }
}
`;

export const UPDATE_USER = `
  mutation UpdateUser(
    $id: UUID!
    $first_name: String
    $last_name: String
    $role_id: UUID!
    $full_name: String
    $profile_image: String
    $is_active: Boolean
  ) {
    updateuser_profileCollection(
      filter: { id: { eq: $id } }
      set: {
        first_name: $first_name
        last_name: $last_name
        full_name: $full_name
        role_id: $role_id
        profile_image: $profile_image
        is_active: $is_active
      }
    ) {
      affectedCount
      records {
        id
        email
        first_name
        last_name
        full_name
        role_id
        profile_image
        is_active
      }
    }
  }
`;

export const DELETE_USER = `
mutation deleteUser($id: UUID!) {
  deleteFromuser_profileCollection(filter: {id: {eq: $id}}) {
    affectedCount
  }
}
`;
