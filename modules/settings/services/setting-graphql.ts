
/*
  Only the columns the browser may read (migration 20261005160000 grants
  exactly these to anon/authenticated). The Zoho OAuth token used to be in
  every one of these documents, which put it in every visitor's browser
  and in localStorage; it is server-only now (lib/server/zoho/fsm-client).
*/
export const GET_SETTINGS_BY_ID = `
    query getSettingsById($filter: settingsFilter) {
        settingsCollection(filter: $filter) {
        edges {
          node {
            id
            site_name
            site_image
            appearance_theme
            primary_color
            secondary_color
            logo_url
            favicon_url
            logo_setting
            site_description
            meta_keywords
            contact_email
            social_links
            created_at
            logo_horizontal_url
            updated_at
            type
          
        }
      }
    }
  }
`;

export const UPDATE_SETTINGS_BY_ID = `
    mutation updateSettingsById($data: settingsUpdateInput!, $filter: settingsFilter) {
  updatesettingsCollection(filter: $filter, set: $data) {
    affectedCount
    records {
        id
        site_name
        appearance_theme
        logo_setting
        site_description
        meta_keywords
        contact_email
        social_links
        created_at
        updated_at
        logo_url
        logo_horizontal_url
        favicon_url
        primary_color
        secondary_color
          type
          
      }
    }
  }
`;

export const INSERT_SETTINGS = `
    mutation insertSettings($data: settingsInsertInput!) {
        insertIntosettingsCollection(objects: [$data]) {
            records {
        id
        site_name
        appearance_theme
        logo_setting
        site_description
        meta_keywords
        contact_email
        logo_horizontal_url
        social_links
        created_at
        updated_at
        logo_url
        favicon_url
        primary_color
        secondary_color
          type
           
      }
        }
    }
`;