import {expect,it,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{}}));
import {documentExpired} from './legalWorkflow';
it('treats validity dates in Sofia, including the midnight boundary',()=>{
 expect(documentExpired('2026-10-04',new Date('2026-10-04T20:59:00Z'))).toBe(false);
 expect(documentExpired('2026-10-04',new Date('2026-10-04T21:00:00Z'))).toBe(true);
 expect(documentExpired(null)).toBe(false);
});
