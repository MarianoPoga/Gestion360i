export const getTodayLocalDateString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const clampDateToToday = (value) => {
  if (!value) return value;
  const today = getTodayLocalDateString();
  return value > today ? today : value;
};
