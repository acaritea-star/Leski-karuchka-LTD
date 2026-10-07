// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{rpc:mocks.rpc}}));
import {legalOperator} from '@/config/legal';
import {beginLegalIntent,finishLegalIntent,pendingLegalIntent} from './legalAcceptance';
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));});
afterEach(()=>{sessionStorage.clear();vi.useRealTimers();});
it('does not fabricate acceptance from an existing session or an absent login click',async()=>{
 await finishLegalIntent();expect(mocks.rpc).not.toHaveBeenCalled();
});
it('records current versions only after the explicit provider action and clears intent after confirmation',async()=>{
 beginLegalIntent('facebook');mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:'server-id',error:null})});
 await finishLegalIntent();expect(mocks.rpc).toHaveBeenCalledWith('accept_legal_versions',{p_terms:legalOperator.termsVersion,p_privacy:legalOperator.privacyVersion,p_method:'facebook'});expect(pendingLegalIntent()).toBeNull();
});
it('retains intent on a lost reply for an idempotent retry',async()=>{
 beginLegalIntent('google');mocks.rpc.mockReturnValueOnce({abortSignal:()=>Promise.reject(new Error('network'))});
 await expect(finishLegalIntent()).rejects.toThrow('network');expect(pendingLegalIntent()?.method).toBe('google');
 mocks.rpc.mockReturnValueOnce({abortSignal:()=>Promise.resolve({data:'same-id',error:null})});await finishLegalIntent();expect(pendingLegalIntent()).toBeNull();
});
it('ignores expired or changed-version intents instead of accepting unseen text',async()=>{
 beginLegalIntent('google');vi.advanceTimersByTime(60*60*1000+1);await finishLegalIntent();expect(mocks.rpc).not.toHaveBeenCalled();
 sessionStorage.setItem('leski:oauth-legal-intent',JSON.stringify({terms:'old',privacy:legalOperator.privacyVersion,method:'google',created:Date.now()}));
 await finishLegalIntent();expect(mocks.rpc).not.toHaveBeenCalled();
});
