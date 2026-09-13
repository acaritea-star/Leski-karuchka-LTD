import { authorize } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function generateVAPIDKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const xBytes = base64UrlDecode(publicJwk.x!);
  const yBytes = base64UrlDecode(publicJwk.y!);
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(xBytes, 1);
  uncompressed.set(yBytes, 33);

  const publicKey = base64UrlEncode(uncompressed);
  const privateKey = base64UrlEncode(base64UrlDecode(privateJwk.d!));

  return { publicKey, privateKey };
}

function base64UrlDecode(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw.split('').map((c) => c.charCodeAt(0)));
}

function base64UrlEncode(buffer: Uint8Array): string {
  const binary = Array.from(buffer)
    .map((b) => String.fromCharCode(b))
    .join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getOrCreateVapidKeys() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existing } = await adminClient
      .from('app_config')
      .select('vapid_public_key, vapid_private_key')
      .eq('id', 1)
      .maybeSingle();

    if (existing?.vapid_public_key && existing?.vapid_private_key) {
      return {
        publicKey: existing.vapid_public_key,
        privateKey: existing.vapid_private_key,
      };
    }
  }

  const { publicKey, privateKey } = await generateVAPIDKeys();

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await adminClient.from('app_config').upsert(
      { id: 1, vapid_public_key: publicKey, vapid_private_key: privateKey, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
  }

  return { publicKey, privateKey };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    await authorize(req);
    const { publicKey } = await getOrCreateVapidKeys();

    return new Response(
      JSON.stringify({
        publicKey,
        message: 'VAPID public key is stable and ready for push subscriptions.',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
});
