/**
 * Generates a random avatar URL from DiceBear API
 * @returns {string} Random avatar URL
 */
export const generateRandomAvatar = (): string => {
  const styles = [
    'adventurer',
    'adventurer-neutral',
    'avataaars',
    'big-ears',
    'big-smile',
    'bottts',
    'croodles',
    'fun-emoji',
    'icons',
    'identicon',
    'initials',
    'lorelei',
    'micah',
    'miniavs',
    'notionists',
    'open-peeps',
    'personas',
    'pixel-art',
    'shapes'
  ];
  
  // Pick a random style
  const randomStyle = styles[Math.floor(Math.random() * styles.length)];
  
  // Generate a random seed
  const seed = Math.random().toString(36).substring(2, 12);
  
  // Return the avatar URL
  return `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${seed}`;
};



export const generateRandomAvatarChatbot = (): string => {
  const styles = [
    'George',
    'Brian',
    'Mackenzie',
    'Mason',
    'Brooklynn',
    'Jessica',
    'Christian',
    'Sawyer',
    'Vivian',
    'Sara',
    'Nolan',

  ];
  
  // Pick a random style
  const randomStyle = styles[Math.floor(Math.random() * styles.length)];
  
  
  // Return the avatar URL
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${randomStyle}`;
};



export const generateNameAvatar = (name: string) => {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${name}`;
};


