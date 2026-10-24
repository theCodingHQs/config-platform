/** Network errors in plain words for the Live screen ("Couldn't reach …" rather than ECONNREFUSED). */
const NETWORK_CODES = /(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH)/;

export function describeConnectionError(err: any, address: string): string {
  // Some libraries only mention the code in their message ("connect ECONNREFUSED 10.0.0.5:4840")
  const fromMessage = String(err?.message ?? '').match(NETWORK_CODES)?.[1];
  const code = typeof err?.code === 'string' && NETWORK_CODES.test(err.code) ? err.code : (fromMessage ?? err?.code);
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
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `${host} can't be reached from this server: check the network, or that it is switched on.`;
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
  if (/^404\b/.test(message)) {
    return `${host} has no live stream at that address: check the path after the host name.`;
  }
  return message;
}
