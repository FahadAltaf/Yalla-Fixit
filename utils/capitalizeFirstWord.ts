export const capitalizeFirstLetter = (name: string) => {
  if (!name) return '';
  
  const initials = name
    .split(" ")
    .map((word) => {
      const firstChar = word[0];
      // Check if the first character is an alphabet letter before including it
      return firstChar && /[a-zA-Z]/.test(firstChar) ? firstChar.toUpperCase() : '';
    })
    .filter(initial => initial !== '') // Filter out any empty strings
    .join("");
  
  return initials.slice(0, 2);
};

export function formatToTwoDecimals(number: number): number {
  return parseFloat(number.toFixed(2));
}
export function getUniqueItems(emailArray: string[]): string[] {
  const uniqueEmailsSet = new Set(emailArray);
  return Array.from(uniqueEmailsSet);
}
export function sanitizePhoneNumber(phoneArray: string[]): string[] {
  return phoneArray.map(number => {
    number = number.replace('|', '');
    if (number.startsWith('+')) {
      return number.substring(1);
    } else if (number.startsWith('00')) {
      return number.substring(2);
    }
    return number;
  });
}
export const capitalizeFirstLetterEachWord = (text: string): string => {
  if (!text) return '';

  return text
    .split(' ') // Split the string into an array of words
    .map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() // Capitalize first letter and make the rest lowercase
    )
    .join(' '); // Join the words back into a string
};