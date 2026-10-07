// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),lookup:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({abortSignal:()=>({maybeSingle:mocks.lookup})})})})})}}));
import {clearMoneyIntent,prepareMoneyIntent,readMoneyIntent,writeMoneyOperation} from './pendingMoney';
const payload={p_kind:'income',p_amount:12.5,p_note:'Cash',p_request_id:undefined};
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();});
afterEach(()=>{localStorage.clear();vi.useRealTimers();vi.restoreAllMocks();});
it('restores a pending operation after reload, reusing the UUID and refusing changed money or scope',()=>{
 const command=prepareMoneyIntent('user',':driver',payload);
 expect(readMoneyIntent('user')?.command.p_id).toBe(command.p_id);
 expect(prepareMoneyIntent('user',':driver',payload).p_id).toBe(command.p_id);
 expect(()=>prepareMoneyIntent('user',':driver',{...payload,p_amount:13})).toThrow('Първо');
 expect(()=>prepareMoneyIntent('user','other',payload)).toThrow('Първо');
 clearMoneyIntent('user','wrong');expect(readMoneyIntent('user')).not.toBeNull();
 clearMoneyIntent('user',command.p_id);expect(readMoneyIntent('user')).toBeNull();
});
it('sends the expected account identity and reconciles a lost reply without replaying the mutation',async()=>{
 const command=prepareMoneyIntent('user',':driver',payload);
 mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new TypeError('network lost'))});
 mocks.lookup.mockResolvedValue({data:{id:command.p_id,actor_id:'user'},error:null});
 await expect(writeMoneyOperation(command,'user')).resolves.toBeUndefined();
 expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.rpc).toHaveBeenCalledWith('record_driver_money_verified',{...command,p_actor:'user'});
});
it('retains the same operation after timeout even if the SDK ignores abort',async()=>{
 vi.useFakeTimers();const command=prepareMoneyIntent('user',':driver',payload);
 mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(()=>{})});mocks.lookup.mockResolvedValue({data:null,error:null});
 const result=expect(writeMoneyOperation(command,'user')).rejects.toThrow('същите данни');
 await vi.advanceTimersByTimeAsync(15_000);await result;
 expect(prepareMoneyIntent('user',':driver',payload).p_id).toBe(command.p_id);expect(mocks.rpc).toHaveBeenCalledOnce();
});
it('refuses storage failures or a corrupted pending entry before creating a new operation',()=>{
 localStorage.setItem('leski:pending-money:user','{broken');expect(()=>prepareMoneyIntent('user',':driver',payload)).toThrow('повреден');
 localStorage.clear();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 expect(()=>prepareMoneyIntent('user',':driver',payload)).toThrow('съхранението');expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not reconcile a definite business rejection',async()=>{
 const command=prepareMoneyIntent('user',':driver',payload);mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'Account changed'}})});
 await expect(writeMoneyOperation(command,'user')).rejects.toMatchObject({code:'42501'});expect(mocks.lookup).not.toHaveBeenCalled();
});
