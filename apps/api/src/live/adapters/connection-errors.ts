/** Network errors in plain words for the Live screen ("Couldn't reach …" rather than ECONNREFUSED). */
export function describeConnectionError(err: any, address: string): string {
  const code = err?.code as string | undefined;
  let host = address;
  try {
    host = new URL(address).host;
  } catch {
    /* keep the address as given */
  }
  switch (code) {
    case 'ECONNREFUSED':
      return `${host} refused the connection: nothing is listening there, or a firewall blocks it.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `${host} wasn't found. Check the address.`;
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return `The connection to ${host} timed out or was cut. Check the network between this server and ${host}.`;
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `${host}'s security certificate isn't trusted (${code}).`;
  }
  const message = String(err?.message || err || 'Unknown error');
  if (/not authori[sz]ed|bad user name or password|401|403/i.test(message)) {
    return `${host} refused the sign-in: check the user name, password or token.`;
  }
  return message;
}
