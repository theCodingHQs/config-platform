/** A problem with live settings (connections, rules) to show the person saving them: 422 by default */
export class LiveSettingsError extends Error {
  constructor(
    message: string,
    readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'LiveSettingsError';
  }
}
