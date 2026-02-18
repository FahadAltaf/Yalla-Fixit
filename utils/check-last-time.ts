export const checkLastTime = (time: Date) => {
  const lastCheckTime = new Date(time);
  const now = new Date();
  const timeElapsed = now.getTime() - lastCheckTime.getTime();

  let displayTime;
  if (timeElapsed < 60000) {
    // 1 minute
    const time = Math.round(timeElapsed / 1000);
    displayTime = ` ${time < 30 ? "10" : time < 60 ? "50" : "60"} sec ago`;
  } else if (timeElapsed < 3600000) {
    // 1 hour
    displayTime = `${Math.round(timeElapsed / 60000)} mins ago`;
  } else if (timeElapsed < 86400000) {
    // 1 day
    displayTime = `${Math.round(timeElapsed / 3600000)} hrs ago`;
  } else {
    displayTime = `${Math.round(timeElapsed / 86400000)} days ago`;
  }
  // Display the time
  // console.log(displayTime);
  return displayTime;
};

export function getLastMonthDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  // console.log(lastMonthDate,'lastMonthDate');
  // const year = lastMonthDate.getFullYear();
  // const month = String(lastMonthDate.getMonth() + 1).padStart(2, '0'); // Add leading zero if needed
  // const day = String(lastMonthDate.getDate()).padStart(2, '0');       // Add leading zero if needed

  // return `${year}${month}${day}`;
}
