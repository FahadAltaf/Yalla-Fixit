// import { type ClassValue, clsx } from "clsx";
// import { format } from "date-fns";
// import { twMerge } from "tailwind-merge";

// export function cn(...inputs: ClassValue[]) {
//   return twMerge(clsx(inputs));
// }
// export const getImageUrl = (url: string) => {
//   if (url) {
//     const urls = url.split(",");
//     return urls[0].trim();
//   }
//   return "";
// };
// export const formatDate = (timestamp: string) => {
//   if (!timestamp) return "Time Stamp";

//   const date = new Date(timestamp);
//   return format(date, "yyyy-M-d H:mm:ss");
// };
// export const isOnline = (timestamp: string) => {
//   const lastActivityTime = new Date(timestamp);
//   const now = new Date();
//   const onlineThreshold = 15 * 60 * 1000;
//   const timeDifference = now.getTime() - lastActivityTime.getTime();
//   return timeDifference <= onlineThreshold;
// };
