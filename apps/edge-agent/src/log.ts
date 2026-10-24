/** Plain timestamped lines, readable in `docker logs` and a Windows service log alike */
export const log = {
  info: (message: string) => console.log(`${new Date().toISOString()} ${message}`),
  warn: (message: string) => console.warn(`${new Date().toISOString()} WARNING ${message}`),
};
