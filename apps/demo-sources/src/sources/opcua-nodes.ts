/** Where a demo machine's variables are in the OPC UA server: ns=1;s=m01.Speed */
export const opcuaNodeId = (code: string, variable: string) => `ns=1;s=${code}.${variable}`;
