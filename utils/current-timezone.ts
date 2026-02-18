export const currentTimezone = (inputDate?: Date | string | undefined) => {
  // If no date is provided, use the current date and time
  
  return inputDate ? new Date(inputDate).toLocaleString("en-US", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // current timezone
  }) : "";
};
