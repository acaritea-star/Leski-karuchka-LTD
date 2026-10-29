type RpcClient = { rpc: (name: string) => PromiseLike<{ data: unknown; error: unknown }> };
export type VapidKeys = { publicKey: string; privateKey: string };
export async function readVapidKeys(client: RpcClient): Promise<VapidKeys> {
  const { data, error } = await client.rpc('read_push_vapid_keys');
  if (error || !data || typeof data !== 'object') throw Error('Push configuration unavailable');
  const keys = data as Partial<VapidKeys>;
  if (typeof keys.publicKey !== 'string' || !keys.publicKey || typeof keys.privateKey !== 'string' || !keys.privateKey)
    throw Error('Push configuration unavailable');
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}
export function createVapidHandler(authorize: (request: Request) => Promise<unknown>, read: () => Promise<VapidKeys>) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    try {
      await authorize(request);
      const { publicKey } = await read();
      return new Response(JSON.stringify({ publicKey, message: 'VAPID public key is stable and ready for push subscriptions.' }), { headers });
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response(JSON.stringify({ error: 'Push configuration unavailable' }), { status: 503, headers });
    }
  };
}
