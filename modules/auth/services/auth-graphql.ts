// GraphQL query to get user by ID
export const GET_USER_BY_ID = `
 query GetUserById($id: UUID!) {
  user_profileCollection(filter: { id: { eq: $id } }) {
    edges {
      node {
        id
        email
        role_id
        first_name
        last_name
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

// GraphQL mutation to update user profile_image
export const UPDATE_USER_PROFILE = `
  mutation UpdateUserProfile($id: uuid!, $updates: user_profile_set_input!) {
    update_user_profile_by_pk(
      pk_columns: {id: $id}, 
      _set: $updates
    ) {
      id
      first_name
      last_name
      is_active
      updated_at
    }
  }
`;