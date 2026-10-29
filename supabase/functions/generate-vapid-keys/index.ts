import { admin, authorize } from '../_shared/auth.ts';
import { createVapidHandler, readVapidKeys } from '../_shared/vapid.ts';
// Preserve the client URL. Key creation is now an explicit operator action;
// a failed read must never rotate the pair used by installed subscribers.
Deno.serve(createVapidHandler(authorize, () => readVapidKeys(admin)));
